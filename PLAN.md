# PLAN.md — Home Battery Simulator: Modeling Accuracy Improvements

## Purpose

The current battery simulation model collapses several distinct physical loss
mechanisms into two efficiency fields. This produces optimistic and, worse,
*structurally wrong* payback estimates, because losses that behave differently
(fixed vs. throughput-scaling vs. part-load-dependent) are all folded into a
single flat round-trip efficiency.

This plan adds the missing loss mechanisms as **separate, physically meaningful
parameters**, in phases ordered by impact. Each phase is self-contained,
independently testable, and safe to merge on its own.

## Current input fields (baseline)

```
Capacity (kWh)
Charge power DC (kW)
Discharge power DC (kW)
Initial SoC (%)
Charge efficiency (%)
Discharge efficiency (%)
Min SoC (%)
Max SoC (%)
```

## Design principles

1. **Keep each loss mechanism separate.** Do not fold fixed consumption into
   efficiency, or part-load losses into a flat number. Each has different
   behavior over the simulation horizon.
2. **Backward compatible.** Every new field must have a sensible default that
   reproduces (approximately) the current behavior when left untouched, so
   existing saved configurations do not silently change.
3. **Progressive disclosure.** New fields go behind an "Advanced" section /
   collapsible group so the basic UI stays simple. Casual users ignore them;
   power users opt in.
4. **Validate against throughput.** Expose annual throughput and equivalent
   full cycles as *outputs* so the user can sanity-check their own efficiency
   assumptions.
5. **Document units explicitly** in labels and tooltips (W vs kW, % per year vs
   % per cycle). Ambiguous units are the most common source of user error.

---

## Phase 1 — Fixed / parasitic consumption (HIGHEST IMPACT)

### Rationale
The inverter draws a roughly constant idle/operating power (~40–100 W for this
class of three-phase hybrid inverter) whenever it is powered on. This is a
**continuous drain that does not scale with throughput** — it keeps running even
when the battery is idle. Folding it into round-trip efficiency is wrong: it
would make the loss vanish exactly when the battery cycles little, whereas in
reality it weighs *more heavily* then.

### New input field
- `fixed_consumption_w` — Fixed inverter/system consumption in **Watts**.
  - Default: `0` (preserves current behavior).
  - Suggested realistic value shown in tooltip: 50–85 W for a 3-phase hybrid.
  - Alternative accepted unit: allow entry as `kWh/day` with automatic
    conversion (kWh/day = W × 24 / 1000). Pick one canonical internal unit (W)
    and convert on input.

### Model logic
Per simulation timestep of duration `dt_hours`:
```
fixed_loss_kwh = fixed_consumption_w / 1000 * dt_hours
```
Subtract this from available energy each timestep the system is "on".
Decision to encode explicitly and document:
- **Where is it drawn from?** Two defensible options:
  (a) Always drawn from the battery when SoC > min (self-powered idle), else
      from grid.
  (b) Drawn from whatever source currently supplies the house.
  Default recommendation: draw from battery when SoC > Min SoC, otherwise from
  grid import. Make the behavior a documented constant, and consider exposing
  it as an advanced toggle in a later phase.
- Ensure fixed consumption cannot pull SoC below `min_soc` — it should switch to
  grid import at the floor, not violate the floor.

### Tests
- Zero fixed consumption reproduces the pre-change result (regression baseline).
- Non-zero fixed consumption with a fully idle battery over N days draws
  exactly `fixed_consumption_w/1000 * 24 * N` kWh and never breaches Min SoC.
- Annual fixed loss ≈ `W × 8.76` kWh/year (sanity check the arithmetic).

### Acceptance criteria
- New field present, defaulted to 0, documented with realistic guidance.
- Payback/savings output visibly changes when field is set.
- All existing tests still pass with default value.

---

## Phase 2 — Separate inverter efficiency from battery efficiency

### Rationale
The two existing efficiency fields currently conflate cell/DC-DC losses with
inverter AC↔DC conversion losses. These are physically distinct and, in a
comparison between inverters or between LV/HV systems, need to move
independently.

### Refactor
Split each direction into two multiplicative stages:
- `battery_charge_eff` / `battery_discharge_eff` — DC-DC / cell + BMS.
  - Default ~98% each (round-trip ~96%).
