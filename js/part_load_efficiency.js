/**
 * Part-load efficiency curve (Phase 3).
 *
 * A real inverter is NOT equally efficient at every output level: efficiency
 * drops significantly at low power (a few hundred W) relative to near-nominal
 * load. Residential evening base loads are often served at low power — exactly
 * where efficiency is worst — so a single flat efficiency number systematically
 * *overestimates* real-world performance for low-power charge/discharge.
 *
 * This module models the "Simple" variant from PLAN.md Phase 3: two anchor
 * points — a `lowPowerEff` applied below a `thresholdKw`, and the nominal
 * (flat) efficiency at/above it. When `interpolate` is on, the efficiency ramps
 * linearly from `lowPowerEff` at 0 kW to the nominal value at the threshold,
 * avoiding a hard discontinuity at the boundary.
 *
 * Like Phase 2, the physics model is untouched: the Battery still consumes a
 * single per-direction efficiency each timestep. Phase 3 only makes that number
 * power-dependent instead of constant. The curve is a *penalty* model — it can
 * never raise the effective efficiency above the nominal value — so enabling it
 * can only reduce yield, never inflate it.
 *
 * Backward compatible: with the feature disabled (the default), or with no valid
 * threshold, `partLoadEfficiency` returns the nominal efficiency unchanged, so
 * existing configs produce identical results.
 */

/**
 * Effective per-direction efficiency for a single timestep, given the
 * instantaneous (DC) power moved during that step.
 *
 * Pure function (no DOM) so it can be unit-tested directly.
 *
 * @param {number} nominalEff - Flat per-direction efficiency (fraction 0-1) that
 *   applies at/above the threshold. This is whatever the rest of the model would
 *   have used without Phase 3 (combined field, or the Phase-2 staged product).
 * @param {number} powerKw - Instantaneous DC power for this timestep in kW
 *   (energy moved / timestep duration). Sign is ignored.
 * @param {Object} [config] - Part-load configuration.
 * @param {boolean} [config.enabled] - Master switch. When falsy → no-op.
 * @param {number} [config.lowPowerEff] - Efficiency (fraction 0-1) applied below the threshold.
 * @param {number} [config.thresholdKw] - Power (kW) below which the low-power efficiency applies.
 * @param {boolean} [config.interpolate] - Linearly ramp from lowPowerEff (at 0 kW)
 *   to nominalEff (at thresholdKw) instead of a hard step.
 * @returns {number} Effective efficiency (fraction 0-1) for this timestep.
 */
function partLoadEfficiency(nominalEff, powerKw, config) {
    if (!config || !config.enabled) return nominalEff;

    const threshold = config.thresholdKw;
    // Without a positive threshold there is no low-power region to model.
    if (!(threshold > 0)) return nominalEff;

    const p = Math.abs(powerKw);
    if (p >= threshold) return nominalEff;

    const low = config.lowPowerEff;
    let eff;
    if (config.interpolate) {
        // Anchor points: lowPowerEff at P=0, nominalEff at P=threshold.
        const frac = p / threshold; // 0..1 in the low-power region
        eff = low + (nominalEff - low) * frac;
    } else {
        // Hard step: flat low-power efficiency everywhere below the threshold.
        eff = low;
    }

    // The curve is a penalty model: it may only lower efficiency, never raise it
    // above nominal (guards against a misconfigured lowPowerEff > nominalEff).
    return Math.min(nominalEff, eff);
}

/**
 * Browser helper: read the part-load UI (if present) into a config object.
 *
 * When the toggle is absent or unchecked, returns `{ enabled: false }` so pages
 * without the Phase-3 UI (and untouched configs) behave exactly as before.
 *
 * @returns {{enabled: boolean, lowPowerEff?: number, thresholdKw?: number, interpolate?: boolean}}
 */
function readPartLoadConfig() {
    const disabled = { enabled: false };

    if (typeof document === 'undefined') return disabled;

    const toggle = document.getElementById('partLoadEnabled');
    if (!toggle || !toggle.checked) return disabled;

    // Number field, tolerant of the Dutch decimal comma.
    const num = (id) => {
        const el = document.getElementById(id);
        if (!el) return NaN;
        return parseFloat((el.value || '').toString().replace(',', '.'));
    };

    const interpEl = document.getElementById('partLoadInterpolate');

    return {
        enabled: true,
        lowPowerEff: num('lowPowerEff') / 100, // percentage field → fraction
        thresholdKw: num('lowPowerThresholdKw'),
        interpolate: interpEl ? interpEl.checked : true,
    };
}

/**
 * Browser helper: wire the "part-load efficiency" toggle so its fields appear
 * only when the feature is on. Safe to call on pages without the UI (no-ops).
 */
function initPartLoadToggle() {
    if (typeof document === 'undefined') return;

    const toggle = document.getElementById('partLoadEnabled');
    if (!toggle) return;

    const fields = document.getElementById('partLoadFields');

    const apply = () => {
        if (fields) fields.style.display = toggle.checked ? '' : 'none';
    };

    toggle.addEventListener('change', apply);
    apply();
}

// Export for use in other modules (Node tests) while remaining a browser global.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { partLoadEfficiency, readPartLoadConfig, initPartLoadToggle };
}
