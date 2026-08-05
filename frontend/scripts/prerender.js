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
 *   PRERENDER_PORT         default 3000 — NOT arbitrary, see the note below.
 *   PRERENDER_CONCURRENCY  parallel pages (default 6)
 *   PRERENDER_ALLOW_EMPTY  set to "1" to tolerate zero book routes
 *
 * Also required, though read by CRA at compile time rather than by this script:
 *   REACT_APP_BACKEND_URL  set in the Vercel project, not in vercel.json. If it
 *                          is missing the bundle calls "undefined/api" and every
 *                          page renders its not-found state. Checked below.
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
/*
 * PORT 3000 IS LOAD-BEARING — it is not an arbitrary free port.
 *
 * The rendered page runs in a real browser at http://localhost:PORT and calls
 * the API at REACT_APP_BACKEND_URL, which is a different origin, so the browser
 * enforces CORS. backend/server.py's allowlist is oakbridge.in,
 * www.oakbridge.in, oak-bridge-v2.vercel.app and http://localhost:3000 (plus
 * anything in the CORS_ORIGINS env var). On the old port 45678 every API call
 * from every prerendered page was blocked.
 *
 * The failure was disguised: the Node-side fetch that enumerates routes is not
 * subject to CORS, so the log cheerfully said "Discovered 194 book routes"
 * while the browser could not load a single one of them. Book and author pages
 * then fell into their not-found branch, which sets no title, and each burned
 * the full 15s wait before failing.
 *
 * Serving on 3000 makes the prerenderer look exactly like the dev server, which
 * is what it is. If that origin is ever removed from the backend allowlist,
 * this breaks again — loudly, at least, since the content guard below refuses
 * to write a data-less page.
 */
const PORT = Number(process.env.PRERENDER_PORT || 3000);

/*
 * How long a route may take to settle.
 *
 * /terms renders from a bundle already in memory. /books/{id} cannot finish
 * until the API has answered, and under six-way concurrency those requests
 * queue behind each other — so the same 15s budget was generous for one and
 * tight for the other. Sixteen routes timed out on a build where the API was
 * merely slow, and every one of them shipped as an empty shell.
 */
const BUDGET_STATIC = Number(process.env.PRERENDER_TIMEOUT || 15000);
const BUDGET_API = BUDGET_STATIC * 2;
const needsApi = (route) =>
    /^\/(books|authors)\//.test(route) || route === "/books" || route === "/authors";
const budgetFor = (route) => (needsApi(route) ? BUDGET_API : BUDGET_STATIC);
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

/*
 * Routes whose rendered HTML must contain a given string, or the render counts
 * as a failure.
 *
 * The CORS outage that broke the first two attempts was invisible on these
 * pages: they render their <Seo> unconditionally, so they got a title, passed
 * every structural check and were recorded as successes — while containing not
 * one book. A prerendered bookstore listing zero titles is worse than no
 * prerendering at all, because it is exactly what a crawler would index.
 *
 * Only assert on pages where emptiness is unambiguously wrong. A page that is
 * legitimately empty some of the time does not belong here.
 */
const ROUTE_ASSERTIONS = {
    // The catalogue grid. Renders one of these per result, so an empty string
    // here means the API returned nothing.
    //
    // Also asserts the page still calls itself the Bookstore. /books
    // auto-applies the Professional filter on landing, and it used to take its
    // title and canonical from that — so the catalogue URL announced itself as
    // "Professional" and canonicalised to a filtered view of itself. Caught on
    // a preview, not by any check; now it is a check.
    // Matched on the title TEXT, not on "<title>Bookstore" — React may add
    // attributes to the tag, and an assertion that breaks on a framework detail
    // fails builds for no reason. The href form pins the canonical precisely:
    // it must be /books with NO query string, which is the actual regression.
    "/books": [
        'data-testid="book-card-',
        "Bookstore · Oakbridge Publishing",
        'href="https://www.oakbridge.in/books"',
    ],
    // One tile per author. NOT the bare word "author" — that appears in the
    // canonical URL and several wrapper testids, so it matches a completely
    // empty page and can never fail.
    "/authors": ['data-testid="author-tile-'],
};

/** Every route's assertions as an array, so a route can require several things. */
const assertionsFor = (route) => [].concat(ROUTE_ASSERTIONS[route] || []);

