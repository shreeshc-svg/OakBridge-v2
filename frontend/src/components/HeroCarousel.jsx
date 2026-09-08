import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { mediaUrl } from "../lib/api";
import SmartLink from "./SmartLink";

/**
 * Full-bleed banner carousel.
 *
 * Lifted out of MediaGallery, which had the only one, so the homepage banner
 * carousel is the SAME carousel rather than a second implementation that drifts
 * from it. Both callers get autoplay, swipe, arrows, dots and the
 * reduced-motion opt-out from one place.
 *
 * A slide is { id, image, image_mobile?, alt, link?, fit?, enabled? } — the
 * shape MediaListEditor writes into a content collection. Callers filter on
 * `enabled` before passing them in.
 *
 * WHY THE FRAME HAS A FIXED HEIGHT
 *
 * Uploaded banners are served through /api/files/... and `responsiveImage` only
 * builds a srcSet for Unsplash, so these <img>s carry no width/height and no
 * intrinsic ratio the browser can reserve space from. The fixed-height frame is
 * therefore the only defence against layout shift, and the empty-slide
 * placeholder uses the identical heights so a missing image still shifts
 * nothing. This matters more on the homepage than anywhere else: `/` is
 * prerendered and hydrated, so a late-arriving banner would move every section
 * under it and show up in Search Console as CLS.
 *
 * WHY IT ALWAYS STARTS AT SLIDE 0
 *
 * `/` is prerendered by puppeteer with a live API, so real slides are baked into
 * build/index.html at whatever index the timer had reached. Initial state is
 * hard-coded to 0 and the timer only ever starts inside an effect, so the first
 * client render is identical to the server markup. Deriving the initial index
 * from a timer, Date, or window would reintroduce React #418 on the one route
 * that can least afford it.
 */

const DEFAULT_HEIGHTS = "h-[300px] sm:h-[420px] lg:h-[520px]";

function Slide({ slide, index, heights, priority }) {
    const src = mediaUrl(slide.image) || slide.image;
    const mobile = slide.image_mobile ? mediaUrl(slide.image_mobile) || slide.image_mobile : null;

    if (!src) return <div className={`w-full ${heights} bg-[#0d2340]`} />;

    /* `fit: "contain"` shows a designed banner whole (nothing cropped); the
       default fills the frame, which suits photographs. */
    const img = (
        <img
            src={src}
            alt={slide.alt || ""}
            loading={index === 0 ? "eager" : "lazy"}
            {...(index === 0 && priority ? { fetchpriority: "high" } : {})}
            className={`w-full ${heights} ${slide.fit === "contain" ? "object-contain" : "object-cover"}`}
        />
    );

    /* A wide banner cropped to a phone loses its subject and usually its text.
       An optional portrait upload wins under 768px; without one the wide art is
       used at every width, exactly as before. */
    const picture = mobile ? (
        <picture>
            <source media="(max-width: 767px)" srcSet={mobile} />
            {img}
        </picture>
    ) : (
        img
    );

    return slide.link ? (
        <SmartLink to={slide.link} className="block">
            {picture}
        </SmartLink>
    ) : (
        picture
    );
}

export default function HeroCarousel({
    slides = [],
    testId = "hero-carousel",
    heights = DEFAULT_HEIGHTS,
    intervalMs = 6000,
    overlay = false,
    priority = false,
    label = "Banner",
    children,
}) {
    const [i, setI] = useState(0);
    const n = slides.length;
    const touch = useRef(null);
    const reduce = useRef(
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    useEffect(() => {
        if (n <= 1 || reduce.current) return undefined;
        const t = setInterval(() => setI((k) => (k + 1) % n), intervalMs);
        return () => clearInterval(t);
    }, [n, intervalMs]);

    // Slides can shrink between renders (an admin disables one). Without the
    // modulo the track would translate past the end and show blank space.
    const idx = n ? i % n : 0;

    return (
        <div
            data-testid={testId}
            className="relative bg-[#0d2340] overflow-hidden"
            aria-roledescription="carousel"
            onTouchStart={(e) => {
                touch.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
                if (touch.current == null || n <= 1) return;
                const dx = e.changedTouches[0].clientX - touch.current;
                if (Math.abs(dx) > 45) setI((k) => (k + (dx < 0 ? 1 : -1) + n) % n);
                touch.current = null;
            }}
        >
            <div
                className="flex transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${idx * 100}%)` }}
            >
                {(n ? slides : [{ id: "fallback" }]).map((s, k) => (
                    <div key={s.id || k} className="flex-[0_0_100%] min-w-full">
                        <Slide slide={s} index={k} heights={heights} priority={priority} />
                    </div>
                ))}
            </div>

            {overlay && (
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#002B5C]/95 via-[#002B5C]/30 to-transparent" />
            )}

            {children}

            {n > 1 && (
                <>
                    <button
                        onClick={() => setI((k) => (k - 1 + n) % n)}
                        aria-label={`Previous ${label.toLowerCase()}`}
                        className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center border border-white/40 bg-white/15 text-white hover:bg-white/30"
                    >
                        <ChevronLeft size={20} strokeWidth={1.5} />
                    </button>
                    <button
                        onClick={() => setI((k) => (k + 1) % n)}
                        aria-label={`Next ${label.toLowerCase()}`}
                        className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center border border-white/40 bg-white/15 text-white hover:bg-white/30"
                    >
                        <ChevronRight size={20} strokeWidth={1.5} />
                    </button>
                    <div className="absolute bottom-5 left-0 right-0 flex justify-center gap-2">
                        {slides.map((s, k) => (
                            <button
                                key={s.id || k}
                                onClick={() => setI(k)}
                                aria-label={`${label} ${k + 1}`}
                                aria-current={k === idx}
                                className={`h-[3px] w-7 ${k === idx ? "bg-[#F59E0B]" : "bg-white/35"}`}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
