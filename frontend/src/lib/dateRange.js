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
