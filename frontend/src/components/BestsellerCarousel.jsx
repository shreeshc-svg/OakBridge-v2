import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BookCard from "./BookCard";

// Auto-scrolling product carousel. Advances one card every few seconds,
// pauses on hover/touch, and has manual prev/next controls.
export default function BestsellerCarousel({ books = [], interval = 2800 }) {
    const trackRef = useRef(null);
    const [paused, setPaused] = useState(false);

    const step = (dir) => {
        const el = trackRef.current;
        if (!el) return;
        const card = el.firstElementChild;
        const delta = (card ? card.offsetWidth : 220) + 24; // card + gap-6
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
        if (dir > 0 && atEnd) {
            el.scrollTo({ left: 0, behavior: "smooth" });
        } else {
            el.scrollBy({ left: dir * delta, behavior: "smooth" });
        }
    };

    useEffect(() => {
        if (!books.length) return undefined;
        const id = setInterval(() => {
            if (!paused) step(1);
        }, interval);
        return () => clearInterval(id);
    }, [books, paused, interval]);

    if (!books.length) return null;

    return (
        <div
            className="relative"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onTouchStart={() => setPaused(true)}
            data-testid="bestseller-carousel"
        >
            <div
                ref={trackRef}
                className="flex gap-6 overflow-x-auto scroll-smooth pb-2 snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {books.map((b, i) => (
                    <div
                        key={b.id}
                        className="snap-start flex-none w-[46%] sm:w-[30%] md:w-[22%] lg:w-[16.2%]"
                    >
                        <BookCard book={b} index={i} compact />
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous"
                data-testid="carousel-prev"
                className="hidden md:flex absolute -left-4 top-[42%] -translate-y-1/2 w-9 h-9 items-center justify-center rounded-full bg-white border border-[#E5E7EB] shadow hover:border-[#002B5C] text-[#002B5C]"
            >
                <ChevronLeft size={18} strokeWidth={1.75} />
            </button>
            <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next"
                data-testid="carousel-next"
                className="hidden md:flex absolute -right-4 top-[42%] -translate-y-1/2 w-9 h-9 items-center justify-center rounded-full bg-white border border-[#E5E7EB] shadow hover:border-[#002B5C] text-[#002B5C]"
            >
                <ChevronRight size={18} strokeWidth={1.75} />
            </button>
        </div>
    );
}
