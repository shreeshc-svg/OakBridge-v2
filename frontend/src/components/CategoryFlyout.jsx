import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCategories, fetchBestsellers, formatINR, mediaUrl } from "../lib/api";
import { OPEN_MS, CLOSE_MS } from "./GiftingFlyout";

/**
 * The Bookstore mega-menu: the catalogue's six categories, with the current
 * bestsellers on a rail beside them.
 *
 * WHY THIS IS A SECOND FILE AND NOT A GENERALISED ONE
 *
 * GiftingFlyout solved the hard parts already — the panel anchors to the
 * header rather than to the nav word, the open/close timers, Escape, tab-away.
 * The obvious move is to extract that into one shared hook and have both menus
 * call it.
 *
 * It was not done, deliberately. test-gifting-flyout.mjs asserts five of those
 * behaviours as source text INSIDE GiftingFlyout.jsx — the literal timer
 * values, the Escape handler, the unmount cleanup, the cache and its retry.
 * Extracting them would break a passing test on a live storefront in order to
 * share about thirty lines. The timing constants ARE imported from there, so
 * the two menus cannot come to feel different, and that is the part that
 * actually matters to someone using the site. The rest is deliberate
 * duplication with a reason.
 *
 * WHY CATEGORIES AND NOT SUBJECTS
 *
 * Six categories, four of them substantial (Law 84, Academic 57, Business &
 * General 29, Tax 27). Subjects run to dozens and belong to the filter rail on
 * /books, where they can be combined. A menu is for deciding where to go, not
 * for narrowing once you are there.
 *
 * WHERE IT DOES NOT EXIST
 *
 * Below lg (1024px) the horizontal nav is `hidden lg:flex` and the burger takes
 * over, so the panel never renders. The drawer section at the bottom of this
 * file is the phone treatment.
 */

export const MAX_BESTSELLERS = 3;

/*
 * One fetch of each per page load, shared between every consumer.
 *
 * Two separate caches rather than one combined promise: the categories are what
 * the menu is FOR, and the bestseller rail is decoration. If /books/bestsellers
 * is slow or failing, the categories must still open — a combined Promise.all
 * would have held the whole menu shut waiting for the part nobody came for.
 */
let catCache = null;
let catInflight = null;
export function loadNavCategories() {
    if (catCache) return Promise.resolve(catCache);
    if (!catInflight) {
        catInflight = fetchCategories()
            .then((d) => {
                catCache = Array.isArray(d) ? d : [];
                return catCache;
            })
            .catch(() => {
                catInflight = null; // a failed load can be retried on a later hover
                return [];
            });
    }
    return catInflight;
}

let bestCache = null;
let bestInflight = null;
export function loadNavBestsellers() {
    if (bestCache) return Promise.resolve(bestCache);
    if (!bestInflight) {
        bestInflight = fetchBestsellers(MAX_BESTSELLERS)
            .then((d) => {
                bestCache = Array.isArray(d) ? d : [];
                return bestCache;
            })
            .catch(() => {
                bestInflight = null;
                return [];
            });
    }
    return bestInflight;
}

/**
 * Drop the categories nobody can browse.
 *
 * Bespoke publishes 0 titles today and Coffee Table publishes 1. A menu row
 * reading "Bespoke — 0 titles" advertises an empty results page, and a customer
 * who clicks it has been sent somewhere to find nothing. Filtering on the count
 * means the row comes back by itself the day a book is filed under it, with no
 * second setting for anyone to remember.
 *
 * Sorted by the admin's own `order`, so the menu matches the category row on
 * /books rather than inventing a second sequence.
 */
