import React, { useState } from "react";
import { X } from "lucide-react";
import { remainingOutsideFilter } from "../lib/filterNotice";

/**
 * "We picked a filter for you, and you can undo it."
 *
 * The bookstore opens on Professional. That is a deliberate merchandising
 * choice — it is the biggest list and the one most visitors want — but nothing
 * on the page says so. A first-time visitor sees 108 titles where the hero
 * promised hundreds, and has no reason to suspect a filter is doing it. The
 * chip that says "Professional ✕" reads as a label, not as something switched
 * on that could be switched off.
 *
 * THREE RULES, and each exists because the obvious version is worse:
 *
 *   It appears only when WE applied the filter. Somebody who clicked Academic,
 *   or followed a filtered link from a campaign, gets nothing — telling people
 *   about a choice they just made is noise, and noise trains people to ignore
 *   the strip that matters.
 *
 *   The number is computed from the live category counts, never typed. A
 *   hardcoded "87 more" goes wrong the first time a title is added, and a wrong
 *   number in a nudge is worse than no number. If the counts have not arrived
 *   yet it says "more titles" with no figure rather than flashing a zero.
 *
 *   Dismissing sticks per browser. Being told the same thing on every visit is
 *   how a helpful note becomes furniture.
 */

const DISMISS_KEY = "oakbridge_default_filter_notice";

export function noticeDismissed() {
    try {
        return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
        return false; // private mode throws; showing it once is the safe failure
    }
}

export function dismissNotice() {
    try {
        localStorage.setItem(DISMISS_KEY, "1");
    } catch {
        /* the dismissal still applies to this page view */
    }
}

/**
 * @param categoryName  what the visitor is currently looking at, e.g. "Professional"
 * @param shownCount    titles inside that category
 * @param totalCount    titles across every category
 * @param onClearFilter clears the category and shows everything
 */
export default function DefaultFilterNotice({
    categoryName,
    shownCount,
    totalCount,
    onClearFilter,
}) {
    const [gone, setGone] = useState(() => noticeDismissed());
    if (gone || !categoryName) return null;

    // Only claim a number we actually have; remainingOutsideFilter returns null
    // rather than a zero while the category counts are still in flight.
    const more = remainingOutsideFilter(totalCount, shownCount);
    const rest = more === null ? "more titles" : `${more} more titles`;

    const close = () => {
        dismissNotice();
        setGone(true);
    };

    return (
        <div
            role="status"
            data-testid="default-filter-notice"
            /*
             * Same left and right edges as the count row and the grid below it,
             * so the strip reads as part of the shelf rather than a banner laid
             * over it. Padding is deliberately small — a generous inset made the
             * text start well right of "108 titles" underneath and looked like a
             * misalignment rather than a box.
             */
            className="mb-5 border border-[#E5E7EB] border-l-[3px] border-l-[#F59E0B] bg-[#FFFBEB] px-3 py-2.5 sm:px-4 sm:py-3 flex flex-wrap items-center gap-x-3 gap-y-2"
        >
            <p className="flex-1 basis-full sm:basis-auto text-[13px] sm:text-sm leading-relaxed text-[#002B5C] min-w-0">
                Heads up — we&apos;ve started you in <strong className="font-semibold">{categoryName}</strong>.
                There are <strong className="font-semibold">{rest}</strong> outside this filter.
            </p>
            {/*
             * On a phone the action takes its own full-width row at a 44px tap
             * height; from sm up it tucks onto the end of the sentence. The
             * dismiss stays 44px square on touch for the same reason — a 16px
             * ✕ beside a button is a coin toss with a thumb.
             */}
            <span className="flex basis-full sm:basis-auto items-center gap-2">
                <button
                    type="button"
                    onClick={onClearFilter}
                    data-testid="clear-default-filter"
                    className="flex-1 sm:flex-none bg-[#002B5C] text-white text-[13px] font-semibold px-4 h-11 sm:h-9 hover:bg-[#001F42] transition-colors whitespace-nowrap"
                >
                    Show me everything
                </button>
                <button
                    type="button"
                    onClick={close}
                    aria-label="Dismiss this notice"
                    data-testid="dismiss-default-filter-notice"
                    className="flex-none w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-[#4B5563] hover:text-[#002B5C]"
                >
                    <X size={16} strokeWidth={1.5} />
                </button>
            </span>
        </div>
    );
}
