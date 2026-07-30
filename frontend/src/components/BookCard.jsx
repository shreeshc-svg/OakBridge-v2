import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { formatINR, notifyBackInStock, mediaUrl } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";

const LOW_STOCK = 5;

export default function BookCard({ book, index = 0, compact = false }) {
    const { addItem } = useCart();
    const { user } = useAuth();
    const [notifyOpen, setNotifyOpen] = useState(false);
    const [notifyEmail, setNotifyEmail] = useState("");
    const [notifyBusy, setNotifyBusy] = useState(false);
    const [notified, setNotified] = useState(false);
    const [imgErr, setImgErr] = useState(false);
    const hasCover = book.cover_image && !imgErr;

    const stock = Number.isFinite(book.stock) ? book.stock : (book.stock ?? 0);
    const oos = stock <= 0;
    const low = !oos && stock <= LOW_STOCK;
    const discount = book.original_price
        ? Math.round(100 - (book.price / book.original_price) * 100)
        : 0;

    const submitNotify = async (e) => {
        e.preventDefault();
        const em = (notifyEmail || user?.email || "").trim();
        if (!em) return;
        setNotifyBusy(true);
        try {
            const res = await notifyBackInStock(book.id, em);
            setNotifyEmail(em);
            setNotified(true);
            toast.success(res?.message || "We'll email you when it's back.");
        } catch (err) {
            toast.error("Could not register. Please try again.");
        } finally {
            setNotifyBusy(false);
        }
    };

    return (
        /*
         * flex-col + h-full, with the price row pinned by mt-auto further down.
         *
         * The card used to be a plain block, so every element sat directly under
         * the one above it. A book with several authors — "Pramod Rao, Ritvik
         * Lukose & Balanand Menon" — wraps onto a second line, and that pushed
         * its price a line lower than every other price in the row. The
         * "Only N left" warning did the same thing to whichever cards happened
         * to be low on stock.
         *
         * Grid and flex rows already stretch their children to a common height,
         * so making the card fill that height and pushing the price to the
         * bottom aligns the prices no matter how much text sits above them. It
         * fixes the bookstore grid and every carousel at once, because they all
         * render this one component.
         */
        <div
            data-testid={`book-card-${book.id}`}
            className="group fade-up flex flex-col h-full"
            style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
        >
            <Link to={`/books/${book.id}`} className="block">
                <div className="relative aspect-[2/3] overflow-hidden bg-white border border-[#E5E7EB]">
                    {hasCover ? (
                        <img
                            src={mediaUrl(book.cover_image)}
                            /* Names the object AND the thing it depicts. "Legal
                               Aptitude & Reasoning" alone reads as though the
                               image were the book itself; a screen-reader user
                               scanning a grid of 24 gets the author too, which
                               is what they are usually choosing between. */
                            alt={book.author ? `${book.title} — book cover, by ${book.author}` : `${book.title} — book cover`}
                            onError={() => setImgErr(true)}
                            className={`absolute inset-0 w-full h-full object-contain book-tilt ${oos ? "opacity-40 grayscale" : ""}`}
                            loading="lazy"
                            decoding="async"
                        />
                    ) : (
                        <div className={`absolute inset-0 flex flex-col items-center justify-center text-center px-4 bg-[#F5F7FA] ${oos ? "opacity-40 grayscale" : ""}`}>
                            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#CC0033] mb-2">Oakbridge</span>
                            <span className="font-serif text-sm md:text-base text-[#002B5C] leading-snug">{book.title}</span>
                            {book.author && <span className="mt-2 text-[10px] text-[#4B5563]">{book.author}</span>}
                        </div>
                    )}
                    {oos && (
                        <span
                            data-testid={`oos-badge-${book.id}`}
                            className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-[#002B5C]/85 text-white text-center font-mono uppercase tracking-widest text-[11px] py-1.5"
                        >
                            Out of Stock
                        </span>
                    )}
                    {!oos && book.bestseller && (
                        <span className={`absolute top-2 left-2 bg-[#002B5C] text-[#FFFFFF] font-mono uppercase tracking-widest px-1.5 py-0.5 ${compact ? "text-[8px]" : "text-[10px] top-3 left-3 px-2 py-1"}`}>
                            Bestseller
                        </span>
                    )}
                    {!oos && book.new_release && !book.bestseller && (
                        <span className={`absolute top-2 left-2 bg-[#F59E0B] text-[#002B5C] font-mono uppercase tracking-widest px-1.5 py-0.5 ${compact ? "text-[8px]" : "text-[10px] top-3 left-3 px-2 py-1"}`}>
                            New Arrival
                        </span>
                    )}
                    {discount > 0 && (
                        <span className={`absolute top-2 right-2 bg-[#CC0033] text-white font-mono px-1.5 py-0.5 ${compact ? "text-[8px]" : "text-[10px] top-3 right-3 px-2 py-1"}`}>
                            -{discount}%
                        </span>
                    )}
                </div>
                <div className={compact ? "pt-2" : "pt-4"}>
                    <div className={`overline ${compact ? "!text-[9px]" : "!text-[10px]"}`}>{book.subject}</div>
                    <h3 className={`font-serif leading-tight text-[#002B5C] line-clamp-2 ${compact ? "text-sm mt-1 min-h-[2.4rem]" : "text-lg mt-2 min-h-[3rem]"}`}>
                        {book.title}
                    </h3>
                    {/* Three lines, not two. The alignment fix is mt-auto below —
                        clamping is only a cap on pathological cases, so it should
                        bite as rarely as possible. Two lines would have silently
                        hidden the third author on the many titles that have one,
                        and for a law and academic list co-authorship is the
                        credential a buyer is looking for. There is no tooltip
                        here on purpose: line-clamp hides text visually only, so
                        the full name is already in the DOM and read by screen
                        readers, and a title attribute on a <p> is unreachable by
                        keyboard and invisible on touch. */}
                    <p
                        className={`text-[#4B5563] line-clamp-3 ${compact ? "text-[11px] mt-0.5" : "text-xs mt-1"}`}
                    >
                        {book.author}
                    </p>
                </div>
            </Link>

            {/*
             * Everything below the cover is ONE mt-auto block, not three siblings.
             *
             * mt-auto absorbs whatever vertical slack the card has, which is what
             * pins the price to the bottom edge and aligns prices across a row.
             * But it absorbs the slack at whichever point it appears — so with
             * the price row alone pinned, expanding the notify form ate ~38px of
             * slack and dragged the price row (and the "Notify me" button the
             * visitor had just clicked) up out from under their cursor, and could
             * grow the grid row enough to slide every neighbouring card's price
             * down with it.
             *
             * Pinning the whole cluster means the form expands downward from a
             * fixed anchor, nothing above it moves, and the low-stock warning
             * stays attached to the price it qualifies instead of being stranded
             * against the author with white space beneath it.
             */}
            <div className="mt-auto">
                {low && (
                    <div data-testid={`low-stock-${book.id}`} className={`font-mono text-[#CC0033] ${compact ? "text-[10px] pt-1.5" : "text-[11px] pt-2"}`}>
                        Only {stock} left — order soon
                    </div>
                )}

                <div className={`flex items-end justify-between ${compact ? "pt-2" : "pt-3"}`}>
                <div className="flex items-baseline gap-2">
                    <span className={`font-serif text-[#002B5C] ${compact ? "text-base" : "text-xl"}`}>
                        {formatINR(book.price)}
                    </span>
                    {book.original_price && (
                        <span className={`text-[#4B5563] line-through ${compact ? "text-[10px]" : "text-xs"}`}>
                            {formatINR(book.original_price)}
                        </span>
                    )}
                </div>
                {oos ? (
                    notified ? (
                        <span className={`text-[#4B5563] ${compact ? "text-[10px]" : "text-xs"}`}>✓ We'll notify you</span>
                    ) : (
                        <button
                            onClick={() => setNotifyOpen((o) => !o)}
                            data-testid={`notify-toggle-${book.id}`}
                            className={`font-medium text-[#4B5563] border-b border-[#4B5563] hover:text-[#002B5C] hover:border-[#002B5C] transition-colors pb-0.5 ${compact ? "text-[10px]" : "text-xs"}`}
                        >
                            Notify me
                        </button>
                    )
                ) : (
                    <button
                        onClick={() => addItem(book)}
                        data-testid={`add-to-cart-${book.id}`}
                        className={`font-medium text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] transition-colors pb-0.5 ${compact ? "text-[10px]" : "text-xs"}`}
                    >
                        Add +
                    </button>
                )}
            </div>

                {oos && notifyOpen && !notified && (
                <form onSubmit={submitNotify} className="mt-2 flex gap-2">
                    <input
                        type="email"
                        required
                        value={notifyEmail}
                        onChange={(e) => setNotifyEmail(e.target.value)}
                        placeholder={user?.email || "you@email.com"}
                        data-testid={`notify-email-${book.id}`}
                        className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#002B5C]"
                    />
                    <button
                        type="submit"
                        disabled={notifyBusy}
                        className="bg-[#002B5C] text-white px-3 py-1.5 text-xs font-medium hover:bg-[#001F42] disabled:opacity-60 whitespace-nowrap"
                    >
                        {notifyBusy ? "…" : "Notify"}
                    </button>
                </form>
                )}
            </div>
        </div>
    );
}
