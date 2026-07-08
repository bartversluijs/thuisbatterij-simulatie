/**
 * Phase 6c tests — Backup reserve SoC.
 *
 * Run with:  node tests/phase6c_backup_reserve.test.js
 *
 * A backup reserve is a *trading* floor above the absolute hardware Min SoC:
 * arbitrage/discharge may only use capacity in [reserve, max], while Min SoC
 * stays the hardware floor that fixed parasitic draw can still reach.
 *
 * No external test framework: a tiny assert harness keeps this dependency-free.
 */

const Battery = require('../js/battery.js');
const { reserveFloorPct } = require('../js/backup_reserve.js');

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
// 1. reserveFloorPct pure helper
// ---------------------------------------------------------------------------
console.log('reserveFloorPct:');

assert(reserveFloorPct(null, 0.1) === 0.1, 'null reserve → Min SoC (no-op)');
assert(reserveFloorPct(undefined, 0.1) === 0.1, 'undefined reserve → Min SoC (no-op)');
assert(reserveFloorPct(NaN, 0.1) === 0.1, 'NaN reserve → Min SoC (no-op)');
assert(reserveFloorPct(0.1, 0.1) === 0.1, 'reserve == Min SoC → Min SoC (no-op)');
assert(reserveFloorPct(0.05, 0.1) === 0.1, 'reserve below Min SoC is clamped up to Min SoC');
assert(reserveFloorPct(0.3, 0.1) === 0.3, 'reserve above Min SoC is used as the floor');

// ---------------------------------------------------------------------------
// 2. Battery.discharge floor
// ---------------------------------------------------------------------------
console.log('Battery.discharge floor:');

// 2a. Regression: no reserve → discharges down to Min SoC (unchanged behavior).
{
    const b = new Battery(baseConfig(), 1.0); // start full
    let totalDc = 0;
    for (let h = 0; h < 24; h++) {
        const [dc] = b.discharge(100, 1.0); // ask for far more than power allows
        totalDc += dc;
    }
    const minSocKwh = b.config.capacityKwh * b.config.minSocPct;
    assert(approx(b.socKwh, minSocKwh, 1e-9),
        `without a reserve, discharge empties down to Min SoC (got ${b.socKwh.toFixed(4)}, expected ${minSocKwh.toFixed(4)})`);
}

// 2b. Directional: a reserve holds energy back — discharge stops at the reserve.
{
    const reserve = 0.4;
    const b = new Battery(baseConfig({ backupReserveSocPct: reserve }), 1.0);
    for (let h = 0; h < 24; h++) b.discharge(100, 1.0);
    const reserveKwh = b.config.capacityKwh * reserve;
    assert(approx(b.socKwh, reserveKwh, 1e-9),
        `discharge stops at the backup reserve (got ${b.socKwh.toFixed(4)}, expected ${reserveKwh.toFixed(4)})`);
    assert(b.socKwh > b.config.capacityKwh * b.config.minSocPct,
        'a held reserve sits strictly above the hardware Min SoC');
}

// 2c. Reserve reduces the energy available to arbitrage vs. no reserve.
{
    const full = baseConfig();
    const withReserve = baseConfig({ backupReserveSocPct: 0.4 });
    const bA = new Battery(full, 1.0);
    const bB = new Battery(withReserve, 1.0);
    let dcA = 0, dcB = 0;
    for (let h = 0; h < 24; h++) { dcA += bA.discharge(100, 1.0)[0]; dcB += bB.discharge(100, 1.0)[0]; }
    assert(dcB < dcA, `reserve lowers total dischargeable energy (noReserve=${dcA.toFixed(2)}, reserve=${dcB.toFixed(2)})`);
    // Exactly the reserved band should be withheld: (0.4 - 0.1) * 10 = 3 kWh.
    assert(approx(dcA - dcB, (0.4 - 0.1) * 10, 1e-6),
        'the withheld energy equals the reserved band (reserve − Min SoC) × capacity');
}

// ---------------------------------------------------------------------------
// 3. Fixed parasitic consumption may still draw the reserve down to Min SoC
// ---------------------------------------------------------------------------
console.log('Fixed consumption vs. reserve (hardware floor still applies):');
{
    // Reserve at 40%, but the idle inverter drain is what the reserve exists to
    // cover — it may pull SoC below the reserve, down to the Min SoC floor.
    const b = new Battery(baseConfig({ backupReserveSocPct: 0.4, fixedConsumptionW: 100 }), 0.5);
    const minSocKwh = b.config.capacityKwh * b.config.minSocPct;
    let breached = false;
    for (let h = 0; h < 24 * 30; h++) {
        b.applyFixedConsumption(1.0);
        if (b.socKwh < minSocKwh - 1e-9) breached = true;
    }
    assert(b.socKwh < b.config.capacityKwh * 0.4 + 1e-9,
        'fixed consumption draws below the reserve (reserve is not a hardware floor for parasitic draw)');
    assert(approx(b.socKwh, minSocKwh, 1e-9),
        'fixed consumption settles at the absolute Min SoC floor, not the reserve');
    assert(!breached, 'fixed consumption never breaches the hardware Min SoC floor');
}

console.log('');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
