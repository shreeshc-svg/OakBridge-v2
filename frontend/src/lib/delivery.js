/*
 * "Delivered by …" on the book page (Nov 2026 conversion work).
 *
 * Turns the delivery promise the admin already maintains (Admin → Book page
 * → Delivery, e.g. "3–7 business days") into dates a shopper can plan
 * around: "Delivered between Tue, 2 Dec and Fri, 5 Dec". A real date answers
 * "will it come in time?", which a range of days does not — one of the usual
 * reasons a visitor reads a book page and leaves without adding to cart.
 *
 * Deliberately the SAME promise, only dated: if the admin text has no
 * numbers, nothing is shown (we never invent a promise). Sundays are skipped
 * (couriers here deliver on Saturdays); an order after the 2 pm IST cut-off
 * is counted from the next day.
 */
export function parseDays(text) {
    const m = String(text || "").match(/(\d{1,2})\s*(?:[–—-]|to)\s*(\d{1,2})/i) || String(text || "").match(/(\d{1,2})/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2] || m[1]);
    if (!(a > 0) || !(b >= a) || b > 30) return null;
    return [a, b];
}

const IST_MS = 5.5 * 3600 * 1000;

/** Adds n delivery days (no Sundays) to an IST calendar date (UTC-midnight Date). */
function addDeliveryDays(d, n) {
    const x = new Date(d.getTime());
    let left = n;
    while (left > 0) {
        x.setUTCDate(x.getUTCDate() + 1);
        if (x.getUTCDay() !== 0) left -= 1;
    }
    return x;
}

/** [earliest, latest] as Dates (IST calendar days), or null. */
export function deliveryWindow(text, now = Date.now(), cutoffHour = 14) {
    const days = parseDays(text);
    if (!days) return null;
    const ist = new Date(now + IST_MS);
    let start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
    if (ist.getUTCHours() >= cutoffHour || start.getUTCDay() === 0) start = addDeliveryDays(start, 1);
    return [addDeliveryDays(start, days[0]), addDeliveryDays(start, days[1])];
}

export const fmtDay = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
