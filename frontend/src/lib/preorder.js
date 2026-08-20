import { useEffect, useState } from "react";

/**
 * Pre-orders: is this title still in the future, and how far.
 *
 * One place, because the tile and the product page have to agree. A book that
 * shows a countdown on the listing and a normal Add to cart on the page it
 * links to is worse than not having the feature.
 */

/** Parse whatever the admin typed. Returns a Date, or null if it is unusable. */
export const launchDate = (book) => {
    const raw = (book?.launch_at || "").trim();
    if (!raw) return null;
    // A bare "2026-09-14" is parsed by JS as UTC midnight, which in IST is
    // 05:30 the same morning — close enough for a publication day, and it
    // keeps a date-only value behaving the same in every browser.
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The pre-order state of a book.
 *
 * `active` needs BOTH the flag and a future date. That is what makes the
 * countdown clear itself: the morning after publication the date is in the
 * past, the label and timer vanish, and the book behaves like any other —
 * with nobody having to remember to untick anything.
 *
 * A flag with no date at all is treated as not active rather than as a
 * countdown to nowhere. Half-configured should show nothing, not something
 * broken.
 */
export const preorderState = (book, now = Date.now()) => {
    const flagged = Boolean(book?.coming_soon);
    const at = launchDate(book);
    const active = flagged && !!at && at.getTime() > now;
    return {
        active,
        at,
        label: (book?.coming_soon_label || "").trim() || "Coming soon",
        /** Flagged, but the day has passed — useful to admins, invisible to customers. */
        lapsed: flagged && !!at && at.getTime() <= now,
    };
};

/** "14 September 2026" — the date, in the form a reader expects. */
export const formatLaunchDate = (d) =>
    d
        ? d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
        : "";

const split = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return {
        days: Math.floor(s / 86400),
        hours: Math.floor((s % 86400) / 3600),
        minutes: Math.floor((s % 3600) / 60),
        seconds: s % 60,
        done: s === 0,
    };
};

/**
 * A ticking countdown to `target`.
 *
 * Ticks once a second only while there is something to count. A finished or
 * absent target keeps no interval at all — a bookstore page can hold two dozen
 * cards, and two dozen timers running forever for books that published last
 * year is a background cost for nothing.
 */
export const useCountdown = (target) => {
    const ms = target ? target.getTime() - Date.now() : 0;
    const [left, setLeft] = useState(ms);

    useEffect(() => {
        if (!target) return undefined;
        const tick = () => setLeft(target.getTime() - Date.now());
        tick();
        if (target.getTime() <= Date.now()) return undefined;
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [target && target.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

    return split(left);
};
