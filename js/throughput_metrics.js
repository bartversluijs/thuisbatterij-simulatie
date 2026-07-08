/**
 * Throughput & equivalent full cycles (Phase 5) — an OUTPUT, not an input.
 *
 * This is the cheapest high-value addition in the plan: it lets the user
 * validate every efficiency assumption they made, and it feeds Phase-4
 * per-cycle degradation. It changes no physics — it only *observes* the energy
 * moved through the battery during a run and reports it in useful terms.
 *
 * Reported figures:
 *   - annual_throughput_kwh   — energy discharged per year (DC, at the battery).
 *   - equivalent_full_cycles  — annual throughput / usable capacity.
 *   - peak charge/discharge power actually observed (DC).
 *   - number / percentage of timesteps clipped by the inverter power limit
 *     (ties back to sizing: lots of clipping means the power rating is the
 *     binding constraint, not the capacity).
 *
 * Design decisions (documented per PLAN cross-cutting requirements):
 *   - Throughput is measured on the DC (battery) side — consistent with usable
 *     capacity, so equivalent full cycles are physically meaningful. This
 *     matches the existing `totalCharged`/`totalDischarged` accumulators, which
 *     already hold DC energy.
 *   - The headline throughput and EFC use *discharged* energy (energy actually
 *     delivered), matching the plan's definition
 *     "EFC = annual_throughput / usable_capacity" with throughput = discharged.
 *     Charged figures are also exposed for completeness.
 *   - Per-year normalisation uses the actual span of the input data, detected
 *     from the first/last timestamps plus the final step, so a dataset covering
 *     a non-integer number of years is annualised correctly. A "year" is a flat
 *     8760 h (365 d); a full-year hourly dataset then yields span = 1.0 exactly.
 *   - Gaps / skipped NULL rows simply are not recorded; the timestamp-based span
 *     still reflects the calendar range the data was drawn from.
 *
 * Usage (feed one record per simulated timestep, right where the DC energy is
 * already known):
 *
 *     const tracker = new ThroughputTracker({
 *         capacityKwh, chargePowerKw, dischargePowerKw,
 *     });
 *     // inside the loop, after battery.charge()/discharge():
 *     tracker.record(timestampMs, dcToBattery, dcFromBattery, durationHours);
 *     // after the run:
 *     const metrics = tracker.metrics();   // plain object, safe to serialise
 *
 * Backward compatible: purely additive. Simulators that do not construct a
 * tracker behave exactly as before, and a run with no battery activity yields
 * all-zero metrics.
 */

// Canonical year length for annualisation and equivalent-full-cycle counting.
// Flat 8760 h so a full-year hourly dataset annualises to exactly 1.0.
const HOURS_PER_YEAR = 8760;

/**
 * Accumulates per-timestep DC throughput and derives Phase-5 output metrics.
 */
class ThroughputTracker {
    /**
     * @param {Object} config
     * @param {number} config.capacityKwh - Usable/nominal battery capacity (kWh)
     *   used as the denominator for equivalent full cycles. Pass the *effective*
     *   (post-degradation) capacity when Phase 4 is active, so EFC reflects the
     *   capacity the run actually used.
     * @param {number} [config.chargePowerKw] - Max DC charge power (kW). Used to
     *   detect power-limited (clipped) timesteps. Omit/0 to skip clip detection.
     * @param {number} [config.dischargePowerKw] - Max DC discharge power (kW).
     */
    constructor(config = {}) {
        this.capacityKwh = tmNum(config.capacityKwh, 0);
        this.chargePowerKw = tmNum(config.chargePowerKw, 0);
        this.dischargePowerKw = tmNum(config.dischargePowerKw, 0);

        this.totalChargedKwh = 0;
        this.totalDischargedKwh = 0;

        this.peakChargeKw = 0;
        this.peakDischargeKw = 0;

        this.totalSteps = 0;
        this.activeSteps = 0;          // steps with any charge or discharge
        this.clippedChargeSteps = 0;
        this.clippedDischargeSteps = 0;

        this.firstTs = null;
        this.lastTs = null;
        this.lastStepHours = 0;
    }

    /**
     * Record one timestep.
     *
     * @param {number} timestampMs - Timestep start as epoch milliseconds.
     * @param {number} dcChargeKwh - DC energy into the battery this step (kWh, >= 0).
     * @param {number} dcDischargeKwh - DC energy out of the battery this step (kWh, >= 0).
     * @param {number} durationHours - Timestep duration in hours.
     */
    record(timestampMs, dcChargeKwh, dcDischargeKwh, durationHours) {
        const dt = tmNum(durationHours, 0);
        const charge = Math.max(0, tmNum(dcChargeKwh, 0));
        const discharge = Math.max(0, tmNum(dcDischargeKwh, 0));

