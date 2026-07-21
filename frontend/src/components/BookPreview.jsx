import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen } from "lucide-react";
import { mediaUrl } from "../lib/api";

/**
 * "Look inside" preview viewer.
 *
 * Pages are served as rendered images (never the source PDF), so the full book
 * can't be downloaded or reassembled. Right-click, drag and the native image
 * context menu are disabled as a further deterrent.
 */
export default function BookPreview({ open, onClose, pages = [], title, totalPages }) {
    const [i, setI] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [loaded, setLoaded] = useState({});
    const touchX = useRef(null);
    const stripRef = useRef(null);

    const count = pages.length;
    const go = useCallback(
        (n) => {
            setI((cur) => Math.min(Math.max(n, 0), Math.max(count - 1, 0)));
            setZoom(1);
        },
        [count],
    );

    // reset when reopened
    useEffect(() => {
        if (open) {
            setI(0);
            setZoom(1);
        }
    }, [open]);

    // keyboard nav + lock background scroll
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowRight") go(i + 1);
            else if (e.key === "ArrowLeft") go(i - 1);
        };
        window.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [open, i, go, onClose]);

    // keep the active thumbnail in view
    useEffect(() => {
        const el = stripRef.current?.querySelector(`[data-thumb="${i}"]`);
        el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }, [i]);

    if (!open || count === 0) return null;

    const src = (p) => mediaUrl(p) || p;
    const block = (e) => e.preventDefault();

    return createPortal(
        <div
            className="fixed inset-0 h-[100dvh] z-[100] bg-[#002B5C]/95 backdrop-blur-sm flex flex-col overscroll-contain"
            data-testid="book-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${title || "book"}`}
        >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 md:px-8 h-14 sm:h-16 flex-shrink-0 border-b border-white/10">
                <div className="min-w-0">
                    <div className="overline !text-white/50 !text-[10px]">Look inside</div>
                    <div className="font-serif text-white text-xs sm:text-sm md:text-lg truncate">{title}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}
                        disabled={zoom <= 1}
                        aria-label="Zoom out"
                        className="hidden sm:block p-2 text-white/70 hover:text-white disabled:opacity-30"
                    >
                        <ZoomOut size={18} strokeWidth={1.5} />
                    </button>
                    <span className="hidden sm:inline font-mono text-[11px] text-white/50 w-10 text-center">
                        {Math.round(zoom * 100)}%
                    </span>
                    <button
                        onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
                        disabled={zoom >= 2.5}
                        aria-label="Zoom in"
                        className="hidden sm:block p-2 text-white/70 hover:text-white disabled:opacity-30"
                    >
                        <ZoomIn size={18} strokeWidth={1.5} />
                    </button>
                    <button
                        onClick={onClose}
                        data-testid="book-preview-close"
                        aria-label="Close preview"
                        className="p-2 text-white/70 hover:text-white ml-1"
                    >
                        <X size={20} strokeWidth={1.5} />
                    </button>
                </div>
            </div>

            {/* Page stage */}
            <div
                className="flex-1 min-h-0 relative flex items-center justify-center overflow-auto p-2 sm:p-4 md:p-8 select-none"
                onTouchStart={(e) => {
                    touchX.current = e.touches[0].clientX;
                }}
                onTouchEnd={(e) => {
                    if (touchX.current == null) return;
                    const dx = e.changedTouches[0].clientX - touchX.current;
                    if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1);
                    touchX.current = null;
                }}
            >
                <button
                    onClick={() => go(i - 1)}
                    disabled={i === 0}
                    aria-label="Previous page"
                    className="absolute left-1 sm:left-2 md:left-4 z-10 p-4 sm:p-3 bg-white/15 hover:bg-white/25 active:bg-white/30 text-white disabled:opacity-0 transition-opacity touch-manipulation"
                >
                    <ChevronLeft size={22} strokeWidth={1.5} />
                </button>

                {!loaded[i] && (
                    <div className="absolute font-mono text-xs text-white/40">Loading page…</div>
                )}
                <img
                    src={src(pages[i])}
                    alt={`${title} — page ${i + 1}`}
                    onLoad={() => setLoaded((l) => ({ ...l, [i]: true }))}
                    onContextMenu={block}
                    onDragStart={block}
                    draggable={false}
                    style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}
                    className={`max-h-full w-auto object-contain shadow-2xl transition-opacity duration-200 ${loaded[i] ? "opacity-100" : "opacity-0"}`}
                />

                <button
                    onClick={() => go(i + 1)}
                    disabled={i >= count - 1}
                    aria-label="Next page"
                    className="absolute right-1 sm:right-2 md:right-4 z-10 p-4 sm:p-3 bg-white/15 hover:bg-white/25 active:bg-white/30 text-white disabled:opacity-0 transition-opacity touch-manipulation"
                >
                    <ChevronRight size={22} strokeWidth={1.5} />
                </button>
            </div>

            {/* Footer: counter + thumbnails */}
            <div className="flex-shrink-0 border-t border-white/10 px-3 sm:px-4 md:px-8 py-2 sm:py-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center justify-between gap-4 sm:mb-3">
                    <div className="font-mono text-[11px] text-white/50">
                        Page {i + 1} of {count}
                        {totalPages && totalPages > count ? (
                            <span className="hidden sm:inline"> · sample of a {totalPages}-page extract</span>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-white/40">
                        <BookOpen size={12} strokeWidth={1.5} />
                        <span className="hidden md:inline">Use ← → to turn pages</span>
                        <span className="md:hidden">Swipe to turn pages</span>
                    </div>
                </div>
                <div ref={stripRef} className="hidden sm:flex gap-2 overflow-x-auto pb-1">
                    {pages.map((p, idx) => (
                        <button
                            key={idx}
                            data-thumb={idx}
                            onClick={() => go(idx)}
                            aria-label={`Go to page ${idx + 1}`}
                            className={`flex-shrink-0 w-10 h-14 overflow-hidden border transition-colors ${
                                idx === i ? "border-[#F59E0B]" : "border-white/20 hover:border-white/50"
                            }`}
                        >
                            <img
                                src={src(p)}
                                alt=""
                                loading="lazy"
                                onContextMenu={block}
                                draggable={false}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}
