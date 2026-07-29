const { join } = require("path");

/**
 * Keep Chromium inside the project rather than in the home directory.
 *
 * Puppeteer downloads its browser to ~/.cache/puppeteer by default — outside
 * the workspace entirely, which makes it invisible to anything that reasons
 * about the project directory and awkward to clean up.
 *
 * Be clear about what this does NOT buy: Vercel caches node_modules, not
 * arbitrary project directories, so pointing the cache at frontend/.cache does
 * not make the browser survive between builds. The thing that actually
 * guarantees Chromium is present is the explicit `puppeteer browsers install
 * chrome` in vercel.json's buildCommand, which runs every time and is a no-op
 * when the browser is already there.
 *
 * This file is therefore about locality and predictability, not caching.
 */
module.exports = {
    cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
