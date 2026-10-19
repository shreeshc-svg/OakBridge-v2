import React, { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../lib/api";
import { isPrerender } from "../lib/runtime";

/**
 * "Available on" confidence strip — the stores that also sell Oakbridge books
 * (Amazon, Flipkart, Kindle, the Oakbridge eReader…), as logos only.
 *
 * Logos only, no links (admin's choice): the strip says "you can trust this
 * publisher, it is everywhere", while the book page carries the per-title
 * "Also available on" links. Admin → Pages → Homepage → Stores manages the
 * list; the section is ordered and shown/hidden like every other homepage
 * section ("home.stores").
 *
 * The artwork is the store's official logo uploaded by an admin — nothing is
 * drawn here, and an entry without a logo is simply not shown.
 *
 * Look: the dark navy band with the hero's aurora + moving grid (styles
 * .st-* in index.css, reusing the hero's hx- keyframes), white logo tiles that
 * rise in, bob gently and lift with a light sweep on hover.
 *
 * Motion: a slow endless marquee (two copies, translated by -50%) that pauses
 * on hover/touch. With prefers-reduced-motion, or when everything fits on
 * screen, it is a still, centred row instead.
 */
export default function StoreStrip({ stores = [], title = "", subtitle = "", speed = 30 }) {
    const items = stores.filter((s) => s && s.enabled !== false && s.logo);
    const trackRef = useRef(null);
    const wrapRef = useRef(null);
    const [dur, setDur] = useState(30);
    const [paused, setPaused] = useState(false);
    const [scroll, setScroll] = useState(false);
    const sectionRef = useRef(null);
    // Tiles rise in when the strip scrolls into view (like the hero's text).
    // No IntersectionObserver (old browsers, the prerender) -> shown at once,
    // so the logos are never stuck invisible.
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = sectionRef.current;
        if (isPrerender()) return undefined; // same reason as above: no markup changes in the snapshot
        if (!el || typeof IntersectionObserver === "undefined") {
            setInView(true);
            return undefined;
        }
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                setInView(true);
                io.disconnect();
            }
        }, { threshold: 0.15 });
        io.observe(el);
        return () => io.disconnect();
    }, [items.length]);

    useEffect(() => {
        // Never during the prerender: puppeteer captures the HTML AFTER effects
        // run, so a marquee switched on here was baked in as 8 logos while the
        // browser's first render has 4 — a hydration mismatch (#418) that made
        // React throw the server HTML away on every homepage visit. Seen live
        // 2026-10-19. The browser measures and switches it on after hydrating.
        if (isPrerender()) return undefined;
        const measure = () => {
            const el = trackRef.current;
            const wrap = wrapRef.current;
            if (!el || !wrap) return;
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            // Width of ONE set of logos, whether or not the copy is rendered.
            const oneCopy = Array.from(el.children).slice(0, items.length).reduce((w, c) => w + c.offsetWidth, 0);
            // Scroll only when one copy is wider than the screen; a short list
            // that fits is calmer (and clearer) standing still.
            const needs = !reduce && oneCopy > wrap.clientWidth;
            setScroll(needs);
            setDur(Math.max(10, oneCopy / Math.max(5, Number(speed) || 30)));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [items.length, speed]);

    if (!items.length) return null;
    const loop = scroll ? [...items, ...items] : items;

    return (
        <section
            ref={sectionRef}
            data-testid="store-strip"
            aria-label={title || "Also available on"}
            className={`st-strip px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-10 md:py-12 ${inView ? "is-in" : ""}`}
            style={{ "--accent": "#38bdf8" }}
        >
            {/* Same moving backdrop as the hero (aurora + perspective grid),
                so the strip reads as part of the same dark opening band. */}
            <div className="st-aurora" aria-hidden="true" />
            <div className="st-grid" aria-hidden="true" />
            {/* One row on desktop — text left, logos right — at the eBook
                banner's height (same py-10 md:py-12). Stacks on phones. */}
            <div className="st-inner flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 lg:gap-10">
                <div className="flex-none text-center lg:text-left">
                <div className="st-reveal" style={{ "--d": "0s" }}>
                    {/* A light runs round the pill's border and the tick
                        draws itself — deliberately not the hero's pulsing-dot
                        pill, so the two sections don't repeat each other. */}
                    <span className="st-badge">
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                            <path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.4-7.5 10-4.3-1.6-7.5-5.4-7.5-10v-6z" fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeLinejoin="round" />
                            <path className="st-tick" d="M8.2 12.3l2.6 2.6 5-5.2" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Sold on {items.length} trusted {items.length === 1 ? "store" : "stores"}
                    </span>
                </div>
                {title && (
                    <h2 className="st-title st-reveal mt-3" style={{ "--d": ".1s" }}>{title}</h2>
                )}
                {subtitle && (
                    <p className="st-reveal text-sm text-white/75 mt-2" style={{ "--d": ".2s" }}>{subtitle}</p>
                )}
                </div>
                {/* flex-1 min-w-0: the logo area takes the rest of the row and
                    may shrink, so the marquee measures the space it really has.
                    overflow-hidden (needed for the sideways marquee) also clips
                    vertically, so the tiles' bob + hover lift + shadow need room:
                    py-7 gives 28px above and below, -my-5 takes most of it back
                    so the strip is no taller than before. */}
                <div
                    ref={wrapRef}
                    className={`relative overflow-hidden flex-1 min-w-0 py-7 -my-5 ${scroll ? "st-fade" : ""}`}
                    onMouseEnter={() => setPaused(true)}
                    onMouseLeave={() => setPaused(false)}
                    onTouchStart={() => setPaused(true)}
                    onTouchEnd={() => setPaused(false)}
                >
                    <style>{`@keyframes oakStores{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
                    <ul
                        ref={trackRef}
                        className={`flex items-center ${scroll ? "w-max" : "flex-wrap justify-center lg:justify-end gap-y-4"}`}
                        style={scroll ? { animation: `oakStores ${dur}s linear infinite`, animationPlayState: paused ? "paused" : "running" } : undefined}
                    >
                        {loop.map((s, i) => (
                            <li
                                key={`${s.id || s.name}-${i}`}
                                aria-hidden={i >= items.length ? "true" : undefined}
                                className="flex-none px-2 md:px-2.5 st-reveal"
                                style={{ "--d": `${0.3 + (i % items.length) * 0.12}s` }}
                            >
                                {/* li = entrance, st-float = idle bob (staggered so
                                    the tiles never move in lockstep), st-tile =
                                    hover lift + sweep. Three elements because each
                                    animation owns a different transform. White tile
                                    so every brand's dark-on-transparent logo stays
                                    legible on the dark band; mix-blend-multiply
                                    melts a logo uploaded on plain white into it. */}
                                <div className="st-float" style={{ "--f": `${(i % items.length) * -1.3}s` }}>
                                    <div className="st-tile w-36 h-16 md:w-44 md:h-20 flex items-center justify-center px-4 md:px-5">
                                        <img
                                            src={mediaUrl(s.logo)}
                                            alt={i >= items.length ? "" : (s.alt || s.name || "")}
                                            loading="lazy"
                                            decoding="async"
                                            className="relative z-[1] max-h-9 md:max-h-11 max-w-full w-auto object-contain mix-blend-multiply"
                                        />
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
