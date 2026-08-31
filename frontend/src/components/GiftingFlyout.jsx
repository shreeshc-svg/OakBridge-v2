import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listHampers, formatINR, mediaUrl } from "../lib/api";

/**
 * The Gifting mega-menu: a trigger that sits in the nav, and a panel that does
 * not.
 *
 * WHY THEY ARE SEPARATE, AND WHY THAT IS THE WHOLE TRICK
 *
 * The panel is positioned against the HEADER, not the nav link. A first attempt
 * put `relative` on the link and `left-0 right-0` on the panel, which made the
 * 55px-wide word "Gifting" the containing block — the panel came out 55px wide
 * and every child spilled out of it. The header is the only element here whose
 * width is the width of the page, so the panel has to be its child. The two
 * pieces therefore share state through the hook below rather than one owning
 * the other.
 *
 * WHY THE TIMERS
 *
 * A CSS :hover menu opens the instant the pointer crosses it, so sweeping
 * toward "Authors" flashes it open and shut. 120ms before opening absorbs that;
 * 180ms before closing lets a diagonal move down into a card cross the gap
 * without losing the menu. Those two numbers are most of the difference between
 * a menu that feels solid and one that feels twitchy.
 *
 * WHERE IT DOES NOT EXIST
 *
 * Below lg (1024px) the site's horizontal nav is `hidden lg:flex` and the
 * burger takes over, so nothing here renders. The mobile treatment is a
 * separate, much simpler section inside the drawer — see Header.
 */

export const OPEN_MS = 120;
export const CLOSE_MS = 180;
export const MAX_CARDS = 3;

/* One fetch per page load, shared. Hovering a menu must not put a request on
   the wire every time the pointer passes over it. */
let cache = null;
let inflight = null;
export function loadHampers() {
    if (cache) return Promise.resolve(cache);
    if (!inflight) {
        inflight = listHampers()
            .then((d) => {
                cache = Array.isArray(d) ? d : [];
                return cache;
            })
            .catch(() => {
                inflight = null; // a failed load can be retried on a later hover
                return [];
            });
    }
    return inflight;
}

/** Struck-through figure — same precedence as the product page and the cards. */
export function flyoutSavings(h) {
    const price = Number(h?.price || 0);
    const listed = Number(h?.original_price || 0);
    const contents = Number(h?.contents_value || 0);
    const full = listed > price ? listed : contents;
    if (!full || full <= price) return null;
    return { full, pct: Math.round((1 - price / full) * 100) };
}

/** Shared state for the trigger and the panel. */
export function useGiftingFlyout() {
    const [open, setOpen] = useState(false);
    const [hampers, setHampers] = useState(null);
    const openT = useRef(null);
    const closeT = useRef(null);

    useEffect(() => {
        let live = true;
        loadHampers().then((d) => live && setHampers(d));
        return () => {
            live = false;
        };
    }, []);

    const clear = () => {
        clearTimeout(openT.current);
        clearTimeout(closeT.current);
    };
    const wantOpen = useCallback(() => {
        clear();
        openT.current = setTimeout(() => setOpen(true), OPEN_MS);
    }, []);
    const wantClose = useCallback(() => {
        clear();
        closeT.current = setTimeout(() => setOpen(false), CLOSE_MS);
    }, []);
    const close = useCallback(() => {
        clear();
        setOpen(false);
    }, []);

    useEffect(() => () => clear(), []);
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => e.key === "Escape" && close();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, close]);

    const shown = (hampers || []).slice(0, MAX_CARDS);
    return {
        open,
        hampers: shown,
        // Nothing to show, so nothing opens. A menu that drops an empty panel
        // is worse than one that does not drop at all.
        hasPanel: shown.length > 0,
        wantOpen,
        wantClose,
        close,
        setOpen,
    };
}

