/**
 * Efficiency stages (Phase 2) — separate inverter efficiency from battery efficiency.
 *
 * The rest of the simulator only ever consumes two numbers: a combined
 * per-direction `chargeEfficiency` and `dischargeEfficiency`. Phase 2 does NOT
 * change the physics model; it only changes how those two numbers are produced:
 *
 *   - "combined" mode (default): the user enters the two combined efficiencies
 *     directly, exactly like before Phase 2. Pure passthrough → backward compatible.
 *
 *   - "staged" mode: the user enters four physically-distinct stages, and each
 *     direction is the product of its two multiplicative stages:
 *         chargeEfficiency    = battery_charge_eff    × inverter_charge_eff
 *         dischargeEfficiency = battery_discharge_eff × inverter_discharge_eff
 *     This lets battery (DC-DC / cell + BMS) and inverter (AC↔DC conversion)
 *     losses move independently, e.g. when comparing inverters or LV/HV systems.
 *
 * Keeping the split at config-resolution time means the Battery class,
 * simulators and optimizers stay untouched — the loss chain remains auditable
 * as grid/PV → inverter → battery → inverter → load.
 */

/**
 * Resolve the effective combined per-direction efficiency from either the
 * combined (2-field) inputs or the staged (4-field battery×inverter) inputs.
 *
 * All efficiencies are fractions in (0, 1]. This is a pure function (no DOM)
 * so it can be unit-tested directly.
 *
 * @param {Object} input
 * @param {string} [input.efficiencyMode] - 'combined' (default) or 'staged'.
 * @param {number} [input.chargeEfficiency] - Combined charge efficiency (combined mode).
 * @param {number} [input.dischargeEfficiency] - Combined discharge efficiency (combined mode).
 * @param {number} [input.batteryChargeEff] - Battery (DC-DC/cell) charge stage (staged mode).
 * @param {number} [input.batteryDischargeEff] - Battery discharge stage (staged mode).
 * @param {number} [input.inverterChargeEff] - Inverter (AC↔DC) charge stage (staged mode).
 * @param {number} [input.inverterDischargeEff] - Inverter discharge stage (staged mode).
 * @returns {{efficiencyMode: string, chargeEfficiency: number, dischargeEfficiency: number}}
 */
function resolveEfficiency(input) {
    const mode = input && input.efficiencyMode === 'staged' ? 'staged' : 'combined';

    if (mode === 'staged') {
        // Multiplicative loss chain per direction: battery stage × inverter stage.
        return {
            efficiencyMode: 'staged',
            chargeEfficiency: input.batteryChargeEff * input.inverterChargeEff,
            dischargeEfficiency: input.batteryDischargeEff * input.inverterDischargeEff,
        };
    }

    // Combined mode: pass the two legacy fields straight through (no-op).
    return {
        efficiencyMode: 'combined',
        chargeEfficiency: input.chargeEfficiency,
        dischargeEfficiency: input.dischargeEfficiency,
    };
}

/**
 * Browser helper: read the staged-efficiency UI (if present) and return the
 * effective combined efficiencies to feed into batteryConfig.
 *
 * When the staged toggle is absent or unchecked, this returns the supplied
 * combined values unchanged, so pages without the Phase-2 UI (and untouched
 * configs) behave exactly as before.
 *
 * @param {number} combinedChargeEff - Combined charge efficiency from the basic field (fraction 0-1).
 * @param {number} combinedDischargeEff - Combined discharge efficiency from the basic field (fraction 0-1).
 * @returns {{efficiencyMode: string, chargeEfficiency: number, dischargeEfficiency: number}}
 */
function readStagedEfficiency(combinedChargeEff, combinedDischargeEff) {
    const passthrough = {
        efficiencyMode: 'combined',
        chargeEfficiency: combinedChargeEff,
        dischargeEfficiency: combinedDischargeEff,
    };

    if (typeof document === 'undefined') return passthrough;

    const toggle = document.getElementById('efficiencyStaged');
    if (!toggle || !toggle.checked) return passthrough;

    // Percentage field → fraction, tolerant of the Dutch decimal comma.
    const pct = (id) => {
        const el = document.getElementById(id);
        if (!el) return NaN;
        return parseFloat((el.value || '').toString().replace(',', '.')) / 100;
    };

    return resolveEfficiency({
        efficiencyMode: 'staged',
        batteryChargeEff: pct('batteryChargeEff'),
        batteryDischargeEff: pct('batteryDischargeEff'),
        inverterChargeEff: pct('inverterChargeEff'),
        inverterDischargeEff: pct('inverterDischargeEff'),
    });
}

/**
 * Browser helper: wire the "split efficiency" toggle so the four stage fields
 * appear only when staged mode is on, and the two combined fields are disabled
 * while staged (they are ignored in that mode, so disabling avoids confusion).
 * Safe to call on pages without the staged UI (it no-ops).
 */
function initEfficiencyStagedToggle() {
    if (typeof document === 'undefined') return;

    const toggle = document.getElementById('efficiencyStaged');
    if (!toggle) return;

    const stagedFields = document.getElementById('stagedEffFields');
    const combinedCharge = document.getElementById('chargeEff');
    const combinedDischarge = document.getElementById('dischargeEff');

    const apply = () => {
        const on = toggle.checked;
        if (stagedFields) stagedFields.style.display = on ? '' : 'none';
        // Combined fields are unused in staged mode; disabling also drops them
        // from HTML5 required-validation and from FormData while staged.
        if (combinedCharge) combinedCharge.disabled = on;
        if (combinedDischarge) combinedDischarge.disabled = on;
    };

    toggle.addEventListener('change', apply);
    apply();
}

// Export for use in other modules (Node tests) while remaining a browser global.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveEfficiency, readStagedEfficiency, initEfficiencyStagedToggle };
}
