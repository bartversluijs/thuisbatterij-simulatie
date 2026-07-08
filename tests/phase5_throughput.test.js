/**
 * Phase 5 tests — Throughput & equivalent full cycles (output metrics).
 *
 * Run with:  node tests/phase5_throughput.test.js
 *
 * Dependency-free tiny assert harness (same style as the Phase 1-4 suites).
 */

const { ThroughputTracker, HOURS_PER_YEAR } = require('../js/throughput_metrics.js');
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

const HOUR_MS = 3600 * 1000;
const BASE = new Date('2025-01-01T00:00:00Z').getTime();

// ---------------------------------------------------------------------------
// 1. Empty / no-activity tracker → all zeros (backward-compatible no-op).
// ---------------------------------------------------------------------------
console.log('ThroughputTracker (empty):');
{
    const t = new ThroughputTracker({ capacityKwh: 10 });
    const m = t.metrics();
    assert(m.totalDischargedKwh === 0, 'no records → 0 discharged');
    assert(m.equivalentFullCycles === 0, 'no records → 0 EFC');
    assert(m.spanHours === 0 && m.spanYears === 0, 'no records → 0 span');
    assert(m.clippedSteps === 0 && m.totalSteps === 0, 'no records → 0 steps');
}

// ---------------------------------------------------------------------------
// 2. PLAN acceptance profile: exactly 1 full cycle/day for 365 days.
//    → EFC == 365 and annual throughput == 365 × usable capacity.
// ---------------------------------------------------------------------------
console.log('ThroughputTracker (1 full cycle/day × 365 d, hourly):');
{
    const CAP = 10;
    const t = new ThroughputTracker({ capacityKwh: CAP, chargePowerKw: 10, dischargePowerKw: 10 });

    // 365 days × 24 hourly steps = 8760 steps → span exactly 1 year.
    for (let i = 0; i < 365 * 24; i++) {
        const ts = BASE + i * HOUR_MS;
        const h = i % 24;
        // One full charge (10 kWh) and one full discharge (10 kWh) per day.
        const charge = h === 2 ? CAP : 0;
        const discharge = h === 14 ? CAP : 0;
        t.record(ts, charge, discharge, 1.0);
    }
    const m = t.metrics();

    assert(approx(m.spanHours, HOURS_PER_YEAR), `span == ${HOURS_PER_YEAR} h (got ${m.spanHours})`);
    assert(approx(m.spanYears, 1.0), 'span == 1.0 year');
    assert(approx(m.equivalentFullCycles, 365), `EFC == 365 (got ${m.equivalentFullCycles})`);
    assert(approx(m.totalEquivalentFullCycles, 365), 'total EFC == 365 (span is one year)');
    assert(approx(m.annualThroughputKwh, 365 * CAP), `annual throughput == 365 × capacity (got ${m.annualThroughputKwh})`);
    assert(approx(m.totalDischargedKwh, 365 * CAP), 'total discharged == 3650 kWh');
    // 10 kWh over 1 h = 10 kW, exactly the configured limit → every active step clipped.
    assert(approx(m.peakChargeKw, 10) && approx(m.peakDischargeKw, 10), 'peak power == 10 kW');
    assert(m.clippedChargeSteps === 365 && m.clippedDischargeSteps === 365, 'all 365 charge & discharge steps clipped at the power cap');
}

// ---------------------------------------------------------------------------
// 3. Non-integer-year datasets are normalised to per-year figures.
// ---------------------------------------------------------------------------
console.log('ThroughputTracker (half-year normalisation):');
{
    const t = new ThroughputTracker({ capacityKwh: 5 });
    // 4380 hourly steps = half a year. Discharge 1 kWh on the first step only.
    for (let i = 0; i < 4380; i++) {
        t.record(BASE + i * HOUR_MS, 0, i === 0 ? 1 : 0, 1.0);
    }
    const m = t.metrics();
    assert(approx(m.spanYears, 0.5), `span == 0.5 year (got ${m.spanYears})`);
    assert(approx(m.totalDischargedKwh, 1), 'observed discharge == 1 kWh');
    assert(approx(m.annualThroughputKwh, 2), 'annualised discharge == 2 kWh/yr (1 kWh over half a year)');
    assert(approx(m.equivalentFullCycles, (1 / 5) / 0.5), 'EFC annualised over half-year span');
}