/*
 * NOT asserted, deliberately:
 *
 * "/" — the homepage's only book cards live in the "Hot Off the Press" section,
 * which an admin can hide from Admin → Pages. A content editor unticking a
 * section they are entitled to hide would red every subsequent deploy, on a
 * live shop, with an error message about API data. An assertion that a
 * non-technical colleague can trip is a worse bug than the one it guards.
 *
 * Note also that "/books" mounts with category=professional applied, so this
 * asserts that one category is non-empty rather than the whole catalogue.
 */

/*
 * `shell` is the ORIGINAL build/index.html, read into memory once before any
 * route is written, and served for every unmatched path.
 *
 * It must not be re-read from disk. Rendering "/" overwrites build/index.html
 * with the prerendered homepage, and that file doubles as the SPA fallback this
 * server hands to every other route. Reading from disk therefore meant: "/"
 * finishes first (it is first in STATIC_ROUTES), and every route after it gets
 * served the prerendered HOMEPAGE as its starting shell — complete with the
 * homepage's baked <title> and canonical, which React cannot remove because it
 * never created them. Roughly 200 pages would have shipped two titles and two
 * conflicting canonicals: the exact failure this whole change exists to fix.
 *
 * Serving from memory also removes a read/write race — six workers reading the
 * file while a seventh truncates it mid-write.
 */
let shell = null;

