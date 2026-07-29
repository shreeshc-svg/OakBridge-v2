#!/usr/bin/env node
/*
 * Static sanity gate for the Oakbridge repo.
 *
 * Runs on every commit (via .githooks/pre-commit) and again inside the Vercel
 * build, so a commit that bypasses the hook still cannot deploy.
 *
 * WHAT THIS IS FOR
 *
 * The site is live and taking orders. The expensive failures here have not been
 * exotic — they have been a syntax error, an unused variable that CRA turns
 * into a build failure under CI=true, two lists in different languages drifting
 * apart, and a page quietly losing its <title>. Every check below exists
 * because that class of thing actually happened or was caught in review.
 *
 * WHAT IT IS NOT
 *
 * It does not run the build, start a browser or hit the network. It must finish
 * in seconds or it will be bypassed, and a gate that gets bypassed is not a
 * gate. Anything needing a real build is verified on the Vercel preview.
 *
 * Usage:  node scripts/sanity-check.js          (from frontend/)
 *         yarn sanity
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const FRONTEND = path.join(__dirname, "..");
const REPO = path.join(FRONTEND, "..");
const BACKEND = path.join(REPO, "backend");

const failures = [];
const warnings = [];
const passed = [];

const fail = (check, detail) => failures.push(`${check}: ${detail}`);
const warn = (check, detail) => warnings.push(`${check}: ${detail}`);
const pass = (check, detail) => passed.push(detail ? `${check} — ${detail}` : check);

const read = (p) => fs.readFileSync(p, "utf8");
const exists = (p) => fs.existsSync(p);

function walk(dir, filter, out = []) {
    if (!exists(dir)) return out;
    // A virtualenv holds tens of thousands of .py files. `.venv` is skipped by
    // the dot rule, but `venv/` or `env/` is not, and feeding site-packages to
    // execFileSync blows past Windows' 32k argv limit and throws. pyvenv.cfg is
    // the reliable marker whatever the directory is called.
    if (exists(path.join(dir, "pyvenv.cfg"))) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, filter, out);
        else if (filter(entry.name)) out.push(full);
    }
    return out;
}

/* ------------------------------------------------------------------ 1. JS/JSX
 * Catches syntax errors before they reach a build that takes ten minutes to
 * tell you the same thing.
 */
function checkJsSyntax() {
    let parser;
    try {
        parser = require("@babel/parser");
    } catch {
        warn("js-syntax", "@babel/parser unavailable — skipped (run yarn install)");
        return;
    }
    const files = walk(path.join(FRONTEND, "src"), (n) => /\.(js|jsx)$/.test(n));
    const bad = [];
    for (const f of files) {
        try {
            parser.parse(read(f), {
                sourceType: "module",
                plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator"],
            });
        } catch (e) {
            bad.push(`${path.relative(REPO, f)} — ${e.message.split("\n")[0]}`);
        }
    }
    if (bad.length) bad.forEach((b) => fail("js-syntax", b));
    else pass("js-syntax", `${files.length} files parse`);
}

/* --------------------------------------------------------- 2. Node scripts */
function checkNodeScripts() {
    const files = walk(path.join(FRONTEND, "scripts"), (n) => /\.(js|cjs)$/.test(n));
    const bad = [];
    for (const f of files) {
        try {
            execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
        } catch (e) {
            bad.push(`${path.relative(REPO, f)} — ${String(e.stderr || e).split("\n")[1] || "parse error"}`);
        }
    }
    if (bad.length) bad.forEach((b) => fail("node-scripts", b));
    else pass("node-scripts", `${files.length} scripts parse`);
}

