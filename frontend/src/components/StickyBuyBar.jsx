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
        // Looked up on every scroll, not observed once: on the live site the
        // button is re-created after first paint (prerendered HTML replaced on
        // hydration, loading -> loaded), and an IntersectionObserver set up at
        // mount kept watching the detached first copy — so the bar never
        // appeared (seen live 27 Nov 2026). One getElementById per frame of
        // scrolling is negligible.
        let raf = 0;
        const check = () => {
            raf = 0;
            const el = document.getElementById(targetId);
            setShow(!!el && el.getBoundingClientRect().bottom < 0);
        };
        const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
        check();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        return () => {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
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
