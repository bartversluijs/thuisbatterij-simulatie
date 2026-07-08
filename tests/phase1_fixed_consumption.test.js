/**
 * Phase 1 tests — Fixed / parasitic inverter consumption.
 *
 * Run with:  node tests/phase1_fixed_consumption.test.js
 *
 * No external test framework: a tiny assert harness keeps this dependency-free.
 */

const Battery = require('../js/battery.js');

// custom_data_simulator.js references `Battery` as a global (browser style),
// so expose it before requiring the module.
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

function approx(a, b, tol = 1e-9) {
    return Math.abs(a - b) <= tol;
}

function baseConfig(overrides = {}) {
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

// ---------------------------------------------------------------------------
// 1. Battery.applyFixedConsumption unit behavior
// ---------------------------------------------------------------------------
console.log('Battery.applyFixedConsumption:');

// 1a. Default (no field) is a no-op.
{
    const b = new Battery(baseConfig(), 0.5);
    const socBefore = b.socKwh;
    const r = b.applyFixedConsumption(1.0);
    assert(r.totalKwh === 0 && r.fromBattery === 0 && r.fromGrid === 0,
        'zero fixed consumption returns all-zero draw');
    assert(b.socKwh === socBefore, 'zero fixed consumption does not change SoC');
}

// 1b. Idle battery over N days draws exactly W/1000 * 24 * N and never breaches Min SoC.
{
    const W = 80;
    const days = 30;
    const b = new Battery(baseConfig({ fixedConsumptionW: W }), 1.0); // start full
    const minSocKwh = b.config.capacityKwh * b.config.minSocPct;

    let totalFromBattery = 0;
    let totalFromGrid = 0;
    let breached = false;
    for (let h = 0; h < 24 * days; h++) {
        const r = b.applyFixedConsumption(1.0);
        totalFromBattery += r.fromBattery;
        totalFromGrid += r.fromGrid;
        if (b.socKwh < minSocKwh - 1e-9) breached = true;
    }

    const expectedTotal = (W / 1000) * 24 * days;
    assert(approx(totalFromBattery + totalFromGrid, expectedTotal, 1e-6),
        `total draw over ${days} days == W/1000*24*N (got ${(totalFromBattery + totalFromGrid).toFixed(4)}, expected ${expectedTotal.toFixed(4)})`);
    assert(!breached, 'fixed consumption never pulls SoC below Min SoC');
    assert(approx(b.socKwh, minSocKwh, 1e-9),
        'fully-drained idle battery settles exactly at Min SoC floor');
    assert(totalFromGrid > 0, 'once at the floor, remaining fixed draw comes from the grid');
}

// 1c. Annual fixed loss ≈ W × 8.76 kWh/year.
{
    const W = 60;
    const b = new Battery(baseConfig({ fixedConsumptionW: W, capacityKwh: 1000, minSocPct: 0 }), 1.0);
    let total = 0;
    for (let h = 0; h < 8760; h++) total += b.applyFixedConsumption(1.0).totalKwh;
    assert(approx(total, W * 8.76, 1e-6),
        `annual fixed loss ≈ W × 8.76 (got ${total.toFixed(3)}, expected ${(W * 8.76).toFixed(3)})`);
}

// 1d. Sub-hourly timestep (dt derived, not hardcoded to 1h).
{
    const W = 100;
    const b = new Battery(baseConfig({ fixedConsumptionW: W, minSocPct: 0 }), 1.0);
    const r = b.applyFixedConsumption(0.25); // quarter hour
    assert(approx(r.totalKwh, (W / 1000) * 0.25, 1e-12),
        'quarter-hour timestep scales fixed loss by dt (0.25h)');
}

// ---------------------------------------------------------------------------
// 2. CustomDataSimulator regression + directional effect (fixed contract, greedy)
// ---------------------------------------------------------------------------
console.log('CustomDataSimulator (fixed contract, with battery):');

function makeGridFlow(hours) {
    // Alternating small import/export around zero so the battery mostly idles.
    const data = [];
    const start = new Date('2025-01-01T00:00:00Z').getTime();
    for (let i = 0; i < hours; i++) {
        data.push({
            timestamp: new Date(start + i * 3600 * 1000).toISOString(),
            netGridFlow: (i % 6 === 0) ? 0.2 : (i % 6 === 3 ? -0.2 : 0),
        });
    }
    return data;
}

async function runFixed(fixedW) {
    const cfg = baseConfig({ fixedConsumptionW: fixedW });
    const gridFlow = makeGridFlow(24 * 7); // one week hourly
    const fixedPrice = { buy: 0.30, sell: 0.05 };
    const sim = new CustomDataSimulator(cfg, {}, fixedPrice, gridFlow, [], 60);
    return sim.simulateFixedWithBattery();
}

(async () => {
    const zero = await runFixed(0);
    const withDraw = await runFixed(80);

    // 2a. Regression: zero fixed consumption == pre-change behavior (no fixed loss).
    assert(approx(zero.totalFixedConsumption, 0, 1e-12),
        'zero fixed consumption records no fixed loss');

    // 2b. Directional: nonzero fixed consumption raises cost and import.
    assert(withDraw.totalFixedConsumption > 0, 'nonzero fixed consumption is accumulated');
    assert(withDraw.totalCost > zero.totalCost,
        `fixed consumption increases total cost (zero=${zero.totalCost.toFixed(4)}, withDraw=${withDraw.totalCost.toFixed(4)})`);
    assert(withDraw.totalImport >= zero.totalImport,
        'fixed consumption does not reduce grid import');

    // 2c. Expected magnitude sanity: the grid-supplied portion of the fixed draw
    //     over the week is bounded above by the total fixed energy.
    const weekFixed = (80 / 1000) * 24 * 7;
    assert(approx(withDraw.totalFixedConsumption, weekFixed, 1e-6),
        `total fixed consumption over a week == W/1000*24*7 (got ${withDraw.totalFixedConsumption.toFixed(4)}, expected ${weekFixed.toFixed(4)})`);

    console.log('');
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
})();
