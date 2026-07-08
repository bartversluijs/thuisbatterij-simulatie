/**
 * Capacity degradation over lifetime (Phase 4).
 *
 * Payback is computed over 10–15 years, but usable capacity is not constant: an
 * LFP pack fades toward its end-of-life threshold (commonly ~70–80 % of nominal
 * after the warranted cycle count). Ignoring this overstates late-year savings.
 *
 * This module models degradation as a reduction of *usable capacity*. It does
 * NOT touch the physics of a single timestep — like Phase 2/3 it plugs in at
 * config-resolution time, producing an effective `capacityKwh` that the Battery
 * and simulators consume unchanged. That keeps the loss chain auditable and the
 * whole feature a no-op when disabled.
 *
 * Because the simulator runs a single year of data, a single run cannot span the
 * whole lifetime. Following PLAN.md Phase 4 ("apply the midpoint-of-life
 * capacity"), the simulation uses the *average usable capacity over the analysis
 * horizon* — a representative single figure for a typical year of that lifetime.
 * For linear fade this equals the capacity at the midpoint of life; the average
 * form also handles the end-of-life floor and optional compounding correctly.
 *
 * Two rate bases (PLAN.md):
 *   - per_year:  a fraction of capacity lost per calendar year.
 *   - per_cycle: a fraction lost per equivalent full cycle. A single-year run has
 *     no lifetime cycle count of its own, so this uses an estimated
 *     `cyclesPerYear` × age to derive cumulative cycles. (Phase 5's cycle counter
 *     can later supply a measured cyclesPerYear.)
 *
 * Fade is linear by default (2 %/yr over 10 yr → 20 % loss), matching the common
 * warranty framing; `compounding` is available for callers that prefer it.
 * Capacity is always clamped to `floor` and never exceeds nominal (1.0).
 *
 * Backward compatible: mode 'none' (the default) returns fraction 1.0, so an
 * untouched config reproduces the pre-Phase-4 result exactly.
 */

/**
 * Normalise a raw degradation config to canonical fields with sane defaults.
 * All rates/fractions are unitless fractions in [0, 1]. Pure (no DOM).
 *
 * @param {Object} [input]
 * @param {string} [input.mode] - 'none' | 'per_year' | 'per_cycle'. Default 'none'.
 * @param {number} [input.ratePerYear] - Fraction of capacity lost per year (per_year mode).
 * @param {number} [input.ratePerCycle] - Fraction lost per equivalent full cycle (per_cycle mode).
 * @param {number} [input.cyclesPerYear] - Estimated equivalent full cycles per year (per_cycle mode).
 * @param {number} [input.floor] - End-of-life capacity fraction; capacity is clamped here. Default 0.70.
 * @param {number} [input.horizonYears] - Analysis horizon in years (for the representative average). Default 15.
 * @param {boolean} [input.compounding] - Compound the fade instead of linear. Default false (linear).
 * @returns {{mode:string, ratePerYear:number, ratePerCycle:number, cyclesPerYear:number, floor:number, horizonYears:number, compounding:boolean}}
 */
function resolveDegradation(input) {
    const mode = input && (input.mode === 'per_year' || input.mode === 'per_cycle')
        ? input.mode
        : 'none';

    const num = (v, dflt) => (typeof v === 'number' && isFinite(v) ? v : dflt);

    return {
        mode,
        ratePerYear: Math.max(0, num(input && input.ratePerYear, 0)),
        ratePerCycle: Math.max(0, num(input && input.ratePerCycle, 0)),
        cyclesPerYear: Math.max(0, num(input && input.cyclesPerYear, 0)),
        // Floor clamped to a sane [0, 1]; default 70 % end-of-life.
        floor: Math.min(1, Math.max(0, num(input && input.floor, 0.70))),
        horizonYears: Math.max(0, num(input && input.horizonYears, 15)),
        compounding: !!(input && input.compounding),
    };
}

/**
 * Remaining usable-capacity fraction (0-1) at a given age.
 *
 * @param {Object} config - A raw or resolved degradation config.
 * @param {number} ageYears - Age in years (>= 0).
 * @returns {number} Capacity fraction, clamped to [floor, 1].
 */
function capacityFractionAtAge(config, ageYears) {
    const c = resolveDegradation(config);
    if (c.mode === 'none') return 1;

    const age = Math.max(0, ageYears);

    let frac;
    if (c.mode === 'per_cycle') {
        const cycles = c.cyclesPerYear * age;
        frac = c.compounding
            ? Math.pow(1 - c.ratePerCycle, cycles)
            : 1 - c.ratePerCycle * cycles;
    } else { // per_year
        frac = c.compounding
            ? Math.pow(1 - c.ratePerYear, age)
            : 1 - c.ratePerYear * age;
    }

    // Never below the end-of-life floor, never above nominal.
    return Math.min(1, Math.max(c.floor, frac));
}

/**
 * Average usable-capacity fraction over the analysis horizon [0, horizon].
 *
 * This is the representative capacity for a single-year simulation of a
 * multi-year lifetime. For linear fade it equals the midpoint-of-life capacity;
 * computed by midpoint-rule sampling so the floor clamp and compounding are
 * handled exactly enough.
 *
 * @param {Object} config - A raw or resolved degradation config.
 * @param {number} [horizonYears] - Override the config horizon.
 * @returns {number} Mean capacity fraction over the horizon, in [floor, 1].
 */