        this.totalSteps++;
        this.totalChargedKwh += charge;
        this.totalDischargedKwh += discharge;

        if (charge > 0 || discharge > 0) this.activeSteps++;

        if (dt > 0) {
            const chargeKw = charge / dt;
            const dischargeKw = discharge / dt;
            if (chargeKw > this.peakChargeKw) this.peakChargeKw = chargeKw;
            if (dischargeKw > this.peakDischargeKw) this.peakDischargeKw = dischargeKw;

            // Clipped when the delivered DC energy reached the power cap for the
            // step (min() in Battery makes this an exact equality when power is
            // the binding constraint).
            if (this.chargePowerKw > 0 && charge > 0) {
                const cap = this.chargePowerKw * dt;
                if (charge >= cap - tmRelTol(cap)) this.clippedChargeSteps++;
            }
            if (this.dischargePowerKw > 0 && discharge > 0) {
                const cap = this.dischargePowerKw * dt;
                if (discharge >= cap - tmRelTol(cap)) this.clippedDischargeSteps++;
            }
        }

        if (isFinite(timestampMs)) {
            if (this.firstTs === null || timestampMs < this.firstTs) this.firstTs = timestampMs;
            if (this.lastTs === null || timestampMs > this.lastTs) this.lastTs = timestampMs;
            // Duration of the step that starts at the latest timestamp seen so
            // far, so the span can include the final step's coverage.
            if (this.lastTs === timestampMs) this.lastStepHours = dt;
        }
    }

    /**
     * Data span in hours, from first timestamp to the end of the final step.
     * @returns {number}
     */
    spanHours() {
        if (this.firstTs === null) return 0;
        const rangeHours = (this.lastTs - this.firstTs) / (3600 * 1000);
        return rangeHours + this.lastStepHours;
    }

    /**
     * Derived Phase-5 metrics as a plain, serialisable object.
     * @returns {Object}
     */
    metrics() {
        const spanHours = this.spanHours();
        const spanYears = spanHours > 0 ? spanHours / HOURS_PER_YEAR : 0;

        const perYear = (v) => (spanYears > 0 ? v / spanYears : 0);
        const perCapacity = (v) => (this.capacityKwh > 0 ? v / this.capacityKwh : 0);

        const totalEfc = perCapacity(this.totalDischargedKwh);
        const clippedSteps = this.clippedChargeSteps + this.clippedDischargeSteps;

        return {
            // Totals over the whole run (DC side).
            totalChargedKwh: this.totalChargedKwh,
            totalDischargedKwh: this.totalDischargedKwh,

            // Data span used for annualisation.
            spanHours,
            spanYears,

            // Annualised throughput (headline = discharged energy delivered).
            annualThroughputKwh: perYear(this.totalDischargedKwh),
            annualThroughputChargedKwh: perYear(this.totalChargedKwh),

            // Equivalent full cycles (discharged throughput / usable capacity).
            totalEquivalentFullCycles: totalEfc,
            equivalentFullCycles: perYear(totalEfc),

            // Sizing feedback.
            peakChargeKw: this.peakChargeKw,
            peakDischargeKw: this.peakDischargeKw,
            totalSteps: this.totalSteps,
            activeSteps: this.activeSteps,
            clippedChargeSteps: this.clippedChargeSteps,
            clippedDischargeSteps: this.clippedDischargeSteps,
            clippedSteps,
            clippedPct: this.totalSteps > 0 ? (clippedSteps / this.totalSteps) * 100 : 0,
        };
    }
}

/**
 * Coerce to a finite number, else fall back to a default.
 * @param {*} v
 * @param {number} dflt
 * @returns {number}
 */
function tmNum(v, dflt) {
    return typeof v === 'number' && isFinite(v) ? v : dflt;
}

/**
 * Tolerance for the "reached the power cap" comparison, scaled to the cap so it
 * is robust across quarterly (small) and hourly (large) energies.
 * @param {number} cap
 * @returns {number}
 */
function tmRelTol(cap) {
    return 1e-9 * Math.max(1, Math.abs(cap));
}

// Export for Node (tests) while remaining a browser global.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ThroughputTracker, HOURS_PER_YEAR };
}
