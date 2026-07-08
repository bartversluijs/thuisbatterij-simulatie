/**
 * Resolve the Phase-3 part-load efficiency function, whether running in the
 * browser (loaded as a global before this script) or in Node (required).
 * Resolved lazily so browser script order does not matter.
 * @returns {Function|null}
 */
function _resolvePartLoadFn() {
    if (typeof partLoadEfficiency !== 'undefined') return partLoadEfficiency; // browser global
    if (typeof require !== 'undefined') {
        try { return require('./part_load_efficiency.js').partLoadEfficiency; } catch (e) { /* optional */ }
    }
    return null;
}

/**
 * Battery class - simulates battery charge/discharge with efficiency
 * Direct port from Python implementation
 */
class Battery {
    /**
     * @param {Object} config - Battery configuration
     * @param {number} config.capacityKwh - Battery capacity in kWh
     * @param {number} config.chargePowerKw - Max charge power in kW (DC)
     * @param {number} config.dischargePowerKw - Max discharge power in kW (DC)
     * @param {number} config.chargeEfficiency - Charge efficiency (0-1)
     * @param {number} config.dischargeEfficiency - Discharge efficiency (0-1)
     * @param {number} config.minSocPct - Minimum SoC percentage (0-1)
     * @param {number} config.maxSocPct - Maximum SoC percentage (0-1)
     * @param {number} [config.fixedConsumptionW] - Fixed inverter/system consumption in Watts (Phase 1). Default 0 (no-op).
     * @param {Object} [config.partLoad] - Part-load efficiency curve (Phase 3). Default null/disabled (no-op).
     * @param {number} initialSocPct - Initial State of Charge (0-1)
     */
    constructor(config, initialSocPct = 0.5) {
        this.config = config;
        this.socKwh = config.capacityKwh * initialSocPct;
        // Fixed parasitic draw (Watts). Defaults to 0 so existing configs are unchanged.
        this.fixedConsumptionW = config.fixedConsumptionW || 0;
        // Part-load efficiency curve (Phase 3). Null/disabled → flat efficiency (backward compatible).
        this.partLoad = config.partLoad || null;
    }

    /**
     * Effective per-direction efficiency for a single timestep (Phase 3).
     *
     * With the part-load curve disabled (default) this returns the nominal flat
     * efficiency unchanged, so results are byte-identical to pre-Phase-3 runs.
     * When enabled, the efficiency depends on the instantaneous DC power moved
     * this timestep (energy / duration), penalising low-power operation.
     *
     * @param {number} nominalEff - Flat per-direction efficiency (fraction 0-1).
     * @param {number} dcEnergyKwh - DC energy moved this timestep (kWh).
     * @param {number} durationHours - Timestep duration in hours.
     * @returns {number} Effective efficiency (fraction 0-1) for this timestep.
     */
    _effectiveEff(nominalEff, dcEnergyKwh, durationHours) {
        if (!this.partLoad || !this.partLoad.enabled) return nominalEff;
        const fn = _resolvePartLoadFn();
        if (!fn) return nominalEff;
        const powerKw = durationHours > 0 ? dcEnergyKwh / durationHours : 0;
        return fn(nominalEff, powerKw, this.partLoad);
    }

    /**
     * Get State of Charge as percentage
     * @returns {number} SoC percentage (0-100)
     */
    get socPct() {
        return (this.socKwh / this.config.capacityKwh) * 100;
    }