// ---------------------------------------------------------------------------
// 4. Quarterly (sub-hourly) data: power is energy/duration, not energy.
// ---------------------------------------------------------------------------
console.log('ThroughputTracker (quarterly power & clipping):');
{
    const t = new ThroughputTracker({ capacityKwh: 10, chargePowerKw: 4, dischargePowerKw: 4 });
    // 0.25 h step. 1 kWh charged in 0.25 h = 4 kW → clipped at the 4 kW cap.
    t.record(BASE, 1.0, 0, 0.25);
    // 0.5 kWh discharged in 0.25 h = 2 kW → below the cap, not clipped.
    t.record(BASE + 15 * 60 * 1000, 0, 0.5, 0.25);
    const m = t.metrics();
    assert(approx(m.peakChargeKw, 4), 'quarterly peak charge == 4 kW (1 kWh / 0.25 h)');
    assert(approx(m.peakDischargeKw, 2), 'quarterly peak discharge == 2 kW');
    assert(m.clippedChargeSteps === 1, 'charge step at the cap is clipped');
    assert(m.clippedDischargeSteps === 0, 'discharge step below the cap is not clipped');
}

// ---------------------------------------------------------------------------
// 5. Zero capacity is handled without producing NaN/Infinity.
// ---------------------------------------------------------------------------
console.log('ThroughputTracker (zero capacity guard):');
{
    const t = new ThroughputTracker({ capacityKwh: 0 });
    t.record(BASE, 5, 5, 1.0);
    const m = t.metrics();
    assert(isFinite(m.equivalentFullCycles) && m.equivalentFullCycles === 0, 'zero capacity → EFC 0, not NaN/Infinity');
}

// ---------------------------------------------------------------------------
// 6. Simulator integration — CustomDataSimulator exposes plausible metrics.
// ---------------------------------------------------------------------------
console.log('CustomDataSimulator (throughput metrics end-to-end):');

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
    const data = [];
    for (let i = 0; i < hours; i++) {
        data.push({
            timestamp: new Date(BASE + i * HOUR_MS).toISOString(),
            netGridFlow: (i % 8 < 4) ? 2.0 : -2.0,
        });
    }
    return data;
}

(async () => {
    const CAP = 10;
    const days = 14;
    const gridFlow = makeGridFlow(24 * days);
    const sim = new CustomDataSimulator(simConfig(CAP), {}, { buy: 0.30, sell: 0.05 }, gridFlow, [], 60);
    const res = await sim.simulateFixedWithBattery();

    assert(res.throughput != null, 'result exposes a throughput metrics object');
    const m = res.throughput;

    // The tracker must agree with the simulator's own DC accumulators.
    assert(approx(m.totalDischargedKwh, res.totalDischarged, 1e-9),
        `tracker discharged == sim totalDischarged (${m.totalDischargedKwh} vs ${res.totalDischarged})`);
    assert(approx(m.totalChargedKwh, res.totalCharged, 1e-9),
        'tracker charged == sim totalCharged');

    // EFC (total, over the run) equals discharged / capacity.
    assert(approx(m.totalEquivalentFullCycles, res.totalDischarged / CAP, 1e-9),
        'total EFC == discharged / capacity');

    // Span reflects the 14-day dataset.
    assert(approx(m.spanHours, 24 * days, 1e-6), `span == ${24 * days} h (got ${m.spanHours})`);
    assert(m.totalDischargedKwh > 0, 'battery actually cycled (throughput > 0)');

    // Peak discharge power cannot exceed the configured DC limit.
    assert(m.peakDischargeKw <= 5 + 1e-9 && m.peakChargeKw <= 5 + 1e-9,
        'observed peak power never exceeds the DC power limit');

    console.log('');
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
})();