/* ------------------------------------------------------------- 3. Python */
function checkPython() {
    const files = walk(BACKEND, (n) => n.endsWith(".py"));
    if (!files.length) {
        // Say so rather than returning silently. Vercel's Root Directory is
        // frontend/, so backend/ is usually absent there — and a check that
        // quietly does nothing reads exactly like a check that passed.
        warn("python", "backend/ not present (expected on Vercel) — not checked here");
        return;
    }
    let py = null;
    for (const cand of ["python3", "python"]) {
        try {
            execFileSync(cand, ["--version"], { stdio: "pipe" });
            py = cand;
            break;
        } catch { /* try next */ }
    }
    if (!py) {
        warn("python", "no python interpreter found — skipped");
        return;
    }
    try {
        execFileSync(py, ["-m", "py_compile", ...files], { stdio: "pipe" });
        pass("python", `${files.length} modules compile`);
    } catch (e) {
        fail("python", String(e.stderr || e).trim().split("\n").slice(-3).join(" | "));
    }
}

/* ---------------------------------------------------------------- 4. JSON */
function checkJson() {
    const files = [
        path.join(FRONTEND, "package.json"),
        path.join(FRONTEND, "vercel.json"),
    ].filter(exists);
    for (const f of files) {
        try {
            JSON.parse(read(f));
        } catch (e) {
            fail("json", `${path.relative(REPO, f)} — ${e.message}`);
            return;
        }
    }
    pass("json", `${files.length} config files valid`);
}

/* ------------------------------------------------------------- AST helpers */
function parseFile(file) {
    const parser = require("@babel/parser");
    return parser.parse(read(file), {
        sourceType: "module",
        plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator"],
    });
}

/** Depth-first walk, calling visit(node). Return false from visit to skip children. */
function walkAst(node, visit) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
        for (const n of node) walkAst(n, visit);
        return;
    }
    if (typeof node.type === "string" && visit(node) === false) return;
    for (const key of Object.keys(node)) {
        if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
        walkAst(node[key], visit);
    }
}

/* ------------------------------------------------------- 5. Unused imports
 * NOTE ON SEVERITY: this is a WARNING, not a failure.
 *
 * It was written as a blocker on the assumption that CRA's CI=true turns lint
 * warnings into build errors. That is true of a default CRA app — but
 * craco.config.js REPLACES the eslint config with `plugin:react-hooks/
 * recommended` alone, so `no-unused-vars` is not enabled here and an unused
 * import cannot fail this build. Verified against the live repo, which builds
 * green today while carrying one.
 *
 * Still worth surfacing: dead imports are how you discover that a deletion was
 * only half done. Just not worth blocking a release over.
 */
function checkUnusedImports() {
    try {
        require("@babel/parser");
    } catch {
        warn("unused-import", "@babel/parser unavailable — skipped");
        return;
    }
    const files = walk(path.join(FRONTEND, "src"), (n) => /\.(js|jsx)$/.test(n));
    const offenders = [];
    for (const f of files) {
        let ast;
        try {
            ast = parseFile(f);
        } catch {
            continue; // syntax failures are reported by checkJsSyntax
        }
        const imported = new Map(); // local name -> true
        const used = new Set();
        walkAst(ast.program.body, (node) => {
            if (node.type === "ImportDeclaration") {
                for (const s of node.specifiers) imported.set(s.local.name, true);
                return false; // do not count the import itself as a usage
            }
            if (node.type === "Identifier" || node.type === "JSXIdentifier") used.add(node.name);
            return true;
        });
        for (const name of imported.keys()) {
            if (name === "React") continue; // referenced implicitly by the JSX transform
            if (!used.has(name)) {
                offenders.push(`${path.relative(REPO, f)} — '${name}' imported but never used`);
            }
        }
    }
    if (offenders.length) offenders.forEach((o) => warn("unused-import", o));
    else pass("unused-import", "no dead imports");
}

/* -------------------------------------------------- 6. Every route has a title
 * With the static <title> gone from index.html, a route with no title source
 * renders untitled AND stalls the prerenderer, which waits on document.title
 * before capturing.
 *
 * KNOWN FALSE NEGATIVES — do not trust this check further than it goes. It
 * answers "does this file mention a title source anywhere", not "does every
 * render path produce a title". Two ways it has already been fooled:
 *
 * 1. PER FILE, NOT PER COMPONENT. Authors.jsx exports both the authors index
 *    and AuthorDetail; the index has a <Seo>, so the file matched and
 *    /authors/:id passed — while AuthorDetail had no title at all.
 *
 * 2. BRANCH-INSENSITIVE. BookDetail.jsx passed this check throughout the period
 *    its `loading` and `!book` early-return branches emitted no title. That gap
 *    is what made every book page time out during prerendering: the wait
 *    requires document.title, and the not-found branch never set one. The
 *    check reported "31 routes have a title source" the whole time.
 *
 * Both were found by reading code. A real version would walk each return path
 * separately; until then, treat a pass here as "nobody deleted the Seo import".
 */
