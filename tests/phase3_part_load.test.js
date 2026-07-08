/**
 * Phase 3 tests — Part-load efficiency curve.
 *
 * Run with:  node tests/phase3_part_load.test.js
 *
 * Dependency-free tiny assert harness (same style as the Phase 1/2 suites).
 */

const { partLoadEfficiency } = require('../js/part_load_efficiency.js');
const Battery = require('../js/battery.js');

// custom_data_simulator.js references `Battery` as a global (browser style).
global.Battery = Battery;
const CustomDataSimulator = require('../js/custom_data_simulator.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        passed++;
    } else {
        failed++;
        console.error(`  ✗ FAIL: ${msg}`);
    }
}

function approx(a, b, tol = 1e-12) {
    return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
// 1. partLoadEfficiency — pure curve
// ---------------------------------------------------------------------------
console.log('partLoadEfficiency:');

const NOMINAL = 0.95;

// 1a. Disabled (or missing) config is a no-op → nominal efficiency.
{
    assert(partLoadEfficiency(NOMINAL, 0.2, null) === NOMINAL, 'null config → nominal');
    assert(partLoadEfficiency(NOMINAL, 0.2, { enabled: false, lowPowerEff: 0.5, thresholdKw: 5 }) === NOMINAL,
        'disabled config → nominal');
}

// 1b. Missing / non-positive threshold → no low-power region → nominal.
{
    const cfg = { enabled: true, lowPowerEff: 0.5 };
    assert(partLoadEfficiency(NOMINAL, 0.2, cfg) === NOMINAL, 'undefined threshold → nominal');
    assert(partLoadEfficiency(NOMINAL, 0.2, { ...cfg, thresholdKw: 0 }) === NOMINAL, 'zero threshold → nominal');
}

// 1c. At/above the threshold the nominal efficiency applies (curve inactive region).
{
    const cfg = { enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: false };
    assert(partLoadEfficiency(NOMINAL, 2.0, cfg) === NOMINAL, 'power == threshold → nominal');
    assert(partLoadEfficiency(NOMINAL, 5.0, cfg) === NOMINAL, 'power > threshold → nominal');
}

// 1d. Below the threshold, step mode uses the flat low-power efficiency.
{
    const cfg = { enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: false };
    assert(partLoadEfficiency(NOMINAL, 0.5, cfg) === 0.80, 'below threshold (step) → lowPowerEff');
    assert(partLoadEfficiency(NOMINAL, 1.999, cfg) === 0.80, 'just below threshold (step) → lowPowerEff');
}

// 1e. Below the threshold, interpolate ramps linearly lowPowerEff→nominal.
{
    const cfg = { enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: true };
    // Midpoint (P = 1.0 kW, half the threshold): halfway between 0.80 and 0.95.
    assert(approx(partLoadEfficiency(NOMINAL, 1.0, cfg), 0.80 + (0.95 - 0.80) * 0.5),
        'interpolate midpoint = halfway between low and nominal');
    // Approaching 0 kW → approaches lowPowerEff.
    assert(approx(partLoadEfficiency(NOMINAL, 0.0, cfg), 0.80), 'interpolate at 0 kW → lowPowerEff');
    // Approaching the threshold → approaches nominal (continuous, no jump).
    assert(approx(partLoadEfficiency(NOMINAL, 2.0, cfg), NOMINAL), 'interpolate at threshold → nominal (continuous)');
}

// 1f. Penalty model: a misconfigured lowPowerEff above nominal never *raises* efficiency.
{
    const cfg = { enabled: true, lowPowerEff: 0.99, thresholdKw: 2.0, interpolate: false };
    assert(partLoadEfficiency(0.90, 0.5, cfg) === 0.90, 'lowPowerEff > nominal is clamped to nominal (penalty only)');
}

// 1g. Sign of power is ignored (charge vs discharge symmetry).
{
    const cfg = { enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: false };
    assert(partLoadEfficiency(NOMINAL, -0.5, cfg) === 0.80, 'negative power magnitude used');
}

// ---------------------------------------------------------------------------
// 2. Battery integration — per-timestep power drives the applied efficiency
// ---------------------------------------------------------------------------
console.log('Battery (part-load applied per timestep):');

function battConfig(overrides = {}) {
    return Object.assign({
        capacityKwh: 10,
        chargePowerKw: 5,
        dischargePowerKw: 5,
        chargeEfficiency: 0.95,
        dischargeEfficiency: 0.95,
        minSocPct: 0.1,
        maxSocPct: 1.0,
    }, overrides);
}

// 2a. Disabled part-load reproduces the flat-efficiency AC figures exactly (regression).
{
    const flat = new Battery(battConfig(), 0.5);
    const [, acFlat] = flat.discharge(1.0, 1.0);       // 1 kW for 1 h → dc = 1 kWh
    assert(approx(acFlat, 1.0 * 0.95), 'flat discharge AC = dc × nominal (no part-load)');

    const off = new Battery(battConfig({ partLoad: { enabled: false, lowPowerEff: 0.5, thresholdKw: 5 } }), 0.5);
    const [, acOff] = off.discharge(1.0, 1.0);
    assert(approx(acOff, acFlat), 'disabled part-load identical to flat model');
}

// 2b. Low-power discharge (below threshold) delivers less AC than the flat model.
{
    const pl = { enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: false };
    const batt = new Battery(battConfig({ partLoad: pl }), 0.5);
    const [dc, ac] = batt.discharge(1.0, 1.0);          // 1 kW < 2 kW threshold
    assert(approx(dc, 1.0), 'dc energy unaffected by efficiency curve');
    assert(approx(ac, 1.0 * 0.80), 'low-power discharge uses lowPowerEff (0.80), not nominal (0.95)');
}

// 2c. Low-power charge draws more AC from the grid than the flat model.
{
    const pl = { enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: false };
    const batt = new Battery(battConfig({ partLoad: pl }), 0.5);
    const [dc, ac] = batt.charge(1.0, 1.0);             // 1 kW < 2 kW threshold
    assert(approx(dc, 1.0), 'dc stored unaffected by efficiency curve');
    assert(approx(ac, 1.0 / 0.80), 'low-power charge draws dc / lowPowerEff from grid');
}

// 2d. High-power discharge (above threshold) still uses the nominal efficiency.
{
    const pl = { enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: false };
    const batt = new Battery(battConfig({ partLoad: pl }), 0.9);
    const [dc, ac] = batt.discharge(3.0, 1.0);          // 3 kW > 2 kW threshold
    assert(approx(ac, dc * 0.95), 'above-threshold discharge uses nominal efficiency');
}

// ---------------------------------------------------------------------------
// 3. Simulator integration — directional cost effect over a full run
// ---------------------------------------------------------------------------
console.log('CustomDataSimulator (part-load vs flat over a run):');

function simConfig(overrides = {}) {
    return Object.assign({
        capacityKwh: 10,
        chargePowerKw: 5,
        dischargePowerKw: 5,
        chargeEfficiency: 0.95,
        dischargeEfficiency: 0.95,
        minSocPct: 0.1,
        maxSocPct: 1.0,
        initialSocPct: 0.5,
    }, overrides);
}

function makeLowPowerGridFlow(hours) {
    // Alternating low-power (±1 kW) import/export so every timestep operates
    // below a 2 kW part-load threshold — the region the curve penalises.
    const data = [];
    const start = new Date('2025-01-01T00:00:00Z').getTime();
    for (let i = 0; i < hours; i++) {
        data.push({
            timestamp: new Date(start + i * 3600 * 1000).toISOString(),
            netGridFlow: (i % 4 < 2) ? 1.0 : -1.0,
        });
    }
    return data;
}

async function runSim(partLoad) {
    const cfg = simConfig(partLoad ? { partLoad } : {});
    const gridFlow = makeLowPowerGridFlow(24 * 7);
    const fixedPrice = { buy: 0.30, sell: 0.05 };
    const sim = new CustomDataSimulator(cfg, {}, fixedPrice, gridFlow, [], 60);
    return sim.simulateFixedWithBattery();
}

(async () => {
    // 3a. Disabled part-load reproduces the flat (Phase-2) result exactly.
    const flat = await runSim(null);
    const disabled = await runSim({ enabled: false, lowPowerEff: 0.5, thresholdKw: 5 });
    assert(approx(flat.totalCost, disabled.totalCost, 1e-9),
        'part-load disabled reproduces the flat-efficiency run exactly');

    // 3b. A low-power penalty raises total cost vs the flat model over the same profile.
    const penalised = await runSim({ enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: false });
    assert(penalised.totalCost > flat.totalCost,
        `low-power part-load penalty increases cost (penalised=${penalised.totalCost.toFixed(4)}, flat=${flat.totalCost.toFixed(4)})`);

    // 3c. Interpolated curve sits between flat and the harsher step penalty
    //     (it only bites hardest near 0 kW, easing toward the threshold).
    const interpolated = await runSim({ enabled: true, lowPowerEff: 0.80, thresholdKw: 2.0, interpolate: true });
    assert(interpolated.totalCost > flat.totalCost && interpolated.totalCost < penalised.totalCost,
        `interpolated penalty is milder than the step penalty (interp=${interpolated.totalCost.toFixed(4)}, step=${penalised.totalCost.toFixed(4)})`);

    console.log('');
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
})();
