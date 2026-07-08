/**
 * Phase 2 tests — Separate inverter efficiency from battery efficiency.
 *
 * Run with:  node tests/phase2_efficiency_split.test.js
 *
 * Dependency-free tiny assert harness (same style as the Phase 1 suite).
 */

const { resolveEfficiency } = require('../js/efficiency_stages.js');
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
// 1. resolveEfficiency — pure derivation
// ---------------------------------------------------------------------------
console.log('resolveEfficiency:');

// 1a. Combined mode (default) is a pure passthrough of the two legacy fields.
{
    const r = resolveEfficiency({ chargeEfficiency: 0.89, dischargeEfficiency: 0.9 });
    assert(r.efficiencyMode === 'combined', 'default mode is combined');
    assert(r.chargeEfficiency === 0.89 && r.dischargeEfficiency === 0.9,
        'combined mode passes the two legacy efficiencies through unchanged');
}

// 1b. Explicit combined mode behaves identically (backward compatibility).
{
    const r = resolveEfficiency({
        efficiencyMode: 'combined',
        chargeEfficiency: 0.95, dischargeEfficiency: 0.93,
        // staged fields present but must be ignored in combined mode
        batteryChargeEff: 0.5, inverterChargeEff: 0.5,
    });
    assert(r.chargeEfficiency === 0.95 && r.dischargeEfficiency === 0.93,
        'combined mode ignores staged fields');
}

// 1c. Staged mode multiplies battery × inverter per direction.
{
    const r = resolveEfficiency({
        efficiencyMode: 'staged',
        batteryChargeEff: 0.98, inverterChargeEff: 0.97,
        batteryDischargeEff: 0.98, inverterDischargeEff: 0.96,
    });
    assert(r.efficiencyMode === 'staged', 'staged mode reported');
    assert(approx(r.chargeEfficiency, 0.98 * 0.97), 'staged charge = battery × inverter');
    assert(approx(r.dischargeEfficiency, 0.98 * 0.96), 'staged discharge = battery × inverter');
}

// 1d. Staged with battery = 100% reduces to a pure inverter model.
{
    const X = 0.94;
    const r = resolveEfficiency({
        efficiencyMode: 'staged',
        batteryChargeEff: 1.0, inverterChargeEff: X,
        batteryDischargeEff: 1.0, inverterDischargeEff: X,
    });
    assert(approx(r.chargeEfficiency, X) && approx(r.dischargeEfficiency, X),
        'battery = 100% → effective efficiency equals the inverter stage alone');
}

// 1e. Round-trip = charge_total × discharge_total (multiplicative chain).
{
    const bc = 0.985, id = 0.972, bd = 0.99, ic = 0.968;
    const r = resolveEfficiency({
        efficiencyMode: 'staged',
        batteryChargeEff: bc, inverterChargeEff: ic,
        batteryDischargeEff: bd, inverterDischargeEff: id,
    });
    const roundTrip = r.chargeEfficiency * r.dischargeEfficiency;
    assert(approx(roundTrip, (bc * ic) * (bd * id)),
        'round-trip == charge_total × discharge_total');
}

// ---------------------------------------------------------------------------
// 2. Integration — staged resolves to the same combined efficiency the model uses
// ---------------------------------------------------------------------------
console.log('CustomDataSimulator (staged vs equivalent combined):');

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

function makeGridFlow(hours) {
    // Alternating import/export so the battery actually cycles (exercises efficiency).
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

async function runWith(chargeEff, dischargeEff) {
    const cfg = baseConfig({ chargeEfficiency: chargeEff, dischargeEfficiency: dischargeEff });
    const gridFlow = makeGridFlow(24 * 7);
    const fixedPrice = { buy: 0.30, sell: 0.05 };
    const sim = new CustomDataSimulator(cfg, {}, fixedPrice, gridFlow, [], 60);
    return sim.simulateFixedWithBattery();
}

(async () => {
    // 2a. Staged (battery 100%, inverter 0.9 each) must equal combined 0.9/0.9 exactly.
    const staged = resolveEfficiency({
        efficiencyMode: 'staged',
        batteryChargeEff: 1.0, inverterChargeEff: 0.9,
        batteryDischargeEff: 1.0, inverterDischargeEff: 0.9,
    });
    const fromStaged = await runWith(staged.chargeEfficiency, staged.dischargeEfficiency);
    const fromCombined = await runWith(0.9, 0.9);
    assert(approx(fromStaged.totalCost, fromCombined.totalCost, 1e-9),
        'staged (batt=100%, inv=90%) reproduces combined 90%/90% exactly');

    // 2b. Directional: a lossier stacked chain (0.98×0.90) costs more than a
    //     lossless one (1.0/1.0) over the same cycling profile.
    const lossy = resolveEfficiency({
        efficiencyMode: 'staged',
        batteryChargeEff: 0.98, inverterChargeEff: 0.90,
        batteryDischargeEff: 0.98, inverterDischargeEff: 0.90,
    });
    const fromLossy = await runWith(lossy.chargeEfficiency, lossy.dischargeEfficiency);
    const fromLossless = await runWith(1.0, 1.0);
    assert(fromLossy.totalCost > fromLossless.totalCost,
        `stacked losses increase cost vs lossless (lossy=${fromLossy.totalCost.toFixed(4)}, lossless=${fromLossless.totalCost.toFixed(4)})`);

    console.log('');
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
})();
