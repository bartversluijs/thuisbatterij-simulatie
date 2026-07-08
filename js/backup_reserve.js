/**
 * Backup reserve SoC (Phase 6c).
 *
 * A home battery serves two goals that pull in opposite directions:
 *   - arbitrage / self-consumption wants to cycle as much energy as possible;
 *   - backup wants to keep a charged buffer standing by for a grid outage.
 *
 * The existing `minSocPct` is a *safety / hardware* floor: the battery is never
 * discharged below it under any circumstance. It is NOT a backup reserve — a
 * battery sitting at Min SoC has nothing left to power the house when the grid
 * drops. Phase 6c adds a separate, higher floor for *trading*:
 *
 *   Min SoC  ≤  Backup reserve SoC  ≤  Max SoC
 *   └ absolute       └ arbitrage/discharge floor: energy below this is held
 *     hardware         back for outages and is unavailable to the optimizer.
 *     floor
 *
 * So the arbitrage-usable band is [backupReserveSoc, maxSoc], while the absolute
 * hardware band remains [minSoc, maxSoc]. Fixed parasitic consumption (Phase 1)
 * still draws down to Min SoC — the reserve is meant to *survive* an outage, and
 * the idle inverter drain is exactly the kind of load it exists to cover.
 *
 * Backward compatible: the reserve defaults to Min SoC (or is clamped up to it),
 * which reproduces the pre-Phase-6c behavior exactly (no reserve → no-op).
 */

/**
 * Resolve the effective arbitrage/discharge floor (fraction 0-1).
 *
 * The reserve can never sit below the hardware Min SoC (a reserve below the
 * floor is physically meaningless), so it is clamped up to `minSocPct`. When the
 * reserve is absent/NaN or equal to Min SoC, this returns `minSocPct` unchanged,
 * making the feature a strict no-op for existing configs.
 *
 * Pure function (no DOM) so it can be unit-tested directly and reused by both the
 * Battery and the Optimizer.
 *
 * @param {number} [backupReserveSocPct] - Requested reserve floor (fraction 0-1).
 * @param {number} minSocPct - Absolute hardware floor (fraction 0-1).
 * @returns {number} Effective discharge floor (fraction 0-1), always ≥ minSocPct.
 */
function reserveFloorPct(backupReserveSocPct, minSocPct) {
    if (backupReserveSocPct == null || Number.isNaN(backupReserveSocPct)) {
        return minSocPct;
    }
    return Math.max(minSocPct, backupReserveSocPct);
}

/**
 * Browser helper: read the backup-reserve UI field (if present) into a fraction.
 *
 * Returns `null` when the field is absent or empty, so pages without the Phase-6c
 * UI (and untouched configs) fall back to Min SoC and behave exactly as before.
 * The value is NOT clamped here — the UI validates the `min ≤ reserve ≤ max`
 * relationship and reports a clear error rather than silently clamping; the
 * engine still clamps defensively via {@link reserveFloorPct}.
 *
 * @returns {number|null} Reserve SoC as a fraction (0-1), or null if unset.
 */
function readBackupReserveSocPct() {
    if (typeof document === 'undefined') return null;

    const el = document.getElementById('backupReserveSoc');
    if (!el) return null;

    const raw = (el.value || '').toString().trim().replace(',', '.');
    if (raw === '') return null;

    const pct = parseFloat(raw);
    if (Number.isNaN(pct)) return null;

    return pct / 100; // percentage field → fraction
}

// Export for use in other modules (Node tests) while remaining a browser global.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { reserveFloorPct, readBackupReserveSocPct };
}
