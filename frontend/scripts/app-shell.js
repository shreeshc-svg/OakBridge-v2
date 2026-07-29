/*
 * Copy the freshly-built build/index.html to build/app-shell.html.
 *
 * WHY THIS IS PART OF `yarn build` AND NOT OF THE PRERENDER STEP
 *
 * vercel.json rewrites every unmatched path to /app-shell.html. If that file
 * could ever be missing, every client-side route on the site — /cart,
 * /checkout, /account, /admin, and every 404 — would return a hard 404 instead
 * of the app. Tying its creation to the ordinary build means it exists whether
 * or not prerendering ran, so switching buildCommand back to `yarn build` in a
 * hurry degrades SEO without taking the site down.
 *
 * It also gives the prerenderer a pristine shell to serve and to restore from.
 * Prerendering overwrites build/index.html with the rendered homepage, so on a
 * second run over the same build/ directory, index.html is no longer a shell —
 * reading it would hand every route the homepage's title and canonical.
 * app-shell.html is written before any of that and never rendered into.
 */
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const src = path.join(BUILD, "index.html");
const dest = path.join(BUILD, "app-shell.html");

if (!fs.existsSync(src)) {
    console.error("build/index.html not found — run the build first.");
    process.exit(1);
}

const html = fs.readFileSync(src, "utf8");

// Refuse to snapshot an already-rendered page. If index.html has content in
// #root it is a prerendered route, not the shell, and copying it would bake the
// homepage into the fallback for the whole site.
if (!/<div id="root">\s*<\/div>/.test(html)) {
    if (fs.existsSync(dest)) {
        console.log("app-shell.html kept (build/index.html is already prerendered).");
        process.exit(0);
    }
    console.error(
        "build/index.html is already prerendered and no app-shell.html exists. " +
        "Run a clean build — copying this would make the homepage the fallback for every route.",
    );
    process.exit(1);
}

fs.writeFileSync(dest, html);
console.log("Wrote build/app-shell.html (SPA fallback shell).");
