/**
 * Where the dashboard tiles sit, and how that survives a reload.
 *
 * STORED PER BROWSER, NOT PER SITE. The obvious home was the `settings`
 * collection, next to the admin nav order — but settings is global and its read
 * endpoint is public and unauthenticated, so one admin dragging a tile would
 * rearrange every other admin's dashboard, and the key would be readable by
 * anyone who asked for /api/settings. A layout preference belongs to a person,
 * so it lives in their browser. The trade is real and worth saying out loud: it
 * does not follow you to another machine.
 *
 * The stored value is reconciled against the live tile list on every read rather
 * than trusted. Tiles get added and removed — Desk Pending was removed the same
 * week this shipped — and a saved order from last month must not be able to
 * hide a new tile or resurrect a dead one.
 */

const KEY = "oakbridge_admin_tile_order";

/**
 * Merge a saved order with the tiles that actually exist.
 *
 * Unknown keys are dropped, missing ones are appended in their default
 * position. So a saved order is a preference about the tiles it knows, never a
 * whitelist of the tiles you are allowed to see.
 */
export function reconcileOrder(saved, defaults) {
    const valid = Array.isArray(defaults) ? defaults : [];
    const known = new Set(valid);
    const seen = new Set();
    const out = [];
    if (Array.isArray(saved)) {
        for (const k of saved) {
            if (known.has(k) && !seen.has(k)) {
                seen.add(k);
                out.push(k);
            }
        }
    }
    for (const k of valid) if (!seen.has(k)) out.push(k);
    return out;
}

export function readTileOrder(defaults) {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
        saved = null; // private mode, or someone hand-edited the value
    }
    return reconcileOrder(saved, defaults);
}

export function writeTileOrder(order) {
    try {
        localStorage.setItem(KEY, JSON.stringify(order));
    } catch {
        /* the drag still applies to this session */
    }
}

export function clearTileOrder() {
    try {
        localStorage.removeItem(KEY);
    } catch {
        /* nothing to clear */
    }
}

/**
 * Move `fromKey` to sit where `toKey` currently is.
 *
 * Splice out, then splice in — computing the target index BEFORE the removal
 * would put the tile one place too far right on every left-to-right drag, which
 * is the classic version of this bug and is invisible until you drag the first
 * tile to the end.
 */
export function moveTile(order, fromKey, toKey) {
    if (!Array.isArray(order) || fromKey === toKey) return order;
    const from = order.indexOf(fromKey);
    const to = order.indexOf(toKey);
    if (from < 0 || to < 0) return order;
    const next = order.slice();
    next.splice(from, 1);
    next.splice(next.indexOf(toKey) + (from < to ? 1 : 0), 0, fromKey);
    return next;
}
