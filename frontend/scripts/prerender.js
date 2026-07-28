/*
 * Post-build prerender: renders every route with a real browser and writes the
 * resulting HTML to disk, so crawlers receive an indexable page instead of the
 * empty CRA shell ("You need to enable JavaScript to run this app").
 *
 * Run AFTER a production build:
 *   yarn build && node scripts/prerender.js
 *   yarn build:seo                                  (does both)
 *
 * Environment:
 *   BACKEND_URL            API to enumerate books/authors from. REQUIRED.
 *   PRERENDER_CONCURRENCY  parallel pages (default 6)
 *   PRERENDER_ALLOW_EMPTY  set to "1" to tolerate zero book routes
 *
 * WHY THIS FAILS THE BUILD RATHER THAN WARNING
 *
 * The previous version defaulted BACKEND_URL to localhost:8000 and merely
 * warned when it could not be reached. On Vercel that is always unreachable, so
 * the build would have "succeeded" while prerendering the static pages and none
 * of the ~194 book pages — the exact pages this exists for — and nobody would
 * have found out until someone read Search Console weeks later. A build that
 * cannot do its job should stop, loudly.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const BACKEND = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const PORT = Number(process.env.PRERENDER_PORT || 45678);
const CONCURRENCY = Math.max(1, Number(process.env.PRERENDER_CONCURRENCY || 6));
const ALLOW_EMPTY = process.env.PRERENDER_ALLOW_EMPTY === "1";

const MIME = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
    ".txt": "text/plain", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
};

// Keep in sync with backend/server.py _SITEMAP_STATIC_PATHS. A route missing
// here is still reachable, but ships the empty shell to crawlers — which is the
// whole problem this script exists to solve.
const STATIC_ROUTES = [
    "/", "/books", "/authors", "/events", "/about", "/contact",
    "/submissions", "/academy", "/digital-solutions", "/what-we-do",
    "/solutions", "/careers", "/media",
    "/terms", "/privacy", "/refund-policy", "/shipping-policy", "/cookie-policy",
];

function makeServer() {
    return http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        const filePath = path.join(BUILD, urlPath);
        if (urlPath !== "/" && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(200, { "Content-Type": "text/html" }); // SPA fallback
            fs.createReadStream(path.join(BUILD, "index.html")).pipe(res);
        }
    });
}

async function getJson(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}

async function getRoutes() {
    if (!BACKEND) {
        throw new Error(
            "BACKEND_URL is not set. Point it at the live API (e.g. https://api.oakbridge.in), " +
            "or this build would ship zero book pages.",
        );
    }
    const dynamic = [];

    const books = await getJson(`${BACKEND}/api/books?limit=1000`);
    for (const b of books) if (b && b.id) dynamic.push(`/books/${b.id}`);
    console.log(`Discovered ${books.length} book routes.`);
    if (!books.length && !ALLOW_EMPTY) {
        throw new Error("The API returned zero books. Refusing to publish a catalogue-free build.");
    }

    // Authors are a nice-to-have: the index lists them all, so a failure here
    // costs some long-tail coverage but does not gut the catalogue.
    try {
        const authors = await getJson(`${BACKEND}/api/authors`);
        for (const a of authors) if (a && a.id) dynamic.push(`/authors/${a.id}`);
        console.log(`Discovered ${authors.length} author routes.`);
    } catch (e) {
        console.warn(`Author routes skipped (${e.message}).`);
    }

    return [...STATIC_ROUTES, ...dynamic];
}

async function renderTo(browser, base, route) {
    const page = await browser.newPage();
    try {
        /*
         * networkidle0 waits for EVERY connection to go quiet. A single poller,
         * websocket or analytics beacon that never settles turns each page into
         * a full timeout, and 200+ routes at 45s each is a two-hour build.
         * networkidle2 tolerates a couple of long-lived connections; the
         * explicit wait below is what actually proves React has rendered.
         */
        await page.goto(base + route, { waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForFunction(
            () => {
                const root = document.getElementById("root");
                return root && root.children.length > 0 && !!document.title;
            },
            { timeout: 15000 },
        );
        const html = "<!doctype html>\n" + (await page.evaluate(() => document.documentElement.outerHTML));

        // Never write the very thing this script exists to eliminate.
        if (html.includes("You need to enable JavaScript to run this app")) {
            throw new Error("output still contains the empty-shell noscript text");
        }

        const outDir = route === "/" ? BUILD : path.join(BUILD, route);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "index.html"), html);
        return { route, ok: true };
    } catch (e) {
        return { route, ok: false, error: e.message };
    } finally {
        await page.close();
    }
}

async function main() {
    if (!fs.existsSync(path.join(BUILD, "index.html"))) {
        console.error("No build/ folder found. Run `yarn build` first.");
        process.exit(1);
    }
    let puppeteer;
    try {
        puppeteer = require("puppeteer");
    } catch {
        console.error("puppeteer is not installed. Run `yarn add -D puppeteer` first.");
        process.exit(1);
    }

    const routes = await getRoutes();
    const server = makeServer().listen(PORT);
    const base = `http://localhost:${PORT}`;
    const browser = await puppeteer.launch({
        headless: true,
        // --disable-dev-shm-usage matters in containers: the default /dev/shm is
        // 64MB and Chrome crashes with opaque "Target closed" errors once a few
        // tabs are open. Vercel's builder is a container.
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const started = Date.now();
    const queue = [...routes];
    const failures = [];
    let done = 0;

    const worker = async () => {
        while (queue.length) {
            const route = queue.shift();
            const res = await renderTo(browser, base, route);
            done++;
            if (res.ok) {
                if (done % 25 === 0 || done === routes.length) {
                    console.log(`  ${done}/${routes.length} rendered`);
                }
            } else {
                failures.push(res);
                console.warn(`  FAILED ${res.route} — ${res.error}`);
            }
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    await browser.close();
    server.close();

    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`\nPrerendered ${routes.length - failures.length}/${routes.length} routes in ${secs}s.`);

    /*
     * A few failed routes still fall back to the SPA shell and work fine for
     * real users, so a couple of flaky renders should not block a release. A
     * large share failing means something systemic — bad API, out of memory,
     * missing Chromium libraries — and shipping that would quietly degrade
     * indexing across the whole catalogue.
     */
    if (failures.length) {
        const pct = (failures.length / routes.length) * 100;
        console.warn(`${failures.length} route(s) failed (${pct.toFixed(1)}%).`);
        if (pct > 10) {
            console.error("More than 10% of routes failed — failing the build.");
            process.exit(1);
        }
    }
}

main().catch((e) => {
    console.error(`Prerender failed: ${e.message}`);
    process.exit(1);
});
