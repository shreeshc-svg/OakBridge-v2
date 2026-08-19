import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Star, Truck, BookOpen, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { formatINR, notifyBackInStock, mediaUrl } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { ebookEdition } from "../lib/ebook";

const LOW_STOCK = 5;

export default function BookCard({ book, index = 0, compact = false }) {
    const { addItem, settings, site } = useCart();
    /*
     * Read from the same admin setting the product page uses, not hardcoded.
     *
     * CartContext already fetches /settings once for tax and shipping, so this
     * costs no extra request — and it means changing the promise in Admin
     * changes it in both places. A second copy of "3-7 days" typed in here
     * would drift the day someone edited only one of them.
     *
     * Trimmed to "3-7 days": the PDP has room for "3-7 business days", a
     * 150px tile does not.
     */
    const deliveryFull = settings?.pdp_delivery || "3–7 business days";
    const deliveryShort = deliveryFull.replace(/\s*business\s*/i, " ").trim();
    /*
     * Admin → Settings can switch the tile line off without touching the
     * product page or the promise itself. Compared against false so an unset
     * key — and a failed /settings fetch — both leave it showing, which is how
     * every tile behaved before this switch existed.
     */
    const showDelivery = settings?.plp_delivery_enabled !== false;

    /*
     * The eBook mark needs three things to be true, and reads them from three
     * different places on purpose:
     *   - the store is on at all          (site content, Admin → E-Books)
     *   - the listing mark is on          (site content, same screen)
     *   - THIS title is on the eReader    (the book's own ebook_url)
     *
     * The last one is what stops every book in the catalogue sprouting an eBook
     * link the moment the feature is switched on. 110 titles are going onto the
     * reader out of 251.
     */
    const ebook = ebookEdition(book, site, "plp");
    const ebookUrl = ebook.url;
    const ebookOnPlp = ebook.linked;
    const ebookLabel = site?.ebook_plp_label || "eBook";
    /*
     * With a price to show, the price line IS the link — so the chip in the
     * delivery row would be a second link to the same place on a 150px tile.
     * One mention each, whichever is switched on.
     */
    const showEbookPrice = ebook.price !== null;
    const showEbookChip = ebookOnPlp && !showEbookPrice;
    const printLabel = site?.ebook_price_print_label || "Book";
    const ebookPriceLabel = site?.ebook_price_ebook_label || "eBook";
    const { user } = useAuth();
    const [notifyOpen, setNotifyOpen] = useState(false);
    const [notifyEmail, setNotifyEmail] = useState("");
    const [notifyBusy, setNotifyBusy] = useState(false);
    const [notified, setNotified] = useState(false);
    const [imgErr, setImgErr] = useState(false);
    const hasCover = book.cover_image && !imgErr;

    const stock = Number.isFinite(book.stock) ? book.stock : (book.stock ?? 0);
    const oos = stock <= 0;
    // Editor's pick. Ticked per book in Admin → Books; it drives no carousel and
    // no filter, it only dresses the tile.
    const starred = !!book.star_title;
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
            className={`group fade-up flex flex-col h-full ${starred ? "relative z-[1]" : ""}`}
            style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
        >
            {/*
             * THE FRAME ADDS NO LAYOUT. THAT IS THE WHOLE TRICK.
             *
             * Every grid this card lives in sizes its rows by the tallest tile
             * and lines the covers up across the row. Give a starred tile real
             * padding or a real border and its cover shrinks by those pixels,
             * so one gold book knocks its whole row out of alignment — on the
             * bookstore grid, the homepage, the author pages and the carousel
             * at once, because they all render this component.
             *
             * So the frame is absolutely positioned on negative insets: it
             * bleeds OUTWARD into the gutter and contributes nothing to the
             * box. Bleed is budgeted against the tightest grid on the site —
             * the homepage strip at gap-4 (16px) — which is why the compact
             * variant pulls in to 4px and shrinks the ribbon. Two starred books
             * side by side still leave 8px of air between their frames.
             *
             * The ribbon sits above the top edge and reaches 21px above a
             * full-size tile, 13.8px above a compact one, against vertical
             * gutters of 24px and 16px respectively — and against the pt- on
             * the bestseller marquee and the related-titles rail, both of which
             * clip and are padded to match. It fits everywhere, with a couple
             * of pixels to spare; if anyone tightens one of those five numbers,
             * this is what will collide.
             */}
            {starred && (
                /*
                 * -z-10 IS REQUIRED, not a tidy-up.
                 *
                 * Painting order is not DOM order. A positioned element paints
                 * in step 8 of the CSS algorithm, after non-positioned
                 * block-level content in step 4 — so this panel, absolutely
                 * positioned and declared first, still lands ON TOP of the
                 * title, author and price, which are static. The cover survives
                 * only because its own wrapper is relative. Filling the panel
                 * white without this would paint over half the card.
                 *
                 * A negative z-index moves it to step 3: above the card's own
                 * background, below everything in it. The root's `relative
                 * z-[1]` is what keeps that from escaping behind the section.
                 *
                 * Square corners, deliberately. Nothing else on this page is
                 * rounded — not the badges, not the cover, not the buttons — so
                 * a radius here read as a stray box rather than a frame.
                 */
                <div
                    className={`pointer-events-none absolute z-[-1] bg-white border-[1.5px] border-[#C79A3B] shadow-[0_0_0_1px_rgba(199,154,59,0.16),0_16px_38px_-18px_rgba(199,154,59,0.9)] ${compact ? "-inset-1" : "-inset-2"}`}
                >
                    {/* Deliberately not aria-hidden: "Star Title" is a fact
                        about the book, not decoration, and it is the only place
                        the distinction is stated in text. */}
                    <span
                        data-testid={`star-title-badge-${book.id}`}
                        /* -72%, not -50%: it rides mostly clear of the tile and
                           only tucks its last few pixels behind the frame line,
                           which reads as a nameplate rather than a sticker
                           dropped on the cover. That is 21px above a full-size
                           tile and 13.8px above a compact one — the numbers the
                           gutters and the two pt- values below are sized
                           against. Raising it further, or fattening its
                           padding, spends headroom that is already accounted
                           for. */
                        className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[72%] flex items-center gap-1.5 whitespace-nowrap bg-[#002B5C] text-[#E8C36B] font-mono uppercase ${compact ? "text-[8px] px-2 py-[2px] tracking-[0.14em]" : "text-[10px] px-3 py-[3px] tracking-[0.18em]"}`}
                    >
                        <Star size={compact ? 8 : 10} strokeWidth={0} fill="#E8C36B" />
                        Star Title
                    </span>
                </div>
            )}
            {/* shrink-0 is load-bearing, not tidiness.
             *
             * Making the card a flex column turned this into a flex item, and a
             * flex item shrinks by default. The row's height is set by its
             * tallest card, so on THAT card the children sum to exactly the
             * container — and the title reserves min-h-[3rem] (48px) while two
             * lines of text-lg/leading-tight measure 45px. The flex algorithm
             * reclaimed the difference from this block, and because the title is
             * a -webkit-box with overflow:hidden, the second line was clipped
             * mid-glyph instead of the box simply being smaller.
             *
             * Nothing in this card should ever shrink: the slack is absorbed by
             * mt-auto on the block below, as margin, not by squeezing content. */}
            <Link to={`/books/${book.id}`} className="block flex-shrink-0">
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
            <div className="mt-auto flex-shrink-0">
                {low && (
                    <div data-testid={`low-stock-${book.id}`} className={`font-mono text-[#CC0033] ${compact ? "text-[10px] pt-1.5" : "text-[11px] pt-2"}`}>
                        Only {stock} left — order soon
                    </div>
                )}

                <div className={`flex items-end justify-between ${compact ? "pt-2" : "pt-3"}`}>
                <div>
                    <div className="flex items-baseline gap-2">
                        {/*
                         * The "Book" label appears only alongside an eBook price.
                         * On its own it labels the only price on the card, which
                         * tells the reader nothing and costs 30px of a 150px tile.
                         */}
                        {ebook.pricingOn && (
                            <span
                                aria-hidden={!showEbookPrice}
                                className={`text-[#4B5563] w-[34px] flex-shrink-0 ${compact ? "text-[9px]" : "text-[10px]"} ${showEbookPrice ? "" : "invisible"}`}
                            >
                                {printLabel}
                            </span>
                        )}
                        <span className={`font-serif text-[#002B5C] ${compact ? "text-base" : "text-xl"}`}>
                            {formatINR(book.price)}
                        </span>
                        {book.original_price && (
                            <span className={`text-[#4B5563] line-through ${compact ? "text-[10px]" : "text-xs"}`}>
                                {formatINR(book.original_price)}
                            </span>
                        )}
                    </div>

                    {/*
                     * eBook price — the row is reserved on EVERY card once the
                     * feature is on, filled or not.
                     *
                     * This sits inside the mt-auto cluster, so a second line on
                     * only some cards would lift their print price above their
                     * neighbours' across the whole grid row. A blank line costs
                     * ~16px on the cards without an eBook; a missing one costs
                     * the alignment on every card in the row.
                     *
                     * A link, not a label, and outside the <Link> that wraps the
                     * cover and title so there is no anchor inside an anchor.
                     */}
                    {ebook.pricingOn && (
                        <div className={`flex items-baseline gap-2 ${compact ? "pt-0.5" : "pt-1"}`}>
                            {showEbookPrice ? (
                                <>
                                    <span
                                        className={`text-[#4B5563] w-[34px] flex-shrink-0 ${compact ? "text-[9px]" : "text-[10px]"}`}
                                    >
                                        {ebookPriceLabel}
                                    </span>
                                    <a
                                        href={ebookUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        data-testid={`ebook-price-${book.id}`}
                                        aria-label={`Read ${book.title} on the Oakbridge eReader — ${formatINR(ebook.price)}`}
                                        className={`font-serif text-[#0A7D55] border-b border-[#0A7D55]/40 hover:text-[#002B5C] hover:border-[#002B5C] transition-colors ${compact ? "text-xs" : "text-base"}`}
                                    >
                                        {formatINR(ebook.price)}
                                    </a>
                                    <ExternalLink
                                        size={compact ? 9 : 10}
                                        strokeWidth={1.5}
                                        aria-hidden="true"
                                        className="text-[#0A7D55] flex-shrink-0"
                                    />
                                </>
                            ) : (
                                <span aria-hidden="true" className={compact ? "text-xs" : "text-base"}>
                                    &nbsp;
                                </span>
                            )}
                        </div>
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

                {/*
                 * Delivery line — rendered on EVERY card, in stock or not.
                 *
                 * That is the alignment rule, not a detail. This sits inside the
                 * mt-auto cluster that pins the price row, so it is now the
                 * bottom-most element. Omit it on some cards and their price
                 * rides higher than their neighbours' — the exact misalignment
                 * the mt-auto block above exists to prevent.
                 *
                 * So an out-of-stock card keeps the space and hides the words.
                 * Promising delivery in 3-7 days on something we cannot ship
                 * would be worse than a gap, and `invisible` holds the height
                 * while aria-hidden keeps it out of the screen reader.
                 *
                 * The admin switch is different: it is global, so every card
                 * loses the words together and the line can genuinely go. But
                 * the eBook link below shares this row and only some titles
                 * carry one — so on the cards without one the row still has to
                 * exist, empty, or their price sits lower than their
                 * neighbours'. Hence the non-breaking space: one blank line,
                 * no reserved width, and nothing for a screen reader to read.
                 */}
                <div
                    className={`flex items-center gap-2 ${compact ? "pt-1.5 text-[10px]" : "pt-2 text-[11px]"}`}
                >
                    {showDelivery ? (
                        <span
                            aria-hidden={oos}
                            className={`flex items-center gap-1.5 text-[#4B5563] ${oos ? "invisible" : ""}`}
                        >
                            <Truck size={compact ? 11 : 12} strokeWidth={1.5} className="flex-shrink-0" />
                            {deliveryShort}
                        </span>
                    ) : (
                        !ebookOnPlp && <span aria-hidden="true">&nbsp;</span>
                    )}

                    {/*
                     * The eBook edition shares this row rather than taking one
                     * of its own — the row is the bottom-most element in the
                     * mt-auto block, so a second line on only some cards would
                     * push their price out of line with the rest of the row.
                     *
                     * It is a link, not a label: it sits outside the <Link> that
                     * wraps the cover and title, so there is no anchor inside an
                     * anchor. stopPropagation is unnecessary for the same
                     * reason.
                     *
                     * Shown only when this title has an ebook_url of its own, so
                     * turning the feature on reveals nothing until books are
                     * actually linked.
                     */}
                    {showEbookChip && (
                        <>
                            {/* Separator only when there is something on the
                                left to separate from — with the delivery line
                                switched off it would dangle in front of the
                                link. */}
                            {showDelivery && (
                                <span aria-hidden="true" className="text-[#D0D5DD]">
                                    ·
                                </span>
                            )}
                            <a
                                href={ebookUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`ebook-link-${book.id}`}
                                aria-label={`Read ${book.title} on the Oakbridge eReader`}
                                className="flex items-center gap-1.5 text-[#0A7D55] hover:text-[#002B5C] transition-colors"
                            >
                                <BookOpen
                                    size={compact ? 11 : 12}
                                    strokeWidth={1.5}
                                    className="flex-shrink-0"
                                />
                                <span className="border-b border-[#0A7D55]/40 pb-px">
                                    {ebookLabel}
                                </span>
                            </a>
                        </>
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
