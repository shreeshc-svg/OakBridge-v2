/**
 * The admin dashboard's date ranges.
 *
 * Kept out of the component and free of React so the boundary arithmetic can be
 * tested directly. Month boundaries are the part that goes wrong quietly: an
 * off-by-one on "last month" does not throw, it just reports the wrong revenue
 * with total confidence, which is the worst way for a number to be wrong.
 *
 * EVERY RANGE IS BUILT IN THE ADMIN'S OWN TIMEZONE and then sent as an instant.
 * "This month" has to mean the month they are living in. Built in UTC it would
 * flip a day early for the five and a half hours after midnight in India, so on
 * the 1st of the month at 2am the dashboard would still be showing August.
 * `new Date(y, m, d)` uses local time; `.toISOString()` converts to the instant.
 * The backend re-emits both bounds in its own storage format before comparing.
 */

/** Start of a local day, as a Date. */
function dayStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** End of a local day, as a Date. Inclusive — 23:59:59.999, not the next midnight. */
function dayEnd(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export const RANGE_PRESETS = [
    { key: "all", label: "All time" },
    { key: "7d", label: "Last 7 days" },
    { key: "this_month", label: "This month" },
    { key: "last_month", label: "Last month" },
    { key: "custom", label: "Custom" },
];

/**
 * Resolve a preset to `{ from, to }` ISO instants, or `null` for all time.
 *
 * @param {string} key   one of RANGE_PRESETS
 * @param {object} opts  { now, from, to } — `now` is injectable so the tests can
 *                       pin a date; `from`/`to` are YYYY-MM-DD from the custom
 *                       date inputs.
 */
export function resolveRange(key, opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date();

    if (key === "all") return null;

    if (key === "7d") {
        // Seven days INCLUDING today, so the label and the count agree: a
        // customer looking at "last 7 days" on a Monday means through today,
        // not up to last night. Six days back plus today is seven.
        const start = dayStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
        return { from: start.toISOString(), to: dayEnd(now).toISOString() };
    }

    if (key === "this_month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        // Ends today, not at the end of the month — a range running into the
        // future would be honest but reads as broken next to "last month".
        return { from: start.toISOString(), to: dayEnd(now).toISOString() };
    }

    if (key === "last_month") {
        // Day 0 of a month is the last day of the one before it, and the Date
        // constructor rolls a negative month back into the previous year — so
        // this is correct in January without a special case.
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { from: start.toISOString(), to: end.toISOString() };
    }

    if (key === "custom") {
        const { from, to } = opts;
        if (!from || !to) return null; // half-filled is not a range yet
        // Parsed as local dates, not as the UTC midnights that `new Date("...")`
        // would give for a bare YYYY-MM-DD. Both bounds are inclusive whole days.
        const [fy, fm, fd] = String(from).split("-").map(Number);
        const [ty, tm, td] = String(to).split("-").map(Number);
        if (!fy || !fm || !fd || !ty || !tm || !td) return null;
        let start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
        let end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
        // Picked backwards? Swap rather than return nothing. The intent is
        // obvious and an empty dashboard is a worse answer than the right one.
        if (start > end) {
            const swap = start;
            start = dayStart(end);
            end = dayEnd(swap);
        }
        return { from: start.toISOString(), to: end.toISOString() };
    }

    return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/**
 * The line under the range buttons, spelling out the window in words.
 *
 * It reads back what was actually applied rather than which button is lit,
 * because those two can disagree — a half-filled custom range applies nothing.
 */
export function rangeLabel(key, range) {
    if (!range || !range.from) return "All time · since your first order";
    const a = fmt(range.from);
    const b = fmt(range.to);
    if (!a || !b) return "All time · since your first order";
    if (a === b) return a;
    return `${a} – ${b}`;
}


/* ---------------- Marketing → Growth periods (calendar days) ----------------
 * Growth counts are kept per Indian calendar day, so its periods are plain
 * YYYY-MM-DD dates (inclusive), built in the admin's own timezone like the
 * dashboard ranges above. The server caps a period at today and starts it no
 * earlier than the day visit counting began.
 */
export const GROWTH_PERIODS = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "7d", label: "Last 7 days" },
    { key: "30d", label: "Last 30 days" },
    { key: "this_month", label: "This month" },
    { key: "last_month", label: "Last month" },
    { key: "90d", label: "Last 90 days" },
    { key: "this_year", label: "This year" },
    { key: "last_year", label: "Last year" },
    { key: "custom", label: "Custom range…" },
];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** `{ start, end }` as YYYY-MM-DD (inclusive), or null for an unfinished custom range. */
export function growthPeriod(key, opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const back = (n) => ({ start: ymd(new Date(y, m, d - (n - 1))), end: ymd(now) });
    switch (key) {
        case "today": return { start: ymd(now), end: ymd(now) };
        case "yesterday": { const t = ymd(new Date(y, m, d - 1)); return { start: t, end: t }; }
        case "7d": return back(7);
        case "30d": return back(30);
        case "90d": return back(90);
        case "this_month": return { start: ymd(new Date(y, m, 1)), end: ymd(now) };
        // Day 0 of this month = last day of the previous one; January rolls back a year.
        case "last_month": return { start: ymd(new Date(y, m - 1, 1)), end: ymd(new Date(y, m, 0)) };
        case "this_year": return { start: ymd(new Date(y, 0, 1)), end: ymd(now) };
        case "last_year": return { start: ymd(new Date(y - 1, 0, 1)), end: ymd(new Date(y - 1, 11, 31)) };
        case "custom": {
            const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
            if (!ok(opts.from) || !ok(opts.to)) return null;
            return opts.from <= opts.to ? { start: opts.from, end: opts.to } : { start: opts.to, end: opts.from };
        }
        default: return back(30);
    }
}

/** "1 Oct – 19 Oct 2026" style label for a growth period. */
export function growthPeriodLabel(p) {
    if (!p) return "";
    const f = (s) => { const [Y, M, D] = s.split("-").map(Number); return { Y, t: `${D} ${MONTHS[M - 1]}` }; };
    const a = f(p.start);
    const b = f(p.end);
    if (p.start === p.end) return `${a.t} ${a.Y}`;
    return a.Y === b.Y ? `${a.t} – ${b.t} ${b.Y}` : `${a.t} ${a.Y} – ${b.t} ${b.Y}`;
}