- `inverter_charge_eff` / `inverter_discharge_eff` — AC↔DC conversion.
  - Default ~97% each.

### Backward compatibility
- Keep the existing two fields as the *effective combined* efficiency in "Basic"
  mode. In "Advanced" mode, expose the four-stage split.
- When advanced fields are untouched, derive them so the product equals the
  legacy combined value, OR keep a single "efficiency mode" switch:
  `combined` (2 fields) vs `staged` (4 fields). Pick whichever is cleaner in the
  existing codebase; document the choice.

### Model logic
Effective per-direction efficiency = battery_stage × inverter_stage.
Apply on charge (grid/PV → stored) and on discharge (stored → load) separately.

### Tests
- `staged` mode with battery=100%, inverter=X reduces to a pure inverter model.
- `combined` mode reproduces Phase-1 results exactly.
- Round-trip = charge_total × discharge_total within floating tolerance.

### Acceptance criteria
- User can model battery and inverter losses independently.
- Legacy 2-field configs continue to produce equivalent results.

---

## Phase 3 — Part-load efficiency curve (KEY REALISM GAIN)

### Rationale
Inverter efficiency is **not constant** — it drops significantly at low output
power (a few hundred W) relative to near-nominal load. Residential evening base
loads are often served at low power, precisely where efficiency is worst. A flat
efficiency number systematically *overestimates* real-world performance for
low-power discharge.

### New input (advanced)
Support one of two entry modes; implement the simpler one first:
- **Simple (implement first):** `low_power_eff` + `low_power_threshold_kw`.
  Below the threshold, use `low_power_eff`; above it, use the nominal inverter
  efficiency. Optionally linearly interpolate between the two anchor points to
  avoid a discontinuity.
- **Full (optional, later):** an efficiency-vs-load-fraction lookup table
  (e.g. points at 5%, 10%, 20%, 30%, 50%, 100% of rated power), interpolated.

### Model logic
Each timestep, compute instantaneous power = energy_moved / dt_hours, express as
a fraction of rated inverter power, look up / interpolate the applicable
efficiency, and apply it for that timestep instead of the flat value.

### Interaction to document
This interacts with dispatch strategy: serving load in larger, less frequent
blocks (as an external energy manager like EVCC can enforce) keeps the inverter
out of the low-efficiency region. Note this in the docs; it explains why smart
scheduling improves real yield beyond simple arbitrage.

### Tests
- Constant near-nominal discharge ≈ nominal efficiency (curve inactive region).
- Sustained low-power discharge yields measurably lower efficiency than a flat
  model over the same energy.
- Curve disabled (or low_power_eff == nominal) reproduces Phase-2 results.

### Acceptance criteria
- Low-power discharge is penalized relative to the flat model.
- Feature is optional and defaults off (backward compatible).

---

## Phase 4 — Capacity degradation over lifetime

### Rationale
Payback is computed over 10–15 years, but usable capacity is not constant. LFP
degrades toward its end-of-life threshold (commonly ~70–80% of nominal after the
warranted cycle count). Ignoring this overstates late-year savings.

### New inputs (advanced)
- `degradation_mode`: `none` | `per_year` | `per_cycle`.
- `degradation_rate`:
  - per_year: % capacity lost per year (e.g. 2%/yr).
  - per_cycle: % lost per equivalent full cycle, driven by the cycle counter
    from Phase 5.
- `end_of_life_floor`: minimum capacity fraction (e.g. 70%) below which capacity
  is clamped (do not degrade to zero).

### Model logic
- Effective usable capacity in year/step = nominal × (1 − degradation applied),
  clamped at `end_of_life_floor`.
- If the simulation is single-year, apply the midpoint-of-life capacity, or
  offer to run a multi-year projection (see Phase 6 note).

### Tests
- `none` reproduces prior behavior.
- per_year 2% over 10 years → ~20% loss (linear) or documented compounding.
- Capacity never drops below `end_of_life_floor`.

### Acceptance criteria
- Multi-year payback reflects declining capacity.
- Default `none` keeps existing single-year results unchanged.

---

## Phase 5 — Output: throughput & equivalent full cycles (VALIDATION)

### Rationale
This is an **output**, not an input, but it is the cheapest high-value addition:
it lets the user validate every efficiency assumption they made. It also feeds
Phase-4 per-cycle degradation.

