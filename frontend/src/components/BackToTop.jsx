import React, { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Small "back to top" button, pinned just above the chat launcher.
 *
 * Positions are derived from ChatWidget: the launcher is 56px tall and sits at
 * bottom-20 (mobile, clearing the bottom tray) / bottom-5 (desktop), so this
 * sits at bottom-36 / md:bottom-24 to leave a consistent gap above it.
 * z-40 keeps it beneath the open chat panel (z-50) rather than fighting it.
 */
export default function BackToTop({ showAfter = 400 }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const onScroll = () => setVisible(window.scrollY > showAfter);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, [showAfter]);

    const toTop = () => {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    };

    return (
        <button
            type="button"
            onClick={toTop}
            aria-label="Back to top"
            title="Back to top"
            data-testid="back-to-top"
            className={`fixed z-40 bottom-36 right-5 md:bottom-24 w-11 h-11 rounded-full bg-[#002B5C] text-white shadow-lg flex items-center justify-center hover:bg-[#001F42] active:scale-95 transition-all duration-300 touch-manipulation ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
            }`}
        >
            <ArrowUp size={18} strokeWidth={2} />
        </button>
    );
}