function checkRouteTitles() {
    const appPath = path.join(FRONTEND, "src", "App.js");
    if (!exists(appPath)) return;
    try {
        require("@babel/parser");
    } catch {
        warn("route-title", "@babel/parser unavailable — skipped");
        return;
    }

    const srcFiles = walk(path.join(FRONTEND, "src"), (n) => /\.(js|jsx)$/.test(n));
    const byName = {};
    for (const f of srcFiles) byName[path.basename(f).replace(/\.(js|jsx)$/, "")] = f;

    /*
     * Elements that legitimately render no title and never should. Without this
     * list, a perfectly ordinary redirect —
     *     <Route path="/jobs" element={<Navigate to="/careers" replace />} />
     * — is reported as "no title source" and blocks BOTH the commit and, because
     * this script also runs in vercel.json's buildCommand, the deploy. On a live
     * shop that is a self-inflicted outage of the release process.
     */
    const TITLELESS_OK = new Set([
        "Navigate", "Outlet", "Suspense", "Fragment", "ErrorBoundary",
        "ProtectedRoute", "Route", "Routes",
    ]);

    /*
     * The cache key includes depth ON PURPOSE — do not "simplify" it.
     * providesTitle() depends on depth through the depth > 4 cutoff, so a false
     * computed near the limit is only valid at that depth. Keying on component
     * alone would let such a false poison the depth-0 answer and produce a
     * spurious failure. Wasteful (at most 5 entries per component), but correct.
     */
    const titleCache = new Map();
    const providesTitle = (component, depth = 0) => {
        if (depth > 4) return false;
        if (component === "Seo" || component === "NoIndex") return true;
        const key = `${component}:${depth}`;
        if (titleCache.has(key)) return titleCache.get(key);
        const file = byName[component];
        if (!file) return false;
        let ast;
        try {
            ast = parseFile(file);
        } catch {
            return false;
        }
        let found = false;
        const rendered = new Set();
        walkAst(ast.program.body, (node) => {
            if (node.type === "JSXOpeningElement" && node.name && node.name.type === "JSXIdentifier") {
                const n = node.name.name;
                if (n === "Seo" || n === "NoIndex" || n === "title") found = true;
                else if (/^[A-Z]/.test(n)) rendered.add(n);
            }
            return true;
        });
        if (!found) {
            for (const r of rendered) {
                if (r !== component && providesTitle(r, depth + 1)) {
                    found = true;
                    break;
                }
            }
        }
        titleCache.set(key, found);
        return found;
    };

    const untitled = [];
    let count = 0;
    const app = parseFile(appPath);
    walkAst(app.program.body, (node) => {
        if (node.type !== "JSXOpeningElement") return true;
        if (!node.name || node.name.name !== "Route") return true;

        const attrs = node.attributes || [];
        const pathAttr = attrs.find((a) => a.name && a.name.name === "path");
        const elAttr = attrs.find((a) => a.name && a.name.name === "element");
        if (!pathAttr || !elAttr || !pathAttr.value || pathAttr.value.type !== "StringLiteral") return true;
        const routePath = pathAttr.value.value;
        /*
         * Only top-level routes are checked. A relative path ("books",
         * "orders") is a child rendered inside a parent layout's <Outlet />,
         * and the layout supplies the title for all of them — AdminLayout does
         * exactly this for all 21 admin screens. Flagging children would report
         * 20 failures for one correctly-titled shell.
         */
        if (!routePath.startsWith("/")) return true;

        // Every component named inside element={...}
        const names = [];
        walkAst(elAttr.value, (n) => {
            if (n.type === "JSXOpeningElement" && n.name && n.name.type === "JSXIdentifier") {
                names.push(n.name.name);
            }
            return true;
        });
        // A route made entirely of title-less primitives (a bare redirect) is
        // fine; one that renders a real page component is not.
        const realComponents = names.filter((n) => !TITLELESS_OK.has(n));
        if (!realComponents.length) return true;

        count++;
        if (!realComponents.some((n) => providesTitle(n))) {
            untitled.push(`${routePath} (${realComponents.join(", ")})`);
        }
        return true;
    });

    if (untitled.length) untitled.forEach((u) => fail("route-title", `no title source: ${u}`));
    else pass("route-title", `${count} routes have a title source`);
}

