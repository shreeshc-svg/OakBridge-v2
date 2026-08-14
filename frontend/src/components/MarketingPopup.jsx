import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { mediaUrl } from "../lib/api";
import { isPrerender } from "../lib/runtime";
import { track } from "../lib/analytics";

/**
 * The homepage promotional overlay.
 *
 * Everything about it is off by default and set in Admin → Pages → Homepage.
 * With no image saved it renders nothing at all, so the feature existing costs
 * a visitor nothing until someone deliberately turns it on.
 *
 * THE IMAGE IS NEVER CROPPED
 *
 * The brief was that the container fits the artwork rather than the artwork
 * being cut to fit a container — so there is no aspect-ratio box and no
 * object-cover anywhere here. The <img> keeps its natural proportions and is
 * only bounded by the viewport (92vw / 85vh), and the panel is inline-block so
 * it shrinks to whatever the image turns out to be. A tall poster and a wide
 * banner both arrive whole; the only thing that ever changes is the scale.
 *
 * WHY IT IS NOT IN THE PRERENDERED HTML
 *
 * Every deploy renders this page to a static file. Without the isPrerender()
 * guard the modal — and its dark backdrop — would be baked into the homepage
 * that ships, shown to every visitor before React had even loaded, and read by
 * Google as the page's main content.
 *
 * WHY IT WAITS
 *
 * Firing on mount would put a full-screen overlay in front of someone before
 * the page behind it has finished drawing, and it would compete with the hero
 * image for the Largest Contentful Paint. A short delay lets the page land
 * first, which is both politer and better for the score.
 */
const SEEN_KEY = "oakbridge_promo_seen";
const SHOW_AFTER_MS = 1200;

/** Has this visitor already dismissed it, under the chosen frequency? */
function alreadySeen(frequency, stamp) {
    if (frequency === "always") return false;
    try {
        const store = frequency === "session" ? sessionStorage : localStorage;
        const seen = store.getItem(SEEN_KEY);
        if (!seen) return false;
        /*
         * The saved value carries the creative it was dismissed for. Change the
         * image in the admin and everyone sees the new one — otherwise the
         * first campaign would permanently suppress every campaign after it,
         * which is the sort of thing nobody discovers until they wonder why the
         * second promotion got no clicks.
         */
        if (seen !== stamp) return false;
        return true;
    } catch {
        return false; // private mode: show it rather than fail closed
    }
}

function remember(frequency, stamp) {
    if (frequency === "always") return;
    try {
        const store = frequency === "session" ? sessionStorage : localStorage;
        store.setItem(SEEN_KEY, stamp);
    } catch {
        /* nothing to do */
    }
}

export default function MarketingPopup({ site }) {
    const [open, setOpen] = useState(false);
    const closeRef = useRef(null);
    const restoreFocusTo = useRef(null);

    // Site content rather than settings, so it sits with the hero image and the
    // rest of the homepage copy in Admin → Pages. Values arrive as strings.
    const enabled = String(site?.home_popup_enabled ?? "off").toLowerCase() === "on";
    const image = (site?.home_popup_image || "").trim();
    const link = (site?.home_popup_link || "").trim();
    const alt = (site?.home_popup_alt || "").trim();
    const frequency = (site?.home_popup_frequency || "session").toLowerCase();

    useEffect(() => {
        if (!enabled || !image || isPrerender()) return undefined;
        if (alreadySeen(frequency, image)) return undefined;
        const t = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
        return () => clearTimeout(t);
    }, [enabled, image, frequency]);

    const dismiss = (how) => {
        remember(frequency, image);
        setOpen(false);
        track("promo_popup_dismissed", { how, image });
        // Give the page back the focus the dialog borrowed.
        try {
            restoreFocusTo.current?.focus?.();
        } catch {
            /* element may be gone */
        }
    };

    useEffect(() => {
        if (!open) return undefined;
        restoreFocusTo.current = document.activeElement;
        closeRef.current?.focus();
        track("promo_popup_shown", { image });

        const onKey = (e) => {
            if (e.key === "Escape") dismiss("escape");
        };
        document.addEventListener("keydown", onKey);

        /* Stop the page scrolling underneath the overlay. Restored exactly, not
           set to "auto", so a page that had its own overflow rule keeps it. */
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    const art = (
        <img
            src={mediaUrl(image) || image}
            /* Empty alt when the admin has written none: the creative is then
               decorative as far as a screen reader is concerned, which is
               honest. Inventing "Promotional banner" tells them nothing they
               could act on. */
            alt={alt}
            className="block h-auto w-auto max-h-[85vh] max-w-[92vw] md:max-w-[min(92vw,900px)]"
        />
    );

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 sm:p-6"
            onClick={() => dismiss("backdrop")}
            data-testid="marketing-popup"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={alt || "Promotion"}
                /* inline-block, so the panel is exactly the size of the image
                   inside it — the container adapting to the artwork rather than
                   the other way round. */
                className="relative inline-block"
                onClick={(e) => e.stopPropagation()}
            >
                {link ? (
                    <a
                        href={link}
                        target={link.startsWith("http") ? "_blank" : undefined}
                        rel="noopener noreferrer"
                        onClick={() => {
                            track("promo_popup_clicked", { image, link });
                            remember(frequency, image);
                        }}
                        data-testid="marketing-popup-link"
                    >
                        {art}
                    </a>
                ) : (
                    art
                )}

                {/* Sits ON the corner of the artwork, half outside it, with its
                    own solid fill and a white ring — an X tinted onto the image
                    disappears against whichever creative is uploaded next. */}
                <button
                    ref={closeRef}
                    onClick={() => dismiss("button")}
                    aria-label="Close this promotion"
                    data-testid="marketing-popup-close"
                    className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#002B5C] text-white ring-2 ring-white shadow-lg hover:bg-[#CC0033] focus:outline-none focus:ring-4 focus:ring-[#F59E0B] transition-colors"
                >
                    <X size={20} strokeWidth={2.25} />
                </button>
            </div>
        </div>
    );
}