export function browsableCategories(list) {
    return (Array.isArray(list) ? list : [])
        .filter((c) => c && c.id && Number(c.book_count) > 0)
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** Shared state for the trigger, the panel and the drawer section. */
export function useCategoryFlyout() {
    const [open, setOpen] = useState(false);
    const [cats, setCats] = useState(null);
    const [best, setBest] = useState(null);
    const openT = useRef(null);
    const closeT = useRef(null);

    useEffect(() => {
        let live = true;
        loadNavCategories().then((d) => live && setCats(d));
        loadNavBestsellers().then((d) => live && setBest(d));
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

    const categories = browsableCategories(cats);
    return {
        open,
        categories,
        bestsellers: (best || []).slice(0, MAX_BESTSELLERS),
        /* The categories decide whether there is a menu at all. The bestseller
           rail is allowed to be empty — it is the trimming, not the content. */
        hasPanel: categories.length > 0,
        wantOpen,
        wantClose,
        close,
        setOpen,
    };
}

/** The nav item. Goes inside <nav>. */
export function CategoryTrigger({ label = "Bookstore", to = "/books", fly }) {
    return (
        <div
            className="relative flex items-center"
            onMouseEnter={fly.hasPanel ? fly.wantOpen : undefined}
            onMouseLeave={fly.hasPanel ? fly.wantClose : undefined}
            onFocus={fly.hasPanel ? fly.wantOpen : undefined}
            /* Tab on, tab off — without this the full-width panel stays open
               over the page until Escape or a mouse gesture closes it. */
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) fly.wantClose();
            }}
            data-testid="category-flyout-trigger"
        >
            <Link
                to={to}
                aria-haspopup={fly.hasPanel ? "true" : undefined}
                aria-expanded={fly.hasPanel ? fly.open : undefined}
                aria-controls={fly.hasPanel ? "category-flyout-panel" : undefined}
                className={`text-[13px] xl:text-sm font-medium whitespace-nowrap transition-colors ${
                    fly.open ? "text-[#002B5C]" : "text-[#4B5563] hover:text-[#002B5C]"
                }`}
            >
                {label}
            </Link>
        </div>
    );
}

function BestsellerRow({ b }) {
    const img = (b?.cover_image || "").trim();
    return (
        <Link
            to={`/books/${b.id}`}
            data-testid={`flyout-bestseller-${b.id}`}
            className="group flex gap-3 items-center py-2.5 border-b border-[#E5E7EB] last:border-b-0"
        >
            {/* Portrait thumbnail, contained not cropped. A book cover cropped
                to fill loses the title off the top edge, which is the one part
                of it doing any work at this size. */}
            <div className="w-10 h-14 shrink-0 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                {img ? (
                    <img
                        src={mediaUrl(img)}
                        alt={b.title}
                        loading="lazy"
                        className="w-full h-full object-contain"
                    />
                ) : null}
            </div>
            <span className="min-w-0">
                <span className="block text-[13px] leading-snug line-clamp-2 text-[#002B5C] group-hover:text-[#CC0033] transition-colors">
                    {b.title}
                </span>
                <span className="block text-[11px] text-[#4B5563] mt-0.5">
                    {formatINR(b.price)}
                </span>
            </span>
        </Link>
    );
}