    /**
     * Charge battery with given energy
     * @param {number} energyKwh - DC energy to charge (kWh)
     * @param {number} durationHours - Duration in hours (default 1.0)
     * @returns {Array<number>} [dcToBattery, acFromGrid] - DC energy stored and AC energy taken from grid
     */
    charge(energyKwh, durationHours = 1.0) {
        // Maximum power limit (DC)
        const maxDcPowerKwh = this.config.chargePowerKw * durationHours;

        // Maximum SoC limit
        const maxSocKwh = this.config.capacityKwh * this.config.maxSocPct;
        const availableCapacity = maxSocKwh - this.socKwh;

        // Actual DC energy to battery (limited by power, capacity, and requested energy)
        const dcToBattery = Math.min(energyKwh, maxDcPowerKwh, availableCapacity);

        // AC energy from grid = DC to battery / efficiency.
        // Phase 3: efficiency may depend on this timestep's instantaneous DC power.
        const chargeEff = this._effectiveEff(this.config.chargeEfficiency, dcToBattery, durationHours);
        const acFromGrid = dcToBattery / chargeEff;

        // Update SoC
        this.socKwh += dcToBattery;

        return [dcToBattery, acFromGrid];
    }

    /**
     * Discharge battery for given energy
     * @param {number} energyKwh - DC energy to discharge (kWh)
     * @param {number} durationHours - Duration in hours (default 1.0)
     * @returns {Array<number>} [dcFromBattery, acToGrid] - DC energy taken from battery and AC energy to grid
     */
    discharge(energyKwh, durationHours = 1.0) {
        // Maximum power limit (DC)
        const maxDcPowerKwh = this.config.dischargePowerKw * durationHours;

        // Minimum SoC limit
        const minSocKwh = this.config.capacityKwh * this.config.minSocPct;
        const availableEnergy = this.socKwh - minSocKwh;

        // Actual DC energy from battery (limited by power, available energy, and requested energy)
        const dcFromBattery = Math.min(energyKwh, maxDcPowerKwh, availableEnergy);

        // AC energy to grid = DC from battery × efficiency.
        // Phase 3: efficiency may depend on this timestep's instantaneous DC power.
        const dischargeEff = this._effectiveEff(this.config.dischargeEfficiency, dcFromBattery, durationHours);
        const acToGrid = dcFromBattery * dischargeEff;

        // Update SoC
        this.socKwh -= dcFromBattery;

        return [dcFromBattery, acToGrid];
    }

    /**
     * Apply fixed inverter/system parasitic consumption for one timestep (Phase 1).
     *
     * This models the roughly constant idle/operating power the inverter draws
     * whenever it is powered on (~40-100 W for a 3-phase hybrid). It is a
     * continuous drain that does NOT scale with throughput, so it is kept
     * separate from round-trip efficiency.
     *
     * Documented draw-source rule (a fixed behavioral constant for now):
     *   - Drawn from the battery while SoC is above Min SoC.
     *   - The remaining shortfall is supplied by the grid (the caller accounts
     *     for it as extra import / reduced export at the buy price).
     *   - It can never pull SoC below Min SoC — at the floor it switches fully
     *     to grid supply.
     *
     * @param {number} durationHours - Timestep duration in hours (derive from data; do not hardcode).
     * @returns {{fromBattery: number, fromGrid: number, totalKwh: number}}
     *   Energy (kWh) taken from the battery and the grid shortfall this timestep.
     */
    applyFixedConsumption(durationHours = 1.0) {
        const totalKwh = (this.fixedConsumptionW / 1000) * durationHours;

        if (totalKwh <= 0) {
            return { fromBattery: 0, fromGrid: 0, totalKwh: 0 };
        }

        // Energy available above the Min SoC floor
        const minSocKwh = this.config.capacityKwh * this.config.minSocPct;
        const availableEnergy = Math.max(0, this.socKwh - minSocKwh);

        const fromBattery = Math.min(totalKwh, availableEnergy);
        this.socKwh -= fromBattery;

        const fromGrid = totalKwh - fromBattery;

        return { fromBattery, fromGrid, totalKwh };
    }

    /**
     * Reset battery to initial state
     * @param {number} initialSocPct - Initial SoC percentage (0-1)
     */
    reset(initialSocPct = 0.5) {
        this.socKwh = this.config.capacityKwh * initialSocPct;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Battery;
}