function averageCapacityFraction(config, horizonYears) {
    const c = resolveDegradation(config);
    if (c.mode === 'none') return 1;

    const horizon = horizonYears != null ? Math.max(0, horizonYears) : c.horizonYears;
    if (horizon <= 0) return capacityFractionAtAge(c, 0);

    // Monthly midpoint sampling over the horizon → mean full-year capacity.
    const steps = Math.max(1, Math.round(horizon * 12));
    const dt = horizon / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
        sum += capacityFractionAtAge(c, (i + 0.5) * dt);
    }
    return sum / steps;
}

/**
 * Effective (representative) usable capacity in kWh for a single-year run.
 *
 * @param {number} nominalKwh - Nominal battery capacity (kWh).
 * @param {Object} config - A raw or resolved degradation config.
 * @returns {number} Degraded capacity in kWh (== nominalKwh when disabled).
 */
function effectiveCapacityKwh(nominalKwh, config) {
    return nominalKwh * averageCapacityFraction(config);
}

/**
 * Browser helper: read the degradation UI (if present) into a config object.
 *
 * When the control is absent or set to "none", returns `{ mode: 'none' }` so
 * pages without the Phase-4 UI (and untouched configs) behave exactly as before.
 *
 * @returns {{mode:string, ratePerYear?:number, ratePerCycle?:number, cyclesPerYear?:number, floor?:number, horizonYears?:number}}
 */
function readDegradationConfig() {
    const disabled = { mode: 'none' };

    if (typeof document === 'undefined') return disabled;

    const modeEl = document.getElementById('degradationMode');
    if (!modeEl) return disabled;
    const mode = modeEl.value;
    if (mode !== 'per_year' && mode !== 'per_cycle') return disabled;

    // Number field, tolerant of the Dutch decimal comma.
    const num = (id) => {
        const el = document.getElementById(id);
        if (!el) return NaN;
        return parseFloat((el.value || '').toString().replace(',', '.'));
    };

    return {
        mode,
        ratePerYear: num('degradationRateYear') / 100,   // %/yr → fraction
        ratePerCycle: num('degradationRateCycle') / 100, // %/cycle → fraction
        cyclesPerYear: num('degradationCyclesPerYear'),
        floor: num('degradationFloor') / 100,            // % → fraction
        horizonYears: num('degradationHorizon'),
    };
}

/**
 * Browser helper: wire the degradation UI so the relevant fields appear only for
 * the selected mode, and keep a live hint showing the resulting average and
 * end-of-life capacity (a cheap self-check per PLAN design principle 4).
 * Safe to call on pages without the UI (no-ops).
 */
function initDegradationToggle() {
    if (typeof document === 'undefined') return;

    const modeEl = document.getElementById('degradationMode');
    if (!modeEl) return;

    const fields = document.getElementById('degradationFields');
    const perYearField = document.getElementById('degradationPerYearField');
    const perCycleFields = document.getElementById('degradationPerCycleFields');
    const hint = document.getElementById('degradationHint');
    const capacityEl = document.getElementById('capacity');

    const fmt = (n, d = 0) => n.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });

    const updateHint = () => {
        if (!hint) return;
        const cfg = readDegradationConfig();
        if (cfg.mode === 'none') { hint.textContent = ''; return; }

        const avg = averageCapacityFraction(cfg);
        const eol = capacityFractionAtAge(cfg, cfg.horizonYears);
        let text = `Gemiddelde bruikbare capaciteit ≈ ${fmt(avg * 100, 0)}% over ${fmt(cfg.horizonYears)} jaar; `
            + `einde horizon ≈ ${fmt(eol * 100, 0)}% (ondergrens ${fmt(cfg.floor * 100, 0)}%).`;
        const nominal = capacityEl ? parseFloat((capacityEl.value || '').replace(',', '.')) : NaN;
        if (isFinite(nominal)) {
            text += ` Simulatie gebruikt ≈ ${fmt(nominal * avg, 1)} kWh i.p.v. ${fmt(nominal, 1)} kWh.`;
        }
        hint.textContent = text;
    };

    const apply = () => {
        const mode = modeEl.value;
        const on = mode === 'per_year' || mode === 'per_cycle';
        if (fields) fields.style.display = on ? '' : 'none';
        if (perYearField) perYearField.style.display = mode === 'per_year' ? '' : 'none';
        if (perCycleFields) perCycleFields.style.display = mode === 'per_cycle' ? '' : 'none';
        updateHint();
    };

    modeEl.addEventListener('change', apply);
    ['degradationRateYear', 'degradationRateCycle', 'degradationCyclesPerYear',
        'degradationFloor', 'degradationHorizon', 'capacity'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateHint);
    });
    apply();
}

// Export for use in other modules (Node tests) while remaining a browser global.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        resolveDegradation,
        capacityFractionAtAge,
        averageCapacityFraction,
        effectiveCapacityKwh,
        readDegradationConfig,
        initDegradationToggle,
    };
}