function HamperCard({ h }) {
    const s = flyoutSavings(h);
    const stock = Number(h?.stock ?? 0);
    const img = (h?.cover_image || "").trim();
    return (
        <Link to={`/books/${h.id}`} data-testid={`flyout-hamper-${h.id}`} className="group block min-w-0">
            {/* Fixed 4:3 cropped to fill — the same rule as the contents rows.
                Hamper photographs arrive in whatever shape they were shot, and
                mixed ratios here make every card a different height. */}
            <div className="aspect-[4/3] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                {img ? (
                    <img
                        src={mediaUrl(img)}
                        alt={h.title}
                        loading="lazy"
                        className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-[#9CA3AF]">
                        Photograph to come
                    </div>
                )}
            </div>
            {h.occasion && <div className="overline !text-[10px] mt-3">{h.occasion}</div>}
            {/* Two lines with the height reserved, so one long name cannot shove
                its price out of line with the card beside it. */}
            <div className="font-serif text-[15.5px] leading-snug mt-1 line-clamp-2 min-h-[2.6em] text-[#002B5C] group-hover:text-[#CC0033] transition-colors">
                {h.title}
            </div>
            <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
                <span className="font-serif text-[15.5px]">{formatINR(h.price)}</span>
                {s && (
                    <>
                        <span className="text-xs text-[#4B5563] line-through">{formatINR(s.full)}</span>
                        <span className="text-[11px] font-semibold text-[#CC0033]">{s.pct}% off</span>
                    </>
                )}
            </div>
            <div
                className={`text-[11px] mt-1 min-h-[1.1em] ${
                    stock > 0 && stock <= 15 ? "text-[#CC0033] font-medium" : "text-[#4B5563]"
                }`}
            >
                {stock <= 0 ? "Sold out" : stock <= 15 ? `Only ${stock} left` : ""}
            </div>
        </Link>
    );
}

/** The nav item. Goes inside <nav>. */
export function GiftingTrigger({ label = "Gifting", to = "/gifting", fly }) {
    return (
        <div
            className="relative flex items-center"
            onMouseEnter={fly.hasPanel ? fly.wantOpen : undefined}
            onMouseLeave={fly.hasPanel ? fly.wantClose : undefined}
            onFocus={fly.hasPanel ? fly.wantOpen : undefined}
            /* Tab on, tab off. Without this the full-width panel stays open
               over the page until Escape or a mouse gesture closes it. */
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) fly.wantClose();
            }}
            data-testid="gifting-flyout-trigger"
        >
            <Link
                to={to}
                aria-haspopup={fly.hasPanel ? "true" : undefined}
                aria-expanded={fly.hasPanel ? fly.open : undefined}
                aria-controls={fly.hasPanel ? "gifting-flyout-panel" : undefined}
                className={`text-[13px] xl:text-sm font-medium whitespace-nowrap transition-colors ${
                    fly.open ? "text-[#002B5C]" : "text-[#4B5563] hover:text-[#002B5C]"
                }`}
            >
                {label}
            </Link>
            {/* No hover bridge. One was tried: anchored to a 20px link inside an
                80px header it sat mid-header, ended short of the panel, and only
                rendered once the menu was already open. CLOSE_MS is what
                actually carries the pointer across the gap. */}
        </div>
    );
}

