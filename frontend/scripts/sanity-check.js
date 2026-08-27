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
        return;
    }

    /*
     * Compiling is not enough. A module that uses `re.split` without importing
     * `re` compiles perfectly and then raises NameError the first time that line
     * runs — which, for a fallback path like typo correction, might be days
     * later and only for the customer who typed the typo. Caught exactly that
     * while adding search correction to server.py.
     *
     * pyflakes finds undefined names without executing anything. If it is not
     * installed we say so rather than passing silently.
     */
    const checker = path.join(FRONTEND, "scripts", "undefined_names.py");
    if (!exists(checker)) {
        warn("python-names", "undefined_names.py missing — undefined names NOT checked");
        return;
    }
    try {
        execFileSync(py, [checker, ...files], { stdio: "pipe" });
        pass("python-names", `no undefined names in ${files.length} modules`);
    } catch (e) {
        /*
         * Exit 1 means "findings"; anything else means the checker itself blew
         * up. Distinguishing them matters: an empty stdout Buffer is TRUTHY in
         * JS, so `e.stdout || e.stderr` returned "" on a crash, .filter(Boolean)
         * removed everything, and the check reported neither pass nor fail — it
         * vanished from the output and the commit went through. A gate that can
         * disappear silently is worse than no gate.
         */
        const findings = String(e.stdout || "").split("\n").filter(Boolean);
        if (e.status === 1 && findings.length) {
            findings.forEach((l) => fail("python-names", l.trim()));
        } else {
            fail(
                "python-names",
                `checker failed to run (exit ${e.status}): ${String(e.stderr || e).trim().split("\n").slice(-2).join(" | ")}`,
            );
        }
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

/* ------------------------------- 8b. Every JSX component used is in scope
 * <CareersNudge /> without its import parses perfectly, builds perfectly, and
 * renders a blank page with a console error the moment anyone opens that route.
 * Caught exactly that while adding a careers link to the auth pages — the same
 * shape of bug as the missing `re` import in server.py, in the other language.
 *
 * Scope-blind on purpose, like the Python checker: it collects every name bound
 * ANYWHERE in the file and only reports what is bound nowhere at all. That
 * under-reports rather than crying wolf, which is what keeps a commit gate
 * usable.
 */
function checkJsxDefined() {
    try {
        require("@babel/parser");
    } catch {
        warn("jsx-defined", "@babel/parser unavailable — skipped");
        return;
    }
    // Names React resolves itself, or that are lower-cased host elements.
    const BUILTIN = new Set(["Fragment", "React", "Suspense", "StrictMode", "Profiler"]);
    const files = walk(path.join(FRONTEND, "src"), (n) => /\.jsx$/.test(n));
    const offenders = [];
    for (const f of files) {
        let ast;
        try {
            ast = parseFile(f);
        } catch {
            continue;
        }
        const bound = new Set(BUILTIN);
        const used = new Map(); // name -> line

        /*
         * Binds every identifier a pattern introduces, not just a plain name.
         * Components are routinely passed in and renamed on the way —
         * `({ icon: I }) => <I />` in BottomTray, `{ icon: Icon }` in
         * AdminDashboard — and treating those as undefined produced two false
         * failures on perfectly good code, which would have blocked every
         * commit in the repo.
         */
        const bindPattern = (n) => {
            if (!n) return;
            switch (n.type) {
                case "Identifier":
                    bound.add(n.name);
                    break;
                case "ObjectPattern":
                    for (const p of n.properties) bindPattern(p.value || p.argument);
                    break;
                case "ArrayPattern":
                    for (const el of n.elements) bindPattern(el);
                    break;
                case "AssignmentPattern":
                    bindPattern(n.left);
                    break;
                case "RestElement":
                    bindPattern(n.argument);
                    break;
                default:
                    break;
            }
        };

        walkAst(ast.program.body, (node) => {
            switch (node.type) {
                case "ImportDeclaration":
                    for (const s of node.specifiers) bound.add(s.local.name);
                    return false;
                case "FunctionDeclaration":
                case "FunctionExpression":
                case "ArrowFunctionExpression":
                    if (node.id) bound.add(node.id.name);
                    for (const p of node.params || []) bindPattern(p);
                    break;
                case "ClassDeclaration":
                    if (node.id) bound.add(node.id.name);
                    break;
                case "VariableDeclarator":
                    bindPattern(node.id);
                    break;
                case "CatchClause":
                    bindPattern(node.param);
                    break;
                case "JSXOpeningElement": {
                    const n = node.name;
                    // Only bare <Foo />. <Foo.Bar /> and <ns:foo /> resolve
                    // through an object that is checked on its own.
                    if (n && n.type === "JSXIdentifier" && /^[A-Z]/.test(n.name)) {
                        if (!used.has(n.name)) used.set(n.name, node.loc ? node.loc.start.line : "?");
                    }
                    break;
                }
                default:
                    break;
            }
            return true;
        });
        for (const [name, line] of used) {
            if (!bound.has(name)) {
                offenders.push(`${path.relative(REPO, f)}:${line} — <${name}> is used but never imported or defined`);
            }
        }
    }
    if (offenders.length) offenders.forEach((o) => fail("jsx-defined", o));
    else pass("jsx-defined", `every JSX component resolves in ${files.length} files`);
}

/* ------------------------------ 8c. Every identifier used in src/ is in scope
 * The JS twin of undefined_names.py. `useRef(null)` without adding useRef to
 * the React import parses, builds, and throws ReferenceError the moment that
 * component mounts — the third time this class of mistake reached a commit,
 * after `re` in server.py and <CareersNudge> in the auth pages.
 *
 * Scope-blind like its Python counterpart: it collects every name bound
 * ANYWHERE in the file and reports only what is bound nowhere. It under-reports
 * rather than crying wolf, because a gate that blocks correct code gets
 * bypassed and then guards nothing.
 */
const JS_GLOBALS = new Set([
    "window", "document", "console", "navigator", "location", "history", "screen",
    "localStorage", "sessionStorage", "fetch", "Request", "Response", "Headers",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
    "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback",
    "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date",
    "RegExp", "Error", "TypeError", "RangeError", "URIError", "SyntaxError",
    "Promise", "Symbol", "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect",
    // Typed arrays — the timeline's placement grid uses these, and the checker
    // reporting a real builtin as undefined is a false positive that blocks a
    // correct commit. Under-reporting is this checker's design; over-reporting
    // is the failure it must not have.
    "ArrayBuffer", "SharedArrayBuffer", "DataView",
    "Int8Array", "Uint8Array", "Uint8ClampedArray",
    "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
    "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
    "Intl", "BigInt", "globalThis", "structuredClone", "queueMicrotask",
    "URL", "URLSearchParams", "FormData", "Blob", "File", "FileReader",
    "AbortController", "Event", "CustomEvent", "IntersectionObserver",
    "ResizeObserver", "MutationObserver", "PerformanceObserver", "performance",
    "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
    "parseInt", "parseFloat", "isNaN", "isFinite", "NaN", "Infinity", "undefined",
    "alert", "confirm", "prompt", "atob", "btoa", "crypto", "matchMedia",
    "process", "module", "require", "exports", "__dirname", "__filename",
    "Image", "Audio", "Notification", "getComputedStyle", "DOMParser",
    "HTMLElement", "Node", "Text", "Buffer", "TextEncoder", "TextDecoder",
    "arguments", "this", "super",
]);

function checkJsDefined() {
    try {
        require("@babel/parser");
    } catch {
        warn("js-defined", "@babel/parser unavailable — skipped");
        return;
    }
    const files = walk(path.join(FRONTEND, "src"), (n) => /\.(js|jsx)$/.test(n));
    const offenders = [];
    for (const f of files) {
        let ast;
        try {
            ast = parseFile(f);
        } catch {
            continue;
        }
        const bound = new Set(JS_GLOBALS);
        const used = new Map();
        const skip = new Set();

        const bindPattern = (n) => {
            if (!n) return;
            switch (n.type) {
                case "Identifier": bound.add(n.name); break;
                case "ObjectPattern":
                    for (const p of n.properties) bindPattern(p.value || p.argument);
                    break;
                case "ArrayPattern":
                    for (const el of n.elements) bindPattern(el);
                    break;
                case "AssignmentPattern": bindPattern(n.left); break;
                case "RestElement": bindPattern(n.argument); break;
                default: break;
            }
        };

        walkAst(ast.program.body, (node) => {
            switch (node.type) {
                case "ImportDeclaration":
                    for (const s of node.specifiers) bound.add(s.local.name);
                    return false;
                case "FunctionDeclaration":
                case "FunctionExpression":
                case "ArrowFunctionExpression":
                    if (node.id) bound.add(node.id.name);
                    for (const p of node.params || []) bindPattern(p);
                    break;
                case "ClassDeclaration":
                case "ClassExpression":
                    if (node.id) bound.add(node.id.name);
                    break;
                case "VariableDeclarator": bindPattern(node.id); break;
                case "CatchClause": bindPattern(node.param); break;
                case "LabeledStatement": bound.add(node.label.name); break;
                /*
                 * `obj.foo`, `{ foo: 1 }` and `<div foo=…>` contain an
                 * Identifier node named foo that is NOT a variable read.
                 * Counting them would flag every property in the codebase.
                 *
                 * The parent is visited before its children in this walk, so
                 * marking the node here is enough — no re-walking, and none of
                 * the recursion the first attempt tripped over.
                 */
                case "MemberExpression":
                case "OptionalMemberExpression":
                    if (!node.computed) skip.add(node.property);
                    break;
                case "ObjectProperty":
                case "Property":
                case "ObjectMethod":
                    if (!node.computed) skip.add(node.key);
                    break;
                case "JSXAttribute":
                    skip.add(node.name);
                    break;
                case "Identifier":
                    if (!skip.has(node) && !used.has(node.name)) {
                        used.set(node.name, node.loc ? node.loc.start.line : "?");
                    }
                    break;
                default: break;
            }
            return true;
        });

        for (const [name, line] of used) {
            if (!bound.has(name)) {
                offenders.push(`${path.relative(REPO, f)}:${line} — '${name}' is used but never imported or defined`);
            }
        }
    }
    if (offenders.length) offenders.forEach((o) => fail("js-defined", o));
    else pass("js-defined", `every identifier resolves in ${files.length} files`);
}

/* --------------------------------------------- 9. Every <img> declares an alt
 * A MISSING alt and an EMPTY alt mean different things to a screen reader, and
 * only one of them is a decision. alt="" says "this is decoration, skip it";
 * no attribute at all makes the reader fall back to announcing the filename,
 * so a customer hears "9789395764544 dot jpg".
 *
 * This does not judge whether the text is any good — it cannot. It only insists
 * that somebody chose.
 */
function checkImgAlt() {
    try {
        require("@babel/parser");
    } catch {
        warn("img-alt", "@babel/parser unavailable — skipped");
        return;
    }
    const files = walk(path.join(FRONTEND, "src"), (n) => /\.jsx$/.test(n));
    const offenders = [];
    let total = 0;
    for (const f of files) {
        let ast;
        try {
            ast = parseFile(f);
        } catch {
            continue;
        }
        walkAst(ast.program.body, (node) => {
            if (node.type !== "JSXOpeningElement") return true;
            if (!node.name || node.name.name !== "img") return true;
            total++;
            const attrs = node.attributes || [];
            const hasAlt = attrs.some((a) => a.name && a.name.name === "alt");
            // A spread ({...props}) may supply it; can't prove otherwise.
            const hasSpread = attrs.some((a) => a.type === "JSXSpreadAttribute");
            if (!hasAlt && !hasSpread) {
                offenders.push(`${path.relative(REPO, f)}:${node.loc ? node.loc.start.line : "?"}`);
            }
            return true;
        });
    }
    if (offenders.length) offenders.forEach((o) => fail("img-alt", `<img> with no alt attribute: ${o}`));
    else pass("img-alt", `all ${total} <img> tags declare an alt`);
}

/* ------------------------------------ 10. No static sitemap shadowing the API
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

/* ------------------------------------------------- 14. Top-level stray JSX
 *
 * THE BUG THIS EXISTS FOR — it took the whole site down and nothing caught it.
 *
 * An edit left a block of JSX stranded at the top of AdminDashboard.jsx, ABOVE
 * its own import statements. It referenced `searchInsight`, a piece of
 * component state, from module scope where no such binding exists.
 *
 * Every gate waved it through. It is valid syntax, so js-syntax passed. Babel
 * compiled it and CRA said "Compiled successfully". js-defined passed because
 * it is scope-blind by design and `searchInsight` IS declared in the file, just
 * in a scope this expression cannot see.
 *
 * What it does at runtime is the worst case available: JSX at module level is
 * an expression that RUNS when the module is imported. App.js imports
 * AdminDashboard eagerly, so loading any page at all evaluated it and threw
 * ReferenceError before React mounted. Not the admin dashboard — every route,
 * including the homepage of a live shop. It cost four builds and a lot of the
 * owner's patience, chased through timeouts that were only ever a symptom.
 *
 * The rule is narrow on purpose, and therefore has no false positives: a
 * module's top level may contain declarations, imports and exports. A bare JSX
 * expression sitting there is never intentional — it is the fingerprint of an
 * edit that landed in the wrong place.
 */
function checkTopLevelJsx() {
    try {
        require("@babel/parser");
    } catch {
        warn("top-level-jsx", "@babel/parser unavailable — skipped");
        return;
    }
    const files = walk(path.join(FRONTEND, "src"), (n) => /\.(js|jsx)$/.test(n));
    const offenders = [];
    for (const f of files) {
        let ast;
        try {
            ast = parseFile(f);
        } catch {
            continue; // js-syntax owns parse errors
        }
        for (const node of ast.program.body) {
            if (
                node.type === "ExpressionStatement" &&
                (node.expression.type === "JSXElement" ||
                    node.expression.type === "JSXFragment")
            ) {
                offenders.push(
                    `${path.relative(REPO, f)}:${node.loc.start.line} — JSX at module top level. ` +
                        `It runs on import and cannot see component state; ` +
                        `it almost certainly belongs inside a component's return.`,
                );
            }
        }
    }
    if (offenders.length) offenders.forEach((o) => fail("top-level-jsx", o));
    else pass("top-level-jsx", `no stray JSX outside a component in ${files.length} files`);
}

/* ------------------------------------------------- 15. Admin section wiring
 *
 * THE BUG THIS EXISTS FOR
 *
 * The Spam page was invisible in the admin sidebar — to everyone, including
 * the superadmin — while the reorder screen listed it as item 22.
 *
 * Adding a page takes four edits in three files: a route, an ADMIN_NAV entry,
 * a key in SECTIONS on BOTH sides of the wire, and a SECTION_PATHS mapping.
 * Spam got the first two. Nothing failed. The backend hid it because can_path
 * answers True for a superadmin before looking anything up, so the API worked
 * perfectly; the frontend had no such short-circuit and quietly filtered the
 * link away. A feature that exists, is deployed, is reachable by URL, and
 * cannot be found.
 *
 * Both files carry a comment telling the next person to keep them in sync.
 * That comment had been there the whole time. This is the same instruction,
 * enforced.
 */
function checkAdminSections() {
    const navPath = path.join(FRONTEND, "src", "lib", "adminNav.js");
    const fePath = path.join(FRONTEND, "src", "lib", "rbac.js");
    const bePath = path.join(BACKEND, "rbac.py");
    for (const p of [navPath, fePath, bePath]) {
        if (!fs.existsSync(p)) {
            warn("admin-sections", `${path.relative(REPO, p)} not found — skipped`);
            return;
        }
    }

    // The list literal, then every quoted string inside it.
    const listOf = (src, re) => {
        const m = src.match(re);
        return m ? [...m[1].matchAll(/["']([\w-]+)["']/g)].map((x) => x[1]) : null;
    };

    const fe = listOf(read(fePath), /export const SECTIONS\s*=\s*\[([\s\S]*?)\]/);
    const be = listOf(read(bePath), /^SECTIONS[^=]*=\s*\(([\s\S]*?)\)/m);
    if (!fe || !be) {
        warn("admin-sections", "could not parse a SECTIONS list — skipped");
        return;
    }

    const problems = [];
    const missingOnBe = fe.filter((s) => !be.includes(s));
    const missingOnFe = be.filter((s) => !fe.includes(s));
    if (missingOnBe.length)
        problems.push(`in frontend SECTIONS but not backend: ${missingOnBe.join(", ")}`);
    if (missingOnFe.length)
        problems.push(`in backend SECTIONS but not frontend: ${missingOnFe.join(", ")}`);

    // Every sidebar link must resolve to a real section, or it renders for
    // nobody. "/admin" is the dashboard; the rest is the first path segment.
    const navSrc = read(navPath);
    const tos = [...navSrc.matchAll(/\{\s*to:\s*"([^"]+)"/g)].map((m) => m[1]);
    if (!tos.length) {
        warn("admin-sections", "could not parse ADMIN_NAV — skipped");
        return;
    }
    for (const to of tos) {
        const section =
            to === "/admin" || to === "/admin/"
                ? "dashboard"
                : to.replace(/^\/admin\//, "").split("/")[0];
        if (!fe.includes(section)) {
            problems.push(
                `ADMIN_NAV "${to}" needs section "${section}", which is not in SECTIONS — ` +
                    `the link is filtered out of the sidebar for every user`,
            );
        }
    }

    // A section nobody can be granted is a section that fails closed for
    // everyone below superadmin.
    const paths = read(bePath).match(/SECTION_PATHS[^=]*=\s*\{([\s\S]*?)\n\}/);
    if (paths) {
        const mapped = [...paths[1].matchAll(/^\s*"([\w-]+)":/gm)].map((m) => m[1]);
        const unmapped = be.filter((s) => s !== "dashboard" && !mapped.includes(s));
        if (unmapped.length)
            problems.push(
                `no SECTION_PATHS entry for: ${unmapped.join(", ")} — grantable to nobody`,
            );
    }

    if (problems.length) problems.forEach((p) => fail("admin-sections", p));
    else
        pass(
            "admin-sections",
            `${tos.length} sidebar links resolve, ${fe.length} sections match front to back`,
        );
}

/* ---------------------------------------- 16. No interactive inside an anchor
 * A <button> or a second link nested inside an <a>/<Link> is invalid HTML, and
 * the failure is not cosmetic: browsers recover by dropping one of the two,
 * unpredictably, so a control either stops working or steals the navigation
 * from the link around it. Keyboard users get one stop where there should be
 * two, and a screen reader announces something that matches neither.
 *
 * It is easy to introduce by accident — a card that is one big link, and then
 * somebody needs a toggle inside it. That is exactly how the homepage business
 * cards got a disclosure button, and the fix (a stretched heading link, with
 * the button above it) is invisible unless something is watching for the
 * mistake it replaced.
 */
function checkNestedInteractive() {
    try {
        require("@babel/parser");
    } catch {
        warn("nested-interactive", "@babel/parser unavailable — skipped");
        return;
    }
    const isAnchor = (n) =>
        n.type === "JSXElement" &&
        n.openingElement.name &&
        (n.openingElement.name.name === "a" || n.openingElement.name.name === "Link");
    const isInteractive = (n) =>
        n.type === "JSXElement" &&
        n.openingElement.name &&
        ["button", "a", "Link", "select", "textarea", "input"].includes(n.openingElement.name.name);

    const files = walk(path.join(FRONTEND, "src"), (n) => /\.jsx$/.test(n));
    const offenders = [];
    let anchors = 0;
    for (const f of files) {
        let ast;
        try {
            ast = parseFile(f);
        } catch {
            continue;
        }
        walkAst(ast.program.body, (node) => {
            if (!isAnchor(node)) return true;
            anchors++;
            // Descend the subtree looking for another interactive element.
            walkAst(node.children || [], (inner) => {
                if (isInteractive(inner)) {
                    offenders.push(
                        `${path.relative(REPO, f)}:${inner.loc ? inner.loc.start.line : "?"} — <${inner.openingElement.name.name}> inside <${node.openingElement.name.name}>`,
                    );
                }
                return true;
            });
            return true;
        });
    }
    if (offenders.length) offenders.forEach((o) => fail("nested-interactive", o));
    else pass("nested-interactive", `${anchors} links contain no nested interactive element`);
}

/* ------------------------------------------- 17. The iOS zoom guard is intact
 * One CSS rule stands between every form on the site and a broken layout on
 * iPhones: WebKit zooms the viewport when a field under 16px takes focus, and
 * never zooms back. It is a single block in index.css, it looks like a style
 * choice rather than a bug fix, and there are 100+ fields relying on it —
 * so if somebody tidies it away, that should stop the build rather than
 * surface as a support email.
 */
function checkIosZoomGuard() {
    const css = read(path.join(FRONTEND, "src", "index.css")) || "";
    const hasQuery = /@media\s*\(max-width:\s*767px\)/.test(css);
    const hasRule = /font-size:\s*max\(\s*16px/.test(css);
    if (hasQuery && hasRule) {
        pass("ios-zoom-guard", "form fields are held at 16px on phones");
    } else {
        fail(
            "ios-zoom-guard",
            "the 16px minimum for form fields is missing from index.css — every input on iOS will zoom the page on focus and not zoom back",
        );
    }
}


/* ------------------------------- 18. Noindex routes: rendered, never listed
 * /cart, /login and friends carry `noindex, follow` from React. If they are
 * not prerendered, a crawler that does not run JavaScript gets app-shell.html
 * — no title, no h1, no robots tag — so the directive silently does not apply
 * and three separate "missing tag" faults get reported for one page.
 *
 * The other half matters just as much: none of them may appear in the sitemap.
 * A sitemap is a request to index; pairing it with noindex is a contradiction.
 */
function checkNoindexRoutes() {
    const pre = read(path.join(FRONTEND, "scripts", "prerender.js"));
    const srv = read(path.join(REPO, "backend", "server.py"));
    const m = pre.match(/const NOINDEX_ROUTES = \[([^\]]*)\]/);
    if (!m) {
        fail("noindex-routes", "NOINDEX_ROUTES is gone from prerender.js — those pages ship the empty shell again");
        return;
    }
    const routes = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (!routes.length) {
        fail("noindex-routes", "NOINDEX_ROUTES is empty");
        return;
    }
    const sitemap = srv.slice(srv.indexOf("_SITEMAP_STATIC_PATHS"));
    const listed = routes.filter((r) => sitemap.includes(`"${r}"`));
    if (listed.length) {
        fail("noindex-routes", `in the sitemap but marked noindex: ${listed.join(", ")}`);
        return;
    }
    const app = read(path.join(FRONTEND, "src", "App.js"));
    const unwrapped = routes.filter((r) => !app.includes(`path="${r}"`));
    if (unwrapped.length) {
        fail("noindex-routes", `prerendered but not a route in App.js: ${unwrapped.join(", ")}`);
        return;
    }
    pass("noindex-routes", `${routes.length} noindex routes prerendered, none in the sitemap`);
}


/* ------------------------------------- 19. Canonicals point at real routes
 * <Seo path=...> becomes the canonical link. Three legal pages built theirs
 * from a slug that did not match the route — /shipping-policy declared its
 * canonical as /shipping — so they spent months telling Google the real
 * version of themselves was a URL with nothing behind it.
 *
 * Read from the AST and scoped to <Seo>, because `path` is an ordinary prop
 * name: a first pass on the raw text flagged five CSV export buttons whose
 * path is an API endpoint, not a route.
 *
 * Only string literals are checked. A computed path (pathname, a template with
 * an id) is skipped rather than guessed at — the whole point of the fix was to
 * make it computed.
 */
/**
 * Every site path an email links to must resolve to a real route.
 *
 * The purchase nudge shipped linking each title to `/book/{id}` while the route
 * is `/books/:id`. Nothing caught it: the template renders, the tests asserted
 * the link was present and absolute, and the address only fails when a customer
 * clicks it and lands on the 404 page. An email cannot be recalled and edited,
 * which makes a dead link there worse than a dead link on the site.
 *
 * Deliberately checked against App.js, the same source canonical-routes uses,
 * rather than a hand-kept list that would drift the first time a route is
 * renamed.
 */
function checkEmailLinks() {
    const app = fs.readFileSync(path.join(FRONTEND, "src", "App.js"), "utf8");
    const declared = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
    // Admin screens are nested children of <Route path="/admin">, so they are
    // declared as bare segments ("orders", not "/admin/orders"). Admin
    // notification emails deep-link to the full path, so both forms must count.
    const routes = declared.flatMap((r) => (r.startsWith("/") ? [r] : [`/admin/${r}`]));
    const emailer = path.join(REPO, "backend", "emailer.py");
    if (!fs.existsSync(emailer)) {
        warn("email-links", "backend/emailer.py not found — skipped");
        return;
    }
    const src = fs.readFileSync(emailer, "utf8");

    // Only f-string paths built off the site root. Anything with a host in it is
    // an external link (the eReader, Razorpay) and none of our business.
    const bad = [];
    let checked = 0;
    // A path segment is either a plain word or a whole {…} f-string placeholder.
    // The placeholder has to swallow quotes, dots and parentheses, or
    // "{book.get('id','')}" is cut at the bracket and reported as a broken path
    // that does not exist — a false alarm is how a check gets switched off.
    const re =
        /(?:SITE_URL[^\n]*?\}|https:\/\/www\.oakbridge\.in)((?:\/(?:\{[^{}]*\}|[a-zA-Z0-9\-_.]+))+\/?)/g;
    for (const m of src.matchAll(re)) {
        // Normalise the f-string placeholder to the router's param form.
        const literal = m[1].replace(/\{[^}]+\}/g, ":id").replace(/\/+$/, "") || "/";
        if (literal.startsWith("/api/")) continue; // served by the backend, not the SPA
        checked++;
        const ok = routes.some((r) => {
            const a = r.replace(/:[^/]+/g, ":id");
            return a === literal || a.replace(/\/:id$/, "") === literal;
        });
        if (!ok) bad.push(literal);
    }

    if (bad.length) {
        [...new Set(bad)].forEach((b) =>
            fail("email-links", `emailer.py links to ${b}, which is not a route — recipients get the 404 page`),
        );
    } else {
        pass("email-links", `${checked} email links resolve to routes`);
    }
}

function checkCanonicalRoutes() {
    try {
        require("@babel/parser");
    } catch {
        warn("canonical-routes", "@babel/parser unavailable — skipped");
        return;
    }
    const app = read(path.join(FRONTEND, "src", "App.js"));
    const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
    const files = walk(path.join(FRONTEND, "src", "pages"), (n) => /\.jsx$/.test(n));
    const bad = [];
    let checked = 0;

    for (const f of files) {
        let ast;
        try {
            ast = parseFile(f);
        } catch {
            continue;
        }
        walkAst(ast.program.body, (node) => {
            if (node.type !== "JSXOpeningElement") return true;
            if (!node.name || node.name.name !== "Seo") return true;
            const attr = (node.attributes || []).find((a) => a.name && a.name.name === "path");
            if (!attr || !attr.value) return true;
            const literal =
                attr.value.type === "StringLiteral"
                    ? attr.value.value
                    : attr.value.type === "JSXExpressionContainer" &&
                        attr.value.expression.type === "StringLiteral"
                      ? attr.value.expression.value
                      : null;
            if (literal === null) return true; // computed — nothing to verify
            checked++;
            const ok = routes.some((r) => r === literal || r.replace(/\/:.*$/, "") === literal);
            if (!ok) {
                bad.push(
                    `${path.relative(REPO, f)}:${node.loc ? node.loc.start.line : "?"} → ${literal}`,
                );
            }
            return true;
        });
    }

    if (bad.length) {
        bad.forEach((b) => fail("canonical-routes", `canonical names a path with no route: ${b}`));
    } else {
        pass("canonical-routes", `${checked} literal canonicals resolve to routes`);
    }
}


/* ---------------------------------------- 20. Webfonts must not reflow text
 * `display=swap` paints the page in a fallback face and then reflows every
 * line when the webfont lands. On a text-heavy site that is a layout shift on
 * every block of every page — Search Console measured CLS 0.45 on mobile
 * across 48 URLs, which is squarely in the "Poor" band.
 *
 * `optional` uses the fallback for that load and never swaps, so the shift
 * cannot happen. swap is the value every tutorial suggests, which is exactly
 * why this is worth a gate.
 */
function checkFontDisplay() {
    const html = read(path.join(FRONTEND, "public", "index.html"));
    const css = read(path.join(FRONTEND, "src", "index.css"));
    // Only the URLs. A first pass scanned the raw text and flagged the prose
    // comment that explains why swap was abandoned — the third time in this
    // file that a check has matched its own documentation.
    const bad = [];
    for (const [name, text] of [["public/index.html", html], ["src/index.css", css]]) {
        // /css2 required: the bare host also appears as a <link preconnect>,
        // which carries no stylesheet URL and therefore no display value.
        for (const m of text.matchAll(/fonts\.googleapis\.com\/css2[^"')\s]*/g)) {
            const d = m[0].match(/display=(\w+)/);
            if (!d) bad.push(`${name} loads a font with no display value`);
            else if (d[1] !== "optional") bad.push(`${name} requests display=${d[1]}`);
        }
    }
    if (bad.length) {
        bad.forEach((b) => fail("font-display", `${b} — swap reflows every line when the font lands`));
    } else if (/fonts\.googleapis/.test(html)) {
        pass("font-display", "webfonts load with display=optional, so they cannot reflow text");
    } else {
        warn("font-display", "no Google Fonts link found — check this is deliberate");
    }
}

/* -------------------------------- 21. The two requirements files must agree
 * render.yaml's buildCommand installs requirements-local.txt, but README tells
 * a developer to install requirements.txt. For a long time those described
 * completely different environments: requirements.txt was the untouched
 * 128-line Emergent pip freeze (litellm, openai, google-generativeai, stripe,
 * pandas, numpy, tiktoken, huggingface_hub) that nothing installs and nothing
 * imports, while production quietly booted from the lean file.
 *
 * Anyone following our own README got a environment production never runs.
 * Rather than gamble on changing a live build command, both files now carry
 * the same package list and this check keeps them that way. Comments and
 * blank lines are ignored, so each file can explain itself.
 *
 * requirements-dev.txt is deliberately not part of the comparison: it pulls in
 * requirements.txt via -r and adds pytest on top, which production must not
 * install.
 */
function checkRequirementsParity() {
    const pkgs = (file) => {
        const p = path.join(FRONTEND, "..", "backend", file);
        if (!fs.existsSync(p)) return null;
        return fs.readFileSync(p, "utf8")
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"));
    };
    const a = pkgs("requirements.txt");
    const b = pkgs("requirements-local.txt");
    if (!a || !b) {
        fail("requirements-parity", "backend/requirements.txt or requirements-local.txt is missing");
        return;
    }
    const only = (x, y) => x.filter((p) => !y.includes(p));
    const missingLocal = only(a, b);
    const missingMain = only(b, a);
    if (missingLocal.length || missingMain.length) {
        if (missingLocal.length) {
            fail("requirements-parity",
                `requirements-local.txt is missing: ${missingLocal.join(", ")} — production would boot without it`);
        }
        if (missingMain.length) {
            fail("requirements-parity",
                `requirements.txt is missing: ${missingMain.join(", ")} — the README install would not match production`);
        }
        return;
    }
    pass("requirements-parity", `${a.length} backend packages, identical in both requirements files`);
}

/* --------------------------------------------------------------- reporting */
const CHECKS = [
    checkJsSyntax, checkNodeScripts, checkPython, checkJson,
    checkUnusedImports, checkRouteTitles, checkRouteParity,
    checkVercelFallback, checkJsxDefined, checkJsDefined, checkImgAlt,
    checkNoStaticSitemap, checkSecrets, checkTopLevelJsx, checkAdminSections,
    checkNestedInteractive, checkIosZoomGuard, checkNoindexRoutes,
    checkCanonicalRoutes, checkFontDisplay, checkRequirementsParity,
    checkEmailLinks,
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
