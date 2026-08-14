/**
 * Is this a real browser session, or the build rendering the site to disk?
 *
 * Every deploy runs Puppeteer over 354 routes against localhost:3000 and writes
 * the resulting HTML out as static files. Anything that fires during that pass
 * gets either counted (analytics) or baked into the shipped markup (a modal),
 * so more than one feature needs to ask this question — and asking it twice, in
 * two files, is how the two answers eventually disagree.
 *
 * Two independent checks on purpose. The port is the reliable one; webdriver
 * catches the case where someone changes the port and forgets this exists.
 */
export function isPrerender() {
    if (typeof window === "undefined") return true;
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
    // Reached through `window.` rather than as a bare global: the bare form
    // resolves against whatever ambient `navigator` exists, which is exactly how
    // this check once passed a test it should have failed.
    if (window.navigator?.webdriver) return true;
    return false;
}
