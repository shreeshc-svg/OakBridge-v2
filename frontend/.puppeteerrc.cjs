const { join } = require("path");

/**
 * Keep Chromium inside the project rather than in the home directory.
 *
 * Puppeteer downloads its browser to ~/.cache/puppeteer by default. On a CI
 * builder that directory is outside the workspace and outside the build cache,
 * so `puppeteer` the package gets restored from cache while the browser it
 * needs does not — and the build dies at launch() with a message about a
 * missing Chromium that "was just installed". Anchoring the cache to the
 * project keeps the two together.
 *
 * The build command also runs `puppeteer browsers install chrome` before
 * building, which is a no-op when the browser is already here. Belt and braces:
 * this file makes caching work, that makes a cold cache survivable.
 */
module.exports = {
    cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
