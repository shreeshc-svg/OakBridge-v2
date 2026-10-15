import React, { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../lib/api";

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

    useEffect(() => {
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
            data-testid="store-strip"
            aria-label={title || "Also available on"}
            className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-12 md:py-16 border-b border-[#E5E7EB] bg-[#F5F7FA]"
        >
            {title && (
                <h2 className="text-center font-serif text-2xl md:text-3xl text-[#002B5C]">{title}</h2>
            )}
            {subtitle && (
                <p className="text-center text-sm md:text-base text-[#4B5563] mt-2">{subtitle}</p>
            )}
            <div className={title || subtitle ? "mt-8 md:mt-10" : ""} />
            <div
                ref={wrapRef}
                className="relative overflow-hidden"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onTouchStart={() => setPaused(true)}
                onTouchEnd={() => setPaused(false)}
            >
                <style>{`@keyframes oakStores{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
                <ul
                    ref={trackRef}
                    className={`flex items-center ${scroll ? "w-max" : "flex-wrap justify-center gap-y-4 md:gap-y-6"}`}
                    style={scroll ? { animation: `oakStores ${dur}s linear infinite`, animationPlayState: paused ? "paused" : "running" } : undefined}
                >
                    {loop.map((s, i) => (
                        <li
                            key={`${s.id || s.name}-${i}`}
                            aria-hidden={i >= items.length ? "true" : undefined}
                            className="flex-none px-2 md:px-3"
                        >
                            {/* Every logo sits in the same white tile, so square
                                icons and wide wordmarks read as one even row
                                instead of a ragged line of mismatched sizes.
                                mix-blend-multiply lets a logo uploaded on a
                                plain white background melt into the tile. */}
                            <div className="w-36 h-20 sm:w-44 sm:h-24 md:w-56 md:h-28 bg-white border border-[#E5E7EB] shadow-sm flex items-center justify-center px-5 md:px-7 transition-shadow hover:shadow-md">
                                <img
                                    src={mediaUrl(s.logo)}
                                    alt={i >= items.length ? "" : (s.alt || s.name || "")}
                                    loading="lazy"
                                    decoding="async"
                                    className="max-h-10 sm:max-h-12 md:max-h-14 max-w-full w-auto object-contain mix-blend-multiply"
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
