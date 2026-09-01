import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BookCard from "./BookCard";

/**
 * A horizontally scrolling row of books.
 *
 * Distinct from BestsellerCarousel, which moves on its own: this one only
 * moves when someone asks it to. Two auto-scrolling rows on one page compete
 * for attention and neither wins, and a row of new titles is something a
 * visitor browses at their own pace rather than watches.
 *
 * WHY THE CARDS ARE SIZED IN PERCENTAGES
 *
 * Each width is chosen to leave part of the next card visible. That sliver is
 * the only thing telling a visitor the row continues — without it a carousel
 * reads as a grid that happens to be cut off, and nobody swipes. The arrows do
 * the same job for a mouse, but they are hidden on touch where a swipe is the
 * natural gesture and a button is just something else covering a cover.
 */
export default function BookRail({ books = [], compact = true, label = "Books" }) {
    const railRef = useRef(null);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(false);

    /* Which arrows are usable. An arrow that scrolls nowhere is a button that
       tells you it is broken, so both are disabled at their respective ends,
       and both disappear entirely when everything already fits. */
    const measure = useCallback(() => {
        const el = railRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        setAtStart(el.scrollLeft <= 8);
        setAtEnd(el.scrollLeft >= max - 8);
    }, []);

    useEffect(() => {
        measure();
        const el = railRef.current;
        if (!el) return undefined;
        el.addEventListener("scroll", measure, { passive: true });
        window.addEventListener("resize", measure);
        return () => {
            el.removeEventListener("scroll", measure);
            window.removeEventListener("resize", measure);
        };
    }, [measure, books.length]);

    // Just under a full width, so the card at the edge stays partly visible
    // after the jump and the eye keeps its place.
    const page = (dir) => {
        const el = railRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
    };

    if (!books.length) return null;

    const arrow =
        "hidden md:flex absolute top-[34%] -translate-y-1/2 z-10 w-9 h-9 items-center justify-center " +
        "bg-white border border-[#E5E7EB] text-[#002B5C] shadow-[0_8px_24px_-12px_rgba(0,43,92,0.4)] " +
        "hover:border-[#002B5C] transition-colors disabled:opacity-0 disabled:pointer-events-none";

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => page(-1)}
                disabled={atStart}
                aria-label={`Scroll ${label} left`}
                data-testid="book-rail-prev"
                className={`${arrow} left-0 -translate-x-1/2`}
            >
                <ChevronLeft size={17} strokeWidth={1.5} />
            </button>

            <div
                ref={railRef}
                role="region"
                aria-label={label}
                data-testid="book-rail"
                /* Cards are reachable by keyboard through their own links, and
                   the browser scrolls a focused card into view, so the rail
                   needs no tab stop of its own. */
                /*
                 * pt-6/-mt-6 and px-2/-mx-2 ARE FOR THE STAR TITLE FRAME, not
                 * for spacing. Every pair cancels out, so nothing moves.
                 *
                 * overflow-x-auto clips the OTHER axis too — CSS promotes
                 * overflow-y to auto the moment overflow-x is anything but
                 * visible, and there is no way to split them. A starred tile
                 * hangs its gold frame 8px outside its box on all four sides and
                 * its ribbon 21px above the top edge, none of which is layout,
                 * all of which lands outside the padding box this rail clips at.
                 * So the ribbon was sliced off along the top and a starred book
                 * at either end lost the side of its frame.
                 *
                 * Padding moves the clip edge outward; the matching negative
                 * margin pulls the box back so the cards, the section's spacing
                 * and the absolutely-positioned arrows all stay exactly where
                 * they were. The bestseller marquee (pt-4) and the related-titles
                 * rail (pt-6) fix the same trap with bare padding — they can
                 * afford the extra height because neither has an arrow pinned to
                 * a percentage of this box.
                 */
                className="flex gap-4 md:gap-5 overflow-x-auto snap-x scroll-smooth pt-6 -mt-6 px-2 -mx-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {books.map((b, i) => (
                    <div
                        key={b.id}
                        className="flex-shrink-0 snap-start w-[40%] sm:w-[28%] md:w-[21%] lg:w-[13.2%]"
                    >
                        <BookCard book={b} index={i} compact={compact} />
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={() => page(1)}
                disabled={atEnd}
                aria-label={`Scroll ${label} right`}
                data-testid="book-rail-next"
                className={`${arrow} right-0 translate-x-1/2`}
            >
                <ChevronRight size={17} strokeWidth={1.5} />
            </button>
        </div>
    );
}