function makeServer() {
    return http.createServer((req, res) => {
        // decodeURIComponent throws URIError on a malformed escape ("/a%zz").
        // Unguarded, that is an uncaught exception inside the request handler,
        // which kills the process and the whole build mid-render.
        let urlPath;
        try {
            urlPath = decodeURIComponent(req.url.split("?")[0]);
        } catch {
            res.writeHead(400).end();
            return;
        }
        const filePath = path.join(BUILD, urlPath);
        // Confine to build/ — a crafted id must not read outside it.
        const inBuild = path.resolve(filePath).startsWith(path.resolve(BUILD) + path.sep);
        if (urlPath !== "/" && inBuild && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(shell);
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
    // newPage() and close() are INSIDE the try/finally on purpose. Both reject
    // occasionally under concurrency ("Target closed"), and when they did so
    // outside it the rejection escaped the worker, rejected Promise.all, and
    // failed the entire build — bypassing the 10%-tolerance policy below and
    // leaving Chrome and the http server running.
    let page = null;
    try {
        page = await browser.newPage();
        /*
         * networkidle0 waits for EVERY connection to go quiet. A single poller,
         * websocket or analytics beacon that never settles turns each page into
         * a full timeout, and 200+ routes at 45s each is a two-hour build.
         * networkidle2 tolerates a couple of long-lived connections; the
         * explicit wait below is what actually proves React has rendered.
         */
        await page.goto(base + route, { waitUntil: "networkidle2", timeout: 30000 });
        /*
         * The required substring is part of the WAIT, not a check afterwards.
         *
         * networkidle2 resolves once at most two connections have been quiet for
         * 500ms — the homepage fires about seven at once, so `goto` can return
         * while the catalogue request is still in flight. Asserting after the
         * fact would then fail a page that was merely a moment from being
         * correct: a race dressed up as a check, red builds at random.
         *
         * Polling in the browser until the content appears makes the 15s a real
         * budget instead of a snapshot.
         */
        const expected = assertionsFor(route);
        await page.waitForFunction(
            (needles) => {
                const root = document.getElementById("root");
                if (!root || root.children.length === 0 || !document.title) return false;
                if (!needles.length) return true;
                const html = document.documentElement.outerHTML;
                return needles.every((n) => html.includes(n));
            },
            { timeout: budgetFor(route) },
            expected,
        );
        const html = "<!doctype html>\n" + (await page.evaluate(() => document.documentElement.outerHTML));

        /*
         * Guard against writing an unrendered page.
         *
         * This used to search for the "You need to enable JavaScript" noscript
         * text — which is present in EVERY rendered page, because <noscript>
         * survives serialisation whether or not scripting is on. That check
         * would have failed 100% of routes and made the build red on its first
         * run. What actually distinguishes an unrendered page is an empty root.
         */
        if (/<div id="root">\s*<\/div>/.test(html)) {
            throw new Error("#root is empty — the app did not render");
        }

        /*
         * Refuse to write an error page to a real URL.
         *
         * An empty-root check is not enough. When the data layer fails, these
         * pages render a perfectly well-formed "Book not found." — real markup,
         * real title, passes every structural check — and baking that into
         * /books/<id> would serve a 200-OK "this book does not exist" to every
         * crawler and every visitor arriving from search, for a book we sell.
         * Silently shipping that is far worse than failing the build.
         *
         * These strings are the not-found copy in BookDetail, Authors and
         * NotFound. If that copy is reworded, reword it here too.
         */
        const ERROR_MARKERS = ["Book not found.", "Author not found.", "Page not found"];
        const marker = ERROR_MARKERS.find((m) => html.includes(m));
        if (marker) {
            throw new Error(
                `rendered the "${marker}" state — the page's data did not load ` +
                `(check CORS on the API for origin http://localhost:${PORT})`,
            );
        }

        // Belt and braces: the wait above already required these, so reaching
        // here without one would mean the DOM changed between poll and capture.
        const missing = expected.filter((n) => !html.includes(n));
        if (missing.length) {
            throw new Error(
                `content vanished between the wait and the capture: ${JSON.stringify(missing)}`,
            );
        }

        const outDir = route === "/" ? BUILD : path.join(BUILD, route);
        /*
         * `startsWith(BUILD)` alone is a prefix match, not containment: it
         * accepts sibling directories whose names merely begin with the same
         * characters, so a crafted id could write into build-backup/ or buildX/.
         * The separator has to be part of the test — with an explicit equality
         * case, because route "/" legitimately resolves to BUILD itself.
         */
        const resolved = path.resolve(outDir);
        const root = path.resolve(BUILD);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
            throw new Error(`route would write outside build/: ${route}`);
        }
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "index.html"), html);
        return { route, ok: true };
    } catch (e) {
        return { route, ok: false, error: e.message };
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

/**
 * Wait for the API to answer before rendering anything against it.
 *
 * Render spins a service down when idle and takes tens of seconds to come back.
 * Push the backend and the frontend together and Vercel starts three hundred
 * renders against an API that is still booting — which is exactly the build
 * that produced sixteen timed-out routes.
 *
 * Costs a few seconds on a warm API and saves the build on a cold one. Does not
 * abort if the API never answers: the routes will fail on their own and say so
 * more usefully than a warm-up error would.
 */
async function warmBackend() {
    if (!BACKEND) return;
    const url = `${BACKEND}/api/health`;
    const deadline = Date.now() + 90000;
    let attempt = 0;
    while (Date.now() < deadline) {
        attempt++;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
                console.log(`API awake after ${attempt} attempt(s).`);
                return;
            }
            console.log(`  API answered ${res.status}, waiting…`);
        } catch (e) {
            console.log(`  API not answering yet (${e.message}), waiting…`);
        }
        await new Promise((r) => setTimeout(r, 3000));
    }
    console.warn("API did not become healthy within 90s — rendering anyway.");
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

    await warmBackend();

    const routes = await getRoutes();

    /*
     * The shell comes from app-shell.html, written by scripts/app-shell.js at
     * the end of the ordinary build — NOT from index.html, which this script is
     * about to overwrite with the rendered homepage. Reading index.html made a
     * second run over the same build/ serve the homepage as every route's
     * starting shell, baking the homepage title and canonical into ~200 pages.
     */
    /*
     * Prove the bundle can actually reach the API before rendering 350 pages.
     *
     * REACT_APP_BACKEND_URL is baked into the JS at build time, not read at
     * runtime. If it is unset on the builder, CRA substitutes the literal
     * `undefined`, every request goes to "undefined/api" — which this very
     * server answers with the SPA shell, HTTP 200 — and each page quietly falls
     * into its not-found branch. That produces EXACTLY the same symptom as the
     * CORS failure this port change addresses: 100% of dynamic routes timing
     * out. Two very different causes, one indistinguishable log line.
     *
     * So read it out of the compiled bundle and say which world we are in,
     * rather than burning a ten-minute build to find out.
     */
    const bundles = fs
        .readdirSync(path.join(BUILD, "static", "js"))
        .filter((f) => f.startsWith("main.") && f.endsWith(".js"));
    if (bundles.length) {
        const js = fs.readFileSync(path.join(BUILD, "static", "js", bundles[0]), "utf8");
        const apiHost = (BACKEND.match(/^https?:\/\/[^/]+/) || [])[0] || "";
        if (js.includes("undefined/api")) {
            throw new Error(
                "The bundle contains \"undefined/api\" — REACT_APP_BACKEND_URL was not set when " +
                "CRA compiled. Set it in the Vercel project's Environment Variables (it is NOT " +
                "in vercel.json) and rebuild. Prerendering every page would produce 'not found'.",
            );
        }
        if (js.includes("localhost:8000")) {
            throw new Error(
                "The bundle points at localhost:8000 — a .env file leaked into the build. " +
                "Every prerendered page would fail to load data.",
            );
        }
        console.log(
            apiHost && js.includes(apiHost)
                ? `Bundle targets ${apiHost} — good.`
                : `WARNING: could not confirm the bundle targets ${apiHost || "the API"}.`,
        );
    }

    const shellPath = path.join(BUILD, "app-shell.html");
    if (!fs.existsSync(shellPath)) {
        throw new Error(
            "build/app-shell.html is missing. `yarn build` should have created it — " +
            "run the full build rather than invoking this script alone.",
        );
    }
    shell = fs.readFileSync(shellPath, "utf8");

    const server = makeServer();
    /*
     * Without this, an EADDRINUSE emits an 'error' event with no listener,
     * which becomes an uncaught exception on a later tick — outside
     * main().catch() — so the operator gets a bare Node stack trace instead of
     * any of the diagnostics written here. Locally that is not hypothetical:
     * port 3000 is the CRA dev server, so `yarn build:seo` while `yarn start`
     * is running hits it every time.
     */
    server.on("error", (e) => {
        console.error(
            e.code === "EADDRINUSE"
                ? `Port ${PORT} is already in use — stop whatever is on it (the dev server?), ` +
                  `or set PRERENDER_PORT. Note that 3000 is not arbitrary: it is the origin the ` +
                  `API's CORS allowlist accepts, so any replacement must be added there too.`
                : `Prerender server error: ${e.message}`,
        );
        process.exit(1);
    });
    server.listen(PORT);
    server.unref();
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

    /*
     * One retry, single file.
     *
     * The failures on the build that prompted this were sixteen scattered
     * routes — some legal pages, some books — which is the shape of an API
     * that was intermittently slow, not of pages that cannot render. Six
     * parallel renders all waiting on the same backend make that worse, so the
     * second attempt runs one at a time against an API that has by then been
     * warmed by three hundred requests.
     *
     * Once only. A route that fails twice, alone, with a doubled budget, has
     * something actually wrong with it and should be reported rather than
     * retried until the build times out.
     */
    let retried = [];
    if (failures.length) {
        console.log(`\nRetrying ${failures.length} failed route(s) one at a time…`);
        const stillFailing = [];
        for (const f of failures) {
            const res = await renderTo(browser, base, f.route);
            if (res.ok) {
                retried.push(f.route);
                console.log(`  RECOVERED ${f.route}`);
            } else {
                stillFailing.push(res);
                console.warn(`  STILL FAILING ${res.route} — ${res.error}`);
            }
        }
        failures.length = 0;
        failures.push(...stillFailing);
    }

    await browser.close();
    server.close();

    const secs = ((Date.now() - started) / 1000).toFixed(0);
    const ok = routes.length - failures.length;
    console.log(
        `\nPrerendered ${ok}/${routes.length} routes in ${secs}s` +
            (retried.length ? ` (${retried.length} recovered on retry).` : "."),
    );

    /*
     * Tolerance is 2%, not 10%.
     *
     * At 10% a build could ship thirty-five unrendered pages and still go
     * green, which is what happened: sixteen routes fell back to the SPA shell,
     * and an unrendered page does not merely lose its content — it loses its
     * canonical, so Google is told the page is a duplicate of whatever the
     * shell claims. That is worse than a red build, and a red build is
     * recoverable in one click.
     *
     * After a retry pass, anything still failing is a real fault.
     */
    if (failures.length) {
        const pct = (failures.length / routes.length) * 100;
        console.warn(`${failures.length} route(s) failed after retry (${pct.toFixed(1)}%).`);
        for (const f of failures) console.warn(`  ${f.route} — ${f.error}`);
        if (pct > 2) {
            console.error("More than 2% of routes failed — failing the build.");
            process.exit(1);
        }
    }
}

main().catch((e) => {
    console.error(`Prerender failed: ${e.message}`);
    process.exit(1);
});
