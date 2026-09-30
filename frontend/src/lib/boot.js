import { useEffect, useLayoutEffect, useState } from "react";
import { isPrerender } from "./runtime";

/**
 * Build-time data snapshot, so hydration matches the prerendered HTML.
 *
 * THE BUG THIS FIXES (measured on www.oakbridge.in, 2026-09-29)
 *
 * Every public route is rendered to static HTML by scripts/prerender.js AFTER
 * its API calls have returned, and the browser then calls hydrateRoot() on that
 * markup. But every component started from EMPTY state (`useState([])`, then a
 * fetch in useEffect), so React's first client render had no nav items, no
 * footer columns, no hero slides, no books — and did not match the markup it
 * was handed. React 19 answers that with error #418 (logged on /, /about and
 * /books alike), throws the server HTML away and re-renders the whole page from
 * the empty state, and the data then pours back in. Visitors saw the page
 * blank out and rebuild; PageSpeed saw it as CLS 0.36–0.5 and, on desktop,
 * NO_LCP (the largest element was removed and replaced mid-load).
 *
 * THE MECHANISM
 *
 *   1. While prerendering, useBootState() records each value it renders into
 *      window.__BOOT_DATA__ — in a LAYOUT effect, i.e. in the same task as the
 *      DOM commit, so the snapshot and the markup can never be captured out of
 *      step with each other.
 *   2. prerender.js serialises that object into
 *      <script id="__BOOT__" type="application/json"> in the SAME evaluate()
 *      call that reads outerHTML, for the same reason.
 *   3. In the browser, useBootState() starts from that snapshot, so the first
 *      client render is the prerendered page, hydration succeeds, and nothing
 *      moves. The component's own fetch still runs and replaces the snapshot
 *      with live data a moment later — the snapshot is never the final word.
 *
 * KEYS ARE PER CONSUMER ("footer:site", "cart:site", "home:site"), not shared.
 * Three components each fetch /site-content on their own schedule; a shared key
 * would hold whichever wrote last, and a component whose own fetch had failed
 * would then hydrate with data it never rendered. Duplicate JSON compresses to
 * almost nothing under gzip; a wrong snapshot costs the whole fix.
 *
 * A page without a snapshot (app-shell.html, or any key this page's prerender
 * didn't record) gets `undefined` back and falls through to the component's
 * normal default — exactly the behaviour before this file existed.
 */

let snapshot;

function readSnapshot() {
    if (snapshot !== undefined) return snapshot;
    snapshot = {};
    if (typeof document === "undefined") return snapshot;
    try {
        const el = document.getElementById("__BOOT__");
        if (el) snapshot = JSON.parse(el.textContent) || {};
    } catch {
        // A corrupt snapshot must never break the page — it only costs the
        // hydration match, which is where every page was before this existed.
        snapshot = {};
    }
    return snapshot;
}

/** The value the prerenderer rendered for `key`, or undefined. */
export function bootRead(key) {
    return readSnapshot()[key];
}

/** Record `value` for `key` — a no-op anywhere but the prerender pass. */
export function bootWrite(key, value) {
    if (typeof window === "undefined" || !isPrerender()) return;
    const store = (window.__BOOT_DATA__ = window.__BOOT_DATA__ || {});
    if (value === undefined) delete store[key];
    else store[key] = value;
}

/**
 * useState that starts from the prerender snapshot and records what it renders.
 * Drop-in: same [value, setValue] pair, same default when there is no snapshot.
 */
export function useBootState(key, initial) {
    const [value, setValue] = useState(() => {
        const b = bootRead(key);
        if (b !== undefined) return b;
        return typeof initial === "function" ? initial() : initial;
    });
    useLayoutEffect(() => {
        bootWrite(key, value);
    }, [key, value]);
    return [value, setValue];
}

/**
 * False on the render that hydrates, true from the next one on.
 *
 * For per-visitor state that the build can never know — the cart badge reads
 * localStorage, and the prerendered page was captured with an empty cart. The
 * first render must show what the markup shows; the real value follows one
 * frame later.
 */
export function useHydrated() {
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => setHydrated(true), []);
    return hydrated;
}
