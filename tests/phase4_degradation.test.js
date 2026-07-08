/**
 * Phase 4 tests — Capacity degradation over lifetime.
 *
 * Run with:  node tests/phase4_degradation.test.js
 *
 * Dependency-free tiny assert harness (same style as the Phase 1/2/3 suites).
 */

const {
    resolveDegradation,
    capacityFractionAtAge,
    averageCapacityFraction,
    effectiveCapacityKwh,
} = require('../js/capacity_degradation.js');
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

function approx(a, b, tol = 1e-9) {
    return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
// 1. resolveDegradation — normalisation & defaults
// ---------------------------------------------------------------------------
console.log('resolveDegradation:');
{
    const d = resolveDegradation(undefined);
    assert(d.mode === 'none', 'undefined config → mode none');
    assert(d.floor === 0.70, 'default floor 0.70');
    assert(d.horizonYears === 15, 'default horizon 15 yr');
    assert(d.compounding === false, 'default linear (compounding false)');

    assert(resolveDegradation({ mode: 'bogus' }).mode === 'none', 'unknown mode → none');
    assert(resolveDegradation({ mode: 'per_year' }).mode === 'per_year', 'per_year kept');
    assert(resolveDegradation({ mode: 'per_cycle' }).mode === 'per_cycle', 'per_cycle kept');

    // Floor clamped into [0,1]; negative rates floored to 0.
    assert(resolveDegradation({ floor: 5 }).floor === 1, 'floor > 1 clamped to 1');
    assert(resolveDegradation({ ratePerYear: -0.5 }).ratePerYear === 0, 'negative rate → 0');
}

// ---------------------------------------------------------------------------
// 2. capacityFractionAtAge — the fade curve
// ---------------------------------------------------------------------------
console.log('capacityFractionAtAge:');

// 2a. none is a no-op at any age (regression baseline).
{
    assert(capacityFractionAtAge({ mode: 'none' }, 0) === 1, 'none at 0 yr → 1');
    assert(capacityFractionAtAge({ mode: 'none' }, 99) === 1, 'none at 99 yr → 1');
}

// 2b. per_year linear: 2 %/yr over 10 yr → 20 % loss (PLAN acceptance figure).
{
    const cfg = { mode: 'per_year', ratePerYear: 0.02, floor: 0.5 };
    assert(approx(capacityFractionAtAge(cfg, 0), 1.0), 'age 0 → full capacity');
    assert(approx(capacityFractionAtAge(cfg, 10), 0.80), '2%/yr × 10 yr → 0.80 (20% loss, linear)');
    assert(approx(capacityFractionAtAge(cfg, 5), 0.90), '2%/yr × 5 yr → 0.90');
}

// 2c. Capacity never drops below the end-of-life floor.
{
    const cfg = { mode: 'per_year', ratePerYear: 0.05, floor: 0.70 };
    // Linear would give 1 - 0.05*20 = 0 at 20 yr; must clamp at 0.70.
    assert(capacityFractionAtAge(cfg, 20) === 0.70, 'clamped at floor (never below EOL)');
    assert(capacityFractionAtAge(cfg, 100) === 0.70, 'stays clamped far past EOL');
}

// 2d. Compounding differs from linear and stays below the linear line.
{
    const lin = capacityFractionAtAge({ mode: 'per_year', ratePerYear: 0.02, floor: 0 }, 10);
    const comp = capacityFractionAtAge({ mode: 'per_year', ratePerYear: 0.02, floor: 0, compounding: true }, 10);
    assert(approx(comp, Math.pow(0.98, 10)), 'compounding = (1-r)^age');
    assert(comp > lin, 'compounding fades slower than linear for the same rate');
}

// 2e. per_cycle: cumulative cycles = cyclesPerYear × age.
{
    const cfg = { mode: 'per_cycle', ratePerCycle: 0.0001, cyclesPerYear: 300, floor: 0.5 };
    // 300 cycles/yr × 10 yr = 3000 cycles × 0.0001 = 0.30 loss → 0.70.
    assert(approx(capacityFractionAtAge(cfg, 10), 0.70), 'per_cycle: 3000 cycles × 0.01%/cycle → 0.70');
}

// ---------------------------------------------------------------------------
// 3. averageCapacityFraction — representative single-year figure
// ---------------------------------------------------------------------------
console.log('averageCapacityFraction:');

// 3a. none → 1.
{
    assert(averageCapacityFraction({ mode: 'none' }) === 1, 'none → average 1');
}

// 3b. Linear fade: average over [0, H] = value at midpoint H/2 (midpoint of life).
{
    const cfg = { mode: 'per_year', ratePerYear: 0.02, floor: 0, horizonYears: 10 };
    // Mean of (1 - 0.02 t) over [0,10] = 1 - 0.02*5 = 0.90.
    assert(approx(averageCapacityFraction(cfg), 0.90, 1e-6), 'linear average = midpoint capacity (0.90)');
    assert(approx(averageCapacityFraction(cfg), capacityFractionAtAge(cfg, 5), 1e-6),
        'average equals capacity at half the horizon');
}

// 3c. Average respects the floor (stays at/above it).
{
    const cfg = { mode: 'per_year', ratePerYear: 0.10, floor: 0.70, horizonYears: 15 };
    const avg = averageCapacityFraction(cfg);
    assert(avg >= 0.70 && avg < 1, `average within [floor,1) (got ${avg.toFixed(4)})`);
}

// ---------------------------------------------------------------------------
// 4. effectiveCapacityKwh — what the simulator actually receives
// ---------------------------------------------------------------------------
console.log('effectiveCapacityKwh:');
{
    assert(effectiveCapacityKwh(10, { mode: 'none' }) === 10, 'none → nominal capacity unchanged');
    const eff = effectiveCapacityKwh(10, { mode: 'per_year', ratePerYear: 0.02, floor: 0, horizonYears: 10 });
    assert(approx(eff, 9.0, 1e-5), 'per_year 2%/10yr → 9.0 kWh usable (from 10)');
    assert(eff < 10, 'degradation reduces usable capacity');
}

// ---------------------------------------------------------------------------
// 5. Simulator integration — end-to-end directional effect over a run
// ---------------------------------------------------------------------------
console.log('CustomDataSimulator (degraded vs nominal over a run):');

function simConfig(capacityKwh) {
    return {
        capacityKwh,
        chargePowerKw: 5,
        dischargePowerKw: 5,
        chargeEfficiency: 0.95,
        dischargeEfficiency: 0.95,
        minSocPct: 0.1,
        maxSocPct: 1.0,
        initialSocPct: 0.5,
    };
}

function makeGridFlow(hours) {
    // Alternating ±2 kW import/export so the battery cycles every few hours,
    // making usable capacity matter to the outcome.
    const data = [];
    const start = new Date('2025-01-01T00:00:00Z').getTime();
    for (let i = 0; i < hours; i++) {
        data.push({
            timestamp: new Date(start + i * 3600 * 1000).toISOString(),
            netGridFlow: (i % 8 < 4) ? 2.0 : -2.0,
        });
    }
    return data;
}

async function runSim(capacityKwh) {
    const gridFlow = makeGridFlow(24 * 14);
    const fixedPrice = { buy: 0.30, sell: 0.05 };
    const sim = new CustomDataSimulator(simConfig(capacityKwh), {}, fixedPrice, gridFlow, [], 60);
    return sim.simulateFixedWithBattery();
}

(async () => {
    const NOMINAL = 10;
    const degrade = { mode: 'per_year', ratePerYear: 0.02, floor: 0, horizonYears: 10 };

    // 5a. mode none → effective capacity == nominal → identical run (regression).
    const nominalRun = await runSim(NOMINAL);
    const noneRun = await runSim(effectiveCapacityKwh(NOMINAL, { mode: 'none' }));
    assert(approx(nominalRun.totalCost, noneRun.totalCost),
        'degradation none reproduces the nominal-capacity run exactly');

    // 5b. Degraded (smaller usable) capacity changes the result vs nominal.
    const degradedCap = effectiveCapacityKwh(NOMINAL, degrade); // 9.0 kWh
    const degradedRun = await runSim(degradedCap);
    assert(!approx(degradedRun.totalCost, nominalRun.totalCost, 1e-6),
        `degraded capacity (${degradedCap} kWh) changes cost vs nominal ` +
        `(degraded=${degradedRun.totalCost.toFixed(4)}, nominal=${nominalRun.totalCost.toFixed(4)})`);

    console.log('');
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
})();