/** The panel. Goes directly inside the <header>, NOT inside <nav>. */
export function CategoryPanel({ fly }) {
    if (!fly.hasPanel) return null;
    return (
        <div
            onMouseEnter={fly.wantOpen}
            onMouseLeave={fly.wantClose}
            id="category-flyout-panel"
            role="group"
            aria-label="Browse the bookstore"
            data-testid="category-flyout-panel"
            className={`hidden lg:block absolute left-0 right-0 top-full z-40 bg-white border-b border-[#E5E7EB] shadow-[0_26px_40px_-26px_rgba(0,43,92,0.35)] transition-[opacity,transform,visibility] duration-200 ${
                fly.open
                    ? "opacity-100 visible translate-y-0 pointer-events-auto"
                    : "opacity-0 invisible -translate-y-2 pointer-events-none"
            }`}
        >
            {/* Same padding scale as the header above it, so the first category
                lines up with the nav word that opened the menu. */}
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-6 xl:py-7 grid gap-6 xl:gap-x-9 xl:gap-y-0 xl:grid-cols-[minmax(0,1fr)_1px_250px]">
                <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-4 pb-3 mb-5 border-b-2 border-[#002B5C]">
                        <span className="overline !text-[10px]">Browse by category</span>
                        <Link
                            to="/books"
                            className="text-xs text-[#002B5C] hover:text-[#CC0033] whitespace-nowrap"
                        >
                            All titles →
                        </Link>
                    </div>
                    {/* Two columns at lg, three at xl. Unlike the hamper cards
                        nothing is hidden at the narrower breakpoint: these are
                        text rows, so an uneven last row reads as a list ending
                        rather than as a missing tile. */}
                    <div className="grid gap-x-8 gap-y-1 grid-cols-2 xl:grid-cols-3">
                        {fly.categories.map((c) => (
                            <Link
                                key={c.id}
                                to={`/books?category=${encodeURIComponent(c.id)}`}
                                data-testid={`flyout-category-${c.id}`}
                                className="group block py-2.5 border-b border-[#E5E7EB] min-w-0"
                            >
                                <span className="flex items-baseline justify-between gap-3">
                                    <span className="text-[13.5px] font-medium text-[#002B5C] group-hover:text-[#CC0033] transition-colors">
                                        {c.name}
                                    </span>
                                    {/* Tabular, so the numbers line up down the
                                        column instead of jittering by digit. */}
                                    <span className="text-[11px] font-mono text-[#4B5563] tabular-nums shrink-0">
                                        {c.book_count}
                                    </span>
                                </span>
                                {c.description && (
                                    <span className="block text-[11px] text-[#4B5563] mt-0.5 leading-snug line-clamp-2">
                                        {c.description}
                                    </span>
                                )}
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="hidden xl:block bg-[#E5E7EB] self-stretch" />

                <div className="border-t border-[#E5E7EB] pt-4 xl:border-t-0 xl:pt-0">
                    {/* The rail is allowed to be empty. If /books/bestsellers is
                        down, the categories — the thing the menu is for — still
                        open, rather than the whole panel waiting on decoration. */}
                    {fly.bestsellers.length > 0 && (
                        <>
                            <div className="overline !text-[10px] pb-3 mb-1 border-b-2 border-[#002B5C]">
                                Bestsellers
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-1 gap-x-6">
                                {fly.bestsellers.map((b) => (
                                    <BestsellerRow key={b.id} b={b} />
                                ))}
                            </div>
                        </>
                    )}
                    <Link
                        to="/books"
                        data-testid="category-flyout-cta"
                        className="mt-4 block bg-[#002B5C] text-white text-center text-[13px] font-semibold px-4 py-3 hover:bg-[#001F42]"
                    >
                        Browse all titles
                    </Link>
                </div>
            </div>
        </div>
    );
}

/** The mobile drawer section. Hover does not exist here, so it expands. */
export function CategoryDrawerSection({ label = "Bookstore", to = "/books", fly, onNavigate }) {
    const [expanded, setExpanded] = useState(false);
    /*
     * With no categories loaded this is still a nav link and must still be one.
     * Returning null would drop the Bookstore from the phone menu while desktop
     * kept showing it — two different menus on one site, and the phone losing
     * the page the whole business runs on.
     */
    if (!fly.hasPanel) {
        return (
            <Link
                to={to}
                onClick={onNavigate}
                data-testid="category-drawer-plain"
                className="text-base font-medium text-[#002B5C] py-1.5"
            >
                {label}
            </Link>
        );
    }
    return (
        <div className="border-b border-[#002B5C]/10" data-testid="category-drawer-section">
            <div className="flex items-center justify-between">
                {/* Tapping the WORD navigates; tapping the caret expands. Two
                    targets, because on a phone one tap doing both is a coin
                    toss for the customer. */}
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
                    aria-label={expanded ? `Hide ${label} categories` : `Show ${label} categories`}
                    data-testid="category-drawer-toggle"
                    className="px-3 py-3 text-[#4B5563]"
                >
                    {expanded ? "⌃" : "⌄"}
                </button>
            </div>
            {expanded && (
                <div className="bg-[#F5F7FA] px-1 pb-3">
                    {fly.categories.map((c) => (
                        <Link
                            key={c.id}
                            to={`/books?category=${encodeURIComponent(c.id)}`}
                            onClick={onNavigate}
                            data-testid={`drawer-category-${c.id}`}
                            className="flex items-baseline justify-between gap-3 py-2.5 border-b border-[#E5E7EB] last:border-b-0"
                        >
                            <span className="text-[13.5px] text-[#002B5C]">{c.name}</span>
                            <span className="text-[11px] font-mono text-[#4B5563] tabular-nums shrink-0">
                                {c.book_count}
                            </span>
                        </Link>
                    ))}
                    <Link
                        to="/books"
                        onClick={onNavigate}
                        className="block pt-3 text-[13.5px] text-[#002B5C] font-medium"
                    >
                        All titles →
                    </Link>
                </div>
            )}
        </div>
    );
}
