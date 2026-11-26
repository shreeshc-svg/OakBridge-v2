/*
 * Pages that exist but aren't launched yet (Nov 2026): /solutions/higher-ed
 * ("For Colleges") and /solutions/educators ("For Educators").
 *
 * ONE list for both places that must agree:
 *   * the footer shows a "Coming soon" tag on their links (Footer.jsx);
 *   * the pages themselves carry `noindex, follow` instead of a canonical +
 *     social card (Solutions.jsx), so Google doesn't index a page that
 *     promises review copies, lesson plans and a campus account manager
 *     before those exist. Visitors can still open them; links on them still
 *     pass value ("follow").
 * They are also prerendered as noindex routes and left OUT of the sitemap
 * (frontend/scripts/prerender.js NOINDEX_ROUTES, backend/server.py
 * _SITEMAP_STATIC_PATHS) — a sitemap is a request to index.
 *
 * TO LAUNCH ONE: remove it here, move it from NOINDEX_ROUTES back to
 * STATIC_ROUTES in prerender.js, add it back to the sitemap list in
 * server.py, and drop its explicit <Route> in App.js. sanity-check.js checks
 * the four stay in step.
 */
export const COMING_SOON_PATHS = new Set(["/solutions/higher-ed", "/solutions/educators"]);

export const isComingSoon = (to) => {
    if (!to) return false;
    try {
        // Tolerate absolute URLs saved in the admin collection.
        const path = to.startsWith("http") ? new URL(to).pathname : to.split(/[?#]/)[0];
        return COMING_SOON_PATHS.has(path.replace(/\/$/, "") || "/");
    } catch {
        return COMING_SOON_PATHS.has(to);
    }
};
