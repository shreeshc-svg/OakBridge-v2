import React, { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { formatINR } from "../lib/api";

/*
 * Phones only: once the page's own Add to Cart button has scrolled out of
 * view (a reader scrolling through the description, contents and reviews),
 * a slim bar keeps price + Add to Cart within thumb reach. It sits just above
 * the bottom tray and stops short of the chat button on the right, so it
 * covers neither. Hidden again as soon as the real button is back on screen.
 */
export default function StickyBuyBar({ targetId, title, price, onAdd }) {
    const [show, setShow] = useState(false);
    useEffect(() => {
        const el = document.getElementById(targetId);
        if (!el || typeof IntersectionObserver === "undefined") return undefined;
        const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
        io.observe(el);
        return () => io.disconnect();
    }, [targetId]);
    if (!show) return null;
    return (
        <div className="md:hidden fixed left-2 right-[84px] z-30 bg-white border border-[#002B5C] shadow-lg flex items-center gap-2 px-3 py-2"
            style={{ bottom: "calc(var(--tray-h) + 0.5rem)" }} data-testid="sticky-buy-bar">
            <div className="min-w-0 flex-1">
                <div className="text-[11px] text-[#4B5563] truncate">{title}</div>
                <div className="font-serif text-lg text-[#002B5C] leading-tight">{formatINR(price)}</div>
            </div>
            <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-3 py-2 text-sm font-medium" data-testid="sticky-add-to-cart">
                <ShoppingBag size={15} strokeWidth={1.5} /> Add
            </button>
        </div>
    );
}