### New outputs
- `annual_throughput_kwh` — total energy discharged (or charged) per year.
- `equivalent_full_cycles` — annual_throughput / usable_capacity.
- Optionally: peak observed charge/discharge power, and count/percentage of
  timesteps clipped by the inverter power limit (ties back to sizing).

### Model logic
Accumulate discharged (and charged) energy across the run; divide by usable
capacity for EFC. Report per-year (normalize if the input dataset spans a
non-integer number of years — detect from timestamps).

### Tests
- Known synthetic profile (e.g. exactly 1 full cycle/day for 365 days) yields
  EFC == 365 and throughput == 365 × usable_capacity.
- Non-integer-year datasets are normalized correctly to per-year figures.

### Acceptance criteria
- Throughput and EFC displayed alongside financial results.
- Values are plausible and match hand calculation on a test profile.

---

## Phase 6 — Lower-priority realism (implement as needed)

Each item below is independent; pick up individually if the use case warrants.

### 6a. SoC-dependent power taper
Real batteries taper charge power above ~90% SoC (CV phase) and may limit near
empty. Add `taper_start_soc` (%) above which charge power ramps down linearly to
a floor. Default off (no taper) for backward compatibility.

### 6b. Temperature effects
For unheated/uninsulated installations: charge power derates or charging is
blocked below a temperature threshold; optional self-heating consumption when
below it. Inputs: `min_charge_temp_c`, `temp_derate_curve` (optional),
`self_heating_w`. Requires an ambient temperature series as input; only worth it
if the user supplies temperature data. Default off.

### 6c. Backup reserve SoC
Separate a "backup reserve" (held for outages, unavailable for arbitrage) from
the safety `min_soc`. Add `backup_reserve_soc` (%); arbitrage/self-consumption
may only use capacity between `backup_reserve_soc` and `max_soc`, while `min_soc`
remains the absolute hardware floor. Default: equal to min_soc (no separate
reserve).

### 6d. Round-trip as single input (UX only)
Offer round-trip efficiency as an alternative single input that auto-splits into
per-direction values (sqrt split), for users who think in round-trip terms. Pure
UX; no physics change.

---

## Suggested implementation order

1. **Phase 1** (fixed consumption) — biggest correctness gain, small change.
2. **Phase 5** (throughput/EFC outputs) — cheap, enables validation + Phase 4.
3. **Phase 3** (part-load efficiency) — corrects systematic low-power overestimate.
4. **Phase 2** (inverter/battery split) — structural cleanliness, enables comparisons.
5. **Phase 4** (degradation) — needed once multi-year payback matters.
6. **Phase 6** (a–d) — as specific use cases demand.

(Phases 2 and 3 touch the same efficiency code; if convenient, do 2 then 3 in
one pass. The ordering above front-loads the largest correctness wins.)

---

## Cross-cutting requirements

- **Docs:** update README / user-facing help with each new field, its unit, a
  realistic default range, and a one-line explanation of the loss mechanism.
- **Defaults preserve behavior:** every new field defaults to a no-op. Adding
  the feature must not change results for an untouched existing config.
- **Input validation:** enforce sane ranges (e.g. efficiencies 0–100%, powers
  ≥ 0, min_soc < max_soc, backup_reserve_soc ≥ min_soc). Fail with clear
  messages, not silent clamping, where practical.
- **Tests:** each phase ships with regression tests proving the default-off path
  is unchanged, plus at least one test proving the new mechanism has the
  expected directional effect.
- **No breaking changes to saved configs:** if configs are serialized, handle
  missing new keys by applying defaults on load (migration path).

## Notes for the implementer

- Determine the simulation timestep from the input data (this dataset is
  hourly). Do not hardcode `dt_hours = 1`; derive it so sub-hourly data works.
- Detect and handle gaps / NULL rows in the input series gracefully (the
  reference consumption dataset contains NULL rows that must be skipped, not
  parsed as zero).
- Report per-year figures normalized to the actual span of the input data
  (which may be a non-integer number of years).
- Keep physical loss stages multiplicative and clearly commented so the loss
  chain (grid/PV → inverter → battery → inverter → load, plus fixed draw) is
  auditable from the code.
