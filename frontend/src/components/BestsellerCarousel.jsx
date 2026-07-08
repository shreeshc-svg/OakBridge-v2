import React, { useEffect, useRef, useState } from "react";
import BookCard from "./BookCard";

// Endless, seamless marquee. Renders the list twice and translates the track by
// exactly one copy (-50%), looping forever. `speed` is pixels/second; the track
// pauses on hover so shoppers can click a card.
export default function BestsellerCarousel({ books = [], speed = 40 }) {
    const trackRef = useRef(null);
    const [dur, setDur] = useState(30);
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        const measure = () => {
            const el = trackRef.current;
            if (!el) return;
            const oneCopy = el.scrollWidth / 2; // half = a single set of books
            const px = Math.max(5, Number(speed) || 40);
            setDur(Math.max(6, oneCopy / px));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [books, speed]);

    if (!books.length) return null;
    const loop = [...books, ...books];

    return (
        <div
            className="relative overflow-hidden"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onTouchStart={() => setPaused(true)}
            onTouchEnd={() => setPaused(false)}
            data-testid="bestseller-carousel"
        >
            <style>{`@keyframes oakMarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
            <div
                ref={trackRef}
                className="flex w-max"
                style={{
                    animation: `oakMarquee ${dur}s linear infinite`,
                    animationPlayState: paused ? "paused" : "running",
                }}
            >
                {loop.map((b, i) => (
                    <div
                        key={i}
                        aria-hidden={i >= books.length}
                        className="flex-none w-[150px] sm:w-[175px] md:w-[200px] mr-6"
                    >
                        <BookCard book={b} index={i} compact />
                    </div>
                ))}
            </div>
        </div>
    );
}
