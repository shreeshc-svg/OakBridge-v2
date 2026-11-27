import React from "react";
import { Truck } from "lucide-react";
import { deliveryWindow, fmtDay } from "../lib/delivery";

/* Under the Add to Cart button for an in-stock book (lib/delivery.js has why). */
export default function DeliveryEstimate({ text, freeShipping = false }) {
    const w = deliveryWindow(text);
    if (!w) return null;
    return (
        <p className="mt-4 flex items-start gap-2 text-sm text-[#002B5C]" data-testid="pdp-delivery-estimate">
            <Truck size={16} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>
                Order now — delivered between <b>{fmtDay(w[0])}</b> and <b>{fmtDay(w[1])}</b>
                {freeShipping && <span className="text-[#15803D]"> · Free shipping</span>}
            </span>
        </p>
    );
}
