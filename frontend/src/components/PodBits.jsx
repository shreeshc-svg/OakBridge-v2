import React from "react";
import { useCart } from "../context/CartContext";
import { fmtPodDay } from "../lib/pod";

/**
 * Print on demand in the cart / checkout (backend/pod_core.py, lib/pod.js).
 *
 * A cart with a POD book ships as ONE parcel once the book is printed, so the
 * note speaks for the whole order and shows the 5–7 working-day dates (Mon–Fri,
 * public holidays skipped, 2 pm India-time cut-off). Dates appear only after
 * the page has loaded (they depend on today).
 */
export function PodCartNote({ className = "" }) {
    const { hasPod, podWindow } = useCart();
    if (!hasPod) return null;
    return (
        <div data-testid="pod-cart-note" className={`border border-[#F59E0B] bg-[#FFF8EB] p-3 text-xs text-[#002B5C] leading-snug ${className}`}>
            <div className="font-semibold text-sm">Includes a print-on-demand book</div>
            <p className="mt-1 text-[#4B5563]">
                Since your order includes print on demand, everything will be shipped and delivered together.
                {podWindow
                    ? <> Expected dispatch: <b className="text-[#002B5C]">{fmtPodDay(podWindow[0])} – {fmtPodDay(podWindow[1])}</b> (5–7 working days).</>
                    : <> Dispatched in 5–7 working days.</>}
            </p>
        </div>
    );
}

export function PodAck({ checked, onChange }) {
    const { hasPod } = useCart();
    if (!hasPod) return null;
    return (
        <label data-testid="pod-ack" className="flex items-start gap-2 text-xs text-[#002B5C] cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#002B5C]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="pod-ack-input" />
            <span>I understand the print-on-demand book is printed specially for me and can't be cancelled or returned, unless it arrives damaged or misprinted.</span>
        </label>
    );
}

/**
 * Bookstore: an invitation to the Print on Demand shelf, shown above the
 * listing (phones included — the category row scrolls sideways there) until
 * the visitor is on that shelf. Only when there are POD titles.
 */
export function PodExplore({ count, onOpen, className = "", showNew = true }) {
    if (!count) return null;
    return (
        <button type="button" onClick={onOpen} data-testid="pod-explore"
            className={`w-full text-left flex items-center gap-3 border border-[#002B5C] bg-[#002B5C] text-white px-4 py-3 hover:bg-[#001F42] transition-colors ${className}`}>
            {showNew && <span className="pod-new flex-shrink-0 bg-[#F59E0B] text-[#002B5C] text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5">New</span>}
            <span className="flex-1 min-w-0 text-sm leading-snug">
                <b className="text-[#F59E0B]">Print on Demand</b>
                <span className="hidden sm:inline"> — out-of-stock titles printed specially for you, at the same price.</span>
                <span className="sm:hidden"> — out-of-stock titles printed for you.</span>
            </span>
            <span className="flex-shrink-0 text-xs underline whitespace-nowrap">Explore {count} →</span>
        </button>
    );
}
