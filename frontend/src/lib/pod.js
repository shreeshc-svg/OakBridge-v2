/**
 * Print on Demand — the browser's copy of backend/pod_core.py.
 *
 * Same rules, tested against the same cases (scripts/test-pod.mjs), so the
 * dates on the book page and in the cart are the dates on the invoice:
 *   - a book is POD while it is ticked, has no stock, and isn't a pre-order;
 *   - working days are Mon–Fri minus the holidays listed in Admin;
 *   - paid before 2 pm India time on a working day -> printing starts that
 *     day, otherwise the next working day; dispatch 5–7 working days later.
 * Dates depend on "now", so they are only ever rendered after the page has
 * mounted — never in the prerendered HTML (it was built on another day).
 */
export const POD_MIN = 5;
export const POD_MAX = 7;
export const POD_CUTOFF_HOUR = 14;
export const POD_MAX_QTY = 10;
const IST_MS = 5.5 * 3600 * 1000;

export const podActive = (book, preorderActive = false) =>
    Boolean(book?.pod) && Number(book?.stock || 0) <= 0 && !preorderActive && book?.product_type !== "hamper";

// Dates are handled as "YYYY-MM-DD" India-time calendar days, so the
// visitor's own time zone never shifts them.
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000));
const weekday = (s) => new Date(`${s}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat

export const holidaySet = (hs) => new Set((hs || []).map((h) => String(h?.date ?? h).slice(0, 10)));
const isWorking = (s, hol) => { const w = weekday(s); return w !== 0 && w !== 6 && !hol.has(s); };

function addWorking(s, n, hol) {
    let d = s;
    while (n > 0) { d = addDays(d, 1); if (isWorking(d, hol)) n -= 1; }
    return d;
}

export function startDay(nowMs, hol) {
    const ist = new Date(nowMs + IST_MS);
    let d = iso(ist);
    if (isWorking(d, hol) && ist.getUTCHours() < POD_CUTOFF_HOUR) return d;
    d = addDays(d, 1);
    while (!isWorking(d, hol)) d = addDays(d, 1);
    return d;
}

/** ["2026-11-03", "2026-11-05"] — earliest and latest dispatch day. */
export function dispatchWindow(nowMs, holidays) {
    const hol = holidaySet(holidays);
    const s = startDay(nowMs, hol);
    return [addWorking(s, POD_MIN, hol), addWorking(s, POD_MAX, hol)];
}

/** "Wed 5 Nov" */
export const fmtPodDay = (s) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
