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