/** The panel. Goes directly inside the <header>, NOT inside <nav>. */
export function GiftingPanel({ fly }) {
    if (!fly.hasPanel) return null;
    return (
        <div
            onMouseEnter={fly.wantOpen}
            onMouseLeave={fly.wantClose}
            id="gifting-flyout-panel"
            role="group"
            aria-label="Gift hampers"
            data-testid="gifting-flyout-panel"
            className={`hidden lg:block absolute left-0 right-0 top-full z-40 bg-white border-b border-[#E5E7EB] shadow-[0_26px_40px_-26px_rgba(0,43,92,0.35)] transition-[opacity,transform,visibility] duration-200 ${
                fly.open
                    ? "opacity-100 visible translate-y-0 pointer-events-auto"
                    : "opacity-0 invisible -translate-y-2 pointer-events-none"
            }`}
        >
            {/*
             * Three layouts, not one scaled down.
             *   xl (1280+)  three cards beside a 250px rail
             *   lg          two cards, and the rail moves UNDERNEATH them
             * At 1024 — the narrowest the horizontal nav ever is — a rail beside
             * two cards leaves its text wrapping every three words.
             */}
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-6 xl:py-7 grid gap-6 xl:gap-x-9 xl:gap-y-0 xl:grid-cols-[minmax(0,1fr)_1px_250px]">
                <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-4 pb-3 mb-5 border-b-2 border-[#002B5C]">
                        <span className="overline !text-[10px]">Gift hampers</span>
                        <Link to="/gifting" className="text-xs text-[#002B5C] hover:text-[#CC0033] whitespace-nowrap">
                            See all →
                        </Link>
                    </div>
                    {/* The third card is hidden below xl, where the grid is two wide --
                        otherwise it lands alone on a second row beside an empty
                        cell, which reads as a layout fault rather than a choice. */}
                    <div className="grid gap-5 grid-cols-2 xl:grid-cols-3 [&>*:nth-child(3)]:hidden xl:[&>*:nth-child(3)]:block">
                        {fly.hampers.map((h) => (
                            <HamperCard key={h.id} h={h} />
                        ))}
                    </div>
                </div>

                <div className="hidden xl:block bg-[#E5E7EB] self-stretch" />

                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-1 gap-x-5 gap-y-1 border-t border-[#E5E7EB] pt-4 xl:border-t-0 xl:pt-0">
                    <Link to="/gifting" className="block text-[13px] py-2 xl:py-2.5 xl:border-b xl:border-[#E5E7EB] text-[#002B5C] hover:text-[#CC0033] leading-snug">
                        All gift hampers
                        <span className="block text-[11px] text-[#4B5563] mt-0.5">Every hamper on sale</span>
                    </Link>
                    <Link to="/contact" className="block text-[13px] py-2 xl:py-2.5 xl:border-b xl:border-[#E5E7EB] text-[#002B5C] hover:text-[#CC0033] leading-snug">
                        Corporate &amp; bulk gifting
                        <span className="block text-[11px] text-[#4B5563] mt-0.5">Chambers, firms and in-house teams</span>
                    </Link>
                    <Link to="/gifting" className="block text-[13px] py-2 xl:py-2.5 xl:border-b xl:border-[#E5E7EB] text-[#002B5C] hover:text-[#CC0033] leading-snug">
                        Delivered to them, billed to you
                        <span className="block text-[11px] text-[#4B5563] mt-0.5">No price goes with the hamper</span>
                    </Link>
                    <Link
                        to="/gifting"
                        className="self-center xl:mt-4 block bg-[#002B5C] text-white text-center text-[13px] font-semibold px-4 py-3 hover:bg-[#001F42]"
                    >
                        Browse all hampers
                    </Link>
                </div>
            </div>
        </div>
    );
}

/** The mobile drawer section. Hover does not exist here, so it expands. */
export function GiftingDrawerSection({ label = "Gifting", to = "/gifting", fly, onNavigate }) {
    const [expanded, setExpanded] = useState(false);
    /*
     * With no hampers to list, this is still a nav link and must still be one.
     * Returning null here removed Gifting from the mobile menu entirely while
     * desktop kept showing it -- two different menus on one site, and the phone
     * losing a page it can reach.
     */
    if (!fly.hasPanel) {
        return (
            <Link
                to={to}
                onClick={onNavigate}
                data-testid="gifting-drawer-plain"
                className="text-base font-medium text-[#002B5C] py-1.5"
            >
                {label}
            </Link>
        );
    }
    return (
        <div className="border-b border-[#002B5C]/10" data-testid="gifting-drawer-section">
            <div className="flex items-center justify-between">
                {/* Tapping the WORD navigates; tapping the caret expands. Two
                    targets, because on a phone a single tap that does both is a
                    coin toss for the customer. */}
                <Link
                    to={to}
                    onClick={onNavigate}
                    className="flex-1 py-3 text-[15px] text-[#002B5C] font-medium"
                >
                    {label}
                </Link>
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    aria-label={expanded ? `Hide ${label} hampers` : `Show ${label} hampers`}
                    data-testid="gifting-drawer-toggle"
                    className="px-3 py-3 text-[#4B5563]"
                >
                    {expanded ? "⌃" : "⌄"}
                </button>
            </div>
            {expanded && (
                <div className="bg-[#F5F7FA] px-1 pb-3">
                    {fly.hampers.map((h) => {
                        const s = flyoutSavings(h);
                        return (
                            <Link
                                key={h.id}
                                to={`/books/${h.id}`}
                                onClick={onNavigate}
                                data-testid={`drawer-hamper-${h.id}`}
                                className="flex gap-3 items-center py-2.5 border-b border-[#E5E7EB] last:border-b-0"
                            >
                                {h.cover_image ? (
                                    <img
                                        src={mediaUrl(h.cover_image)}
                                        alt={h.title}
                                        loading="lazy"
                                        className="w-14 h-11 object-cover border border-[#E5E7EB] shrink-0"
                                    />
                                ) : (
                                    <span aria-hidden="true" className="w-14 h-11 bg-white border border-[#E5E7EB] shrink-0" />
                                )}
                                <span className="text-[13.5px] leading-snug min-w-0">
                                    {h.title}
                                    <span className="block text-xs text-[#4B5563] mt-0.5">
                                        {formatINR(h.price)}
                                        {s ? ` · ${s.pct}% off` : ""}
                                    </span>
                                </span>
                            </Link>
                        );
                    })}
                    <Link
                        to="/gifting"
                        onClick={onNavigate}
                        className="block pt-3 text-[13.5px] text-[#002B5C] font-medium"
                    >
                        All gift hampers →
                    </Link>
                </div>
            )}
        </div>
    );
}
