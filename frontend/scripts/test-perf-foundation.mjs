/**
 * Phase 0 performance foundation — wiring checks.
 *
 * The logic is unit-tested in backend/tests/test_cache.py, test_jobs.py and
 * test_perf.py. This pins how it is wired into the live app, so a later edit
 * can't quietly undo it: admin code out of the shopper bundle, compression
 * that skips binaries, the cache as the outermost layer (and never on signed-in
 * requests), timing outside that, the worker split with its fallback, and
 * memory-flat marketing queries.
 *
 * Run: node frontend/scripts/test-perf-foundation.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Comments and docstrings stripped so no check can pass by matching prose.
const code = (p) =>
    readFileSync(join(ROOT, p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        .replace(/^\s*#.*$/gm, "");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const app = code("frontend/src/App.js");
const srv = code("backend/server.py");
const cache = code("backend/cache.py");
const jobs = code("backend/jobs.py");
const mk = code("backend/marketing.py");
const worker = code("backend/worker.py");
const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");

console.log("-- storefront bundle --");
check(!/^import Admin[A-Za-z]+ from "@\/pages\/admin/m.test(app) && !/^import WarehouseApp from/m.test(app),
    "no admin / warehouse page is statically imported");
check(/const AdminMarketing = lazy\(\(\) => import\("@\/pages\/admin\/AdminMarketing"\)\)/.test(app), "admin pages load on demand");
check(/lazyPage\(AdminLayout\)/.test(app) && /<Suspense fallback=/.test(app), "each lazy page has a Suspense fallback");

console.log("-- compression --");
check(/compresslevel=5/.test(srv) && /minimum_size=1024/.test(srv), "gzip at level 5, bodies over 1 KB");
check(/_NO_GZIP = re\.compile\(r"\^\/api\/\(files\//.test(srv), "already-compressed downloads are skipped");

console.log("-- cache layering --");
const iGzip = srv.indexOf("app.add_middleware(_SelectiveGZip)");
const iCache = srv.indexOf("app.add_middleware(ResponseCacheMiddleware");
const iTiming = srv.indexOf("app.add_middleware(TimingMiddleware)");
check(iGzip > 0 && iCache > iGzip && iTiming > iCache, "order: gzip, then cache outside it, then timing outermost");
check(/PUBLIC_CACHE", "on"\)\.strip\(\)\.lower\(\) != "off"/.test(srv), "PUBLIC_CACHE=off switch");
check(/authed = _h\(req_h, b"authorization"\) is not None/.test(cache) && /if method == "GET" and not authed/.test(cache),
    "signed-in requests are never cached");
check(/b"private, no-store"/.test(cache), "signed-in responses marked private, no-store");

console.log("-- worker / queue --");
check(existsSync(join(ROOT, "backend/worker.py")) && /marketing\.periodic\(\)/.test(worker) && /SHUTDOWN_GRACE/.test(worker),
    "worker runs the tick and shuts down gracefully");
check(/"active_key", unique=True, sparse=True/.test(jobs) && /lease_until/.test(jobs), "queue: dedupe + leases");
check(/- type: worker[\s\S]*?name: oakbridge-worker[\s\S]*?startCommand: "python worker\.py"/.test(yaml), "render.yaml worker service");
check(/key: JWT_SECRET[\s\S]{0,120}fromService:[\s\S]{0,80}name: oakbridge-api[\s\S]{0,40}envVarKey: JWT_SECRET/.test(yaml),
    "worker shares JWT_SECRET with the web service (signed email links)");
check(/value: inline\s+# switch to external/.test(yaml), "worker ships in inline mode; external is a deliberate switch");

console.log("-- index safety (bug 2026-10-12: duplicate SES usage counters) --");
check(/await _unique_index\(db\.mk_ses_usage, "month", sum_field="n"\)/.test(mk),
    "usage counters: duplicates merged (summed) before the unique index is built");
check(!/try:\s*\n\s*await db\.mk_contacts\.create_index/.test(mk) && /async def _index\(coll, keys/.test(mk),
    "one failing index no longer skips the rest");
check(/if "E11000" not in str\(e\)/.test(mk), "simultaneous first checks of a month don't crash or split the counter");

console.log("-- marketing load --");
check(!/to_list\((200000|100000|50000)\)/.test(mk), "no load-everything queries");
check(/await _DASH_MEMO\.get\(/.test(mk) && /_by_day\(db\.mk_sends, "sent_at"/.test(mk), "dashboard: memoised + counted in MongoDB");
check(!/c\["stats"\] = await refresh_campaign_stats/.test(mk) && /@_jobs\.handler\("mk_stats"\)/.test(mk),
    "campaign stats refreshed in the background, not while the dashboard waits");

console.log();
if (failed) {
    console.log(`${failed} check(s) failed`);
    process.exit(1);
}
console.log("all checks passed");
