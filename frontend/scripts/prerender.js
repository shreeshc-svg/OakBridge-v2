/*
 * Post-build prerender: renders each route to static HTML with Puppeteer so
 * crawlers and AI engines receive real, indexable content (not an empty shell).
 *
 * Run AFTER a production build:
 *   yarn build
 *   BACKEND_URL=http://localhost:8000 yarn prerender     (backend up = book pages too)
 *
 * Requires: puppeteer (devDependency) and a completed build/ folder.
 * Safe to skip — it never touches the normal `yarn build`.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const BACKEND = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
const PORT = Number(process.env.PRERENDER_PORT || 45678);

const MIME = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
    ".txt": "text/plain", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
};

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

async function getRoutes() {
    const staticRoutes = [
        "/", "/books", "/authors", "/events", "/about", "/contact",
        "/submissions", "/academy", "/digital-solutions", "/what-we-do",
        "/terms", "/privacy", "/refund-policy", "/shipping-policy",
    ];
    const dynamic = [];
    try {
        const books = await fetch(`${BACKEND}/api/books?limit=1000`).then((r) => r.json());
        for (const b of books) dynamic.push(`/books/${b.id}`);
        console.log(`Discovered ${books.length} book routes from the API.`);
    } catch (e) {
        console.warn("Could not reach API for book routes (static pages only):", e.message);
    }
    try {
        const authors = await fetch(`${BACKEND}/api/authors`).then((r) => r.json());
        for (const a of authors) dynamic.push(`/authors/${a.id}`);
        console.log(`Discovered ${authors.length} author routes from the API.`);
    } catch (e) {
        console.warn("Could not reach API for author routes:", e.message);
    }
    return [...staticRoutes, ...dynamic];
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

    const server = makeServer().listen(PORT);
    const base = `http://localhost:${PORT}`;
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const routes = await getRoutes();
    let done = 0;
    for (const route of routes) {
        const page = await browser.newPage();
        try {
            await page.goto(base + route, { waitUntil: "networkidle0", timeout: 45000 });
            await new Promise((r) => setTimeout(r, 300)); // let React settle head tags
            const html = "<!doctype html>\n" + (await page.evaluate(() => document.documentElement.outerHTML));
            const outDir = route === "/" ? BUILD : path.join(BUILD, route);
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, "index.html"), html);
            done++;
            console.log(`  ok  ${route}`);
        } catch (e) {
            console.warn(`  --  ${route}  (${e.message})`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    server.close();
    console.log(`\nPrerendered ${done}/${routes.length} routes into build/.`);
}

main();