/* ------------------------------------- 7. Prerender / sitemap route parity */
function checkRouteParity() {
    const pre = path.join(FRONTEND, "scripts", "prerender.js");
    const srv = path.join(BACKEND, "server.py");
    if (!exists(pre) || !exists(srv)) {
        warn("route-parity", "backend/server.py not reachable (expected on Vercel) — not checked here");
        return;
    }

    const grab = (src, markers) => {
        for (const marker of [].concat(markers)) {
            const i = src.indexOf(marker);
            if (i === -1) continue;
            const block = src.slice(i + marker.length, src.indexOf("]", i));
            return [...block.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        }
        return null;
    };
    // Both spellings: the module-level STATIC_ROUTES of the rewritten script,
    // and the function-local `staticRoutes` of the original. Matching only the
    // first meant this check silently warned forever on any branch still
    // carrying the old script — a check that reads like a check but isn't one.
    const a = grab(read(pre), ["const STATIC_ROUTES = [", "const staticRoutes = ["]);
    const b = grab(read(srv), ["_SITEMAP_STATIC_PATHS = ["]);
    if (!a || !b) {
        warn("route-parity", "could not locate one of the route lists — NOT checked");
        return;
    }
    const onlyA = a.filter((x) => !b.includes(x));
    const onlyB = b.filter((x) => !a.includes(x));
    if (onlyA.length || onlyB.length) {
        fail("route-parity", `prerender-only=[${onlyA}] sitemap-only=[${onlyB}]`);
    } else {
        pass("route-parity", `${a.length} routes match between prerender and sitemap`);
    }
}

/* ------------------------------------------- 8. Vercel fallback is coherent */
function checkVercelFallback() {
    const vp = path.join(FRONTEND, "vercel.json");
    if (!exists(vp)) return;
    const cfg = JSON.parse(read(vp));
    const catchAll = (cfg.rewrites || []).find((r) => r.source === "/(.*)");
    if (!catchAll) {
        fail("vercel-fallback", "no catch-all rewrite — client routes would 404");
        return;
    }
    const dest = catchAll.destination;
    const buildCmd = cfg.buildCommand || "";
    const pkg = JSON.parse(read(path.join(FRONTEND, "package.json")));
    const buildScript = (pkg.scripts && pkg.scripts.build) || "";

    if (dest === "/app-shell.html") {
        if (!/app-shell/.test(buildScript)) {
            fail(
                "vercel-fallback",
                "rewrite targets /app-shell.html but `build` does not produce it — every client route would 404",
            );
            return;
        }
        pass("vercel-fallback", "catch-all -> /app-shell.html, produced by build");
    } else if (dest === "/index.html") {
        if (/build:seo|prerender/.test(buildCmd)) {
            fail(
                "vercel-fallback",
                "prerendering overwrites index.html with the homepage; catch-all must target /app-shell.html",
            );
            return;
        }
        pass("vercel-fallback", "catch-all -> /index.html (no prerender)");
    } else {
        warn("vercel-fallback", `unrecognised destination ${dest}`);
    }
}

/* ------------------------------------- 9. No static sitemap shadowing the API
 * vercel.json rewrites /sitemap.xml to the API, which generates it from the
 * live catalogue. Rewrites are consulted only AFTER the filesystem, so a
 * public/sitemap.xml would silently win and freeze the sitemap at whenever it
 * was generated — dropping new titles and, since scripts/generate-sitemap.js
 * emits per-category URLs, submitting /books?category=... duplicates.
 *
 * `yarn sitemap` produces exactly that file. It is a footgun sitting in
 * package.json, so this makes it loud instead of silent.
 */
function checkNoStaticSitemap() {
    const p = path.join(FRONTEND, "public", "sitemap.xml");
    if (exists(p)) {
        fail(
            "sitemap",
            "frontend/public/sitemap.xml exists — it would shadow the live API sitemap " +
            "(filesystem beats rewrites). Delete it; the API generates the real one.",
        );
        return;
    }
    pass("sitemap", "no static sitemap shadowing the API");
}

/* ----------------------------------------------- 10. No secrets in the repo */
function checkSecrets() {
    const patterns = [
        [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
        [/mongodb\+srv:\/\/[^\s"']*:[^\s"'@]+@/, "MongoDB URI with password"],
        [/rzp_live_[A-Za-z0-9]+/, "Razorpay LIVE key"],
        [/-----BEGIN (?:RSA )?PRIVATE KEY-----/, "private key"],
    ];
    /*
     * Extensions matter here. An earlier version scanned only .js/.jsx/.py/.json
     * and therefore could not see backend/mongo.txt — a real file in this repo
     * holding a live mongodb+srv URI, password and all. It is gitignored, so
     * nothing leaked, but a scanner that cannot see the one file most likely to
     * hold a credential is worse than none: it grants confidence it hasn't
     * earned. Plain text, env and config files are where secrets actually get
     * parked "just for a minute".
     */
    const scannable = (n) => /\.(js|jsx|json|py|txt|env|ya?ml|md|cfg|ini|sh)$/.test(n) || /^\.env/.test(n);

    /*
     * Scan what git TRACKS, not what is on disk. The distinction is the whole
     * point: a credential in a gitignored file has not leaked and never will,
     * while the same string in a tracked file is public the moment you push.
     * Walking the disk would fail this gate forever on backend/mongo.txt, which
     * is correctly ignored — and a gate that cries wolf gets bypassed, which
     * costs more than it saves.
     */
    let files;
    try {
        files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, maxBuffer: 32 * 1024 * 1024 })
            .toString()
            .split("\0")
            .filter((f) => f && scannable(path.basename(f)))
            .map((f) => path.join(REPO, f))
            .filter(exists);
    } catch {
        // Not a git checkout (or git missing) — fall back to disk, minus ignored.
        files = [
            ...walk(path.join(FRONTEND, "src"), scannable),
            ...walk(BACKEND, scannable),
        ];
    }
    const hits = [];
    for (const f of files) {
        const src = read(f);
        for (const [re, label] of patterns) {
            if (re.test(src)) hits.push(`${path.relative(REPO, f)} — possible ${label}`);
        }
    }
    if (hits.length) hits.forEach((h) => fail("secrets", h));
    else pass("secrets", `${files.length} files clean`);
}

/* --------------------------------------------------------------- reporting */
const CHECKS = [
    checkJsSyntax, checkNodeScripts, checkPython, checkJson,
    checkUnusedImports, checkRouteTitles, checkRouteParity,
    checkVercelFallback, checkNoStaticSitemap, checkSecrets,
];

for (const c of CHECKS) {
    try {
        c();
    } catch (e) {
        fail(c.name, `check itself threw — ${e.message}`);
    }
}

console.log("\nSanity check\n" + "-".repeat(60));
passed.forEach((p) => console.log(`  ok    ${p}`));
warnings.forEach((w) => console.log(`  warn  ${w}`));
failures.forEach((f) => console.log(`  FAIL  ${f}`));
console.log("-".repeat(60));

if (failures.length) {
    console.error(`${failures.length} failure(s). Commit/build blocked.\n`);
    process.exit(1);
}
console.log(`All ${passed.length} checks passed${warnings.length ? `, ${warnings.length} warning(s)` : ""}.\n`);
