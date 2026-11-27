import React, { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { deliveryWindow, fmtDay, parseDays } from "../lib/delivery";
import { isPrerender } from "../lib/runtime";

/*
 * Under the Add to Cart button for an in-stock book (lib/delivery.js has why).
 *
 * Dates only AFTER mount. Book pages are prerendered at build time, so dates
 * worked out during the prerender were the BUILD day's ("Tue 1 Dec – Sat 5
 * Dec" baked into the HTML) — stale for every day until the next deploy, and
 * a text mismatch on hydration (React #418, seen live 27 Nov 2026), which
 * makes React throw the prerendered page away and re-render it. The
 * prerender and the first client render now both show the same day-free line
 * ("delivered in 3–7 business days"); the real dates replace it once the page
 * is running in the reader's browser, on the reader's day.
 */
export default function DeliveryEstimate({ text, freeShipping = false }) {
    const [now, setNow] = useState(null);
    // Not during the build: the prerender is a real browser, runs this effect
    // too, and baked the build day's dates in anyway (seen live 27 Nov 2026).
    useEffect(() => { if (!isPrerender()) setNow(Date.now()); }, []);   // a number: deliveryWindow does now + IST offset
    const days = parseDays(text);
    if (!days) return null;
    const w = now ? deliveryWindow(text, now) : null;
    return (
        <p className="mt-4 flex items-start gap-2 text-sm text-[#002B5C]" data-testid="pdp-delivery-estimate">
            <Truck size={16} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>
                {w ? (
                    <>Order now — delivered between <b>{fmtDay(w[0])}</b> and <b>{fmtDay(w[1])}</b></>
                ) : (
                    <>Order now — delivered in {days[0] === days[1] ? days[0] : `${days[0]}–${days[1]}`} business days</>
                )}
                {freeShipping && <span className="text-[#15803D]"> · Free shipping</span>}
            </span>
        </p>
    );
}
