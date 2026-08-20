import React, { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import BookPreview from "../components/BookPreview";
import Seo, { SITE } from "../components/Seo";
import NoIndex from "../components/NoIndex";
import EbookCta from "../components/EbookCta";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingBag, ArrowLeft, Star, GraduationCap, ChevronLeft, ChevronRight, BookOpen, Truck, PackageCheck, RotateCcw, ShieldCheck, BadgeCheck, ExternalLink } from "lucide-react";
import BookCard from "../components/BookCard";
import DeskCopyDialog from "../components/DeskCopyDialog";
import ReviewsSection from "../components/ReviewsSection";
import { fetchBook, fetchBooks, formatINR, notifyBackInStock, fetchSettings, mediaUrl,
    fetchBookPreview,
} from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import VerifyNotice from "../components/VerifyNotice";
import { hiddenSet } from "../lib/sections";
import { ebookEdition } from "../lib/ebook";
import { preorderState, useCountdown, formatLaunchDate } from "../lib/preorder";

// Trust badges under the price. Admin-managed via Settings key `pdp_badges`;
// this is only the fallback when nothing is saved yet. Spelled-out column
// classes so Tailwind's JIT keeps them.
const DEFAULT_PDP_BADGES = [
    { label: "Free Shipping", value: "On all orders", enabled: true },
    { label: "Delivery", value: "3–7 business days", enabled: true },
];

/**
 * An icon for a badge, chosen from its label.
 *
 * These badges are admin-managed: the label is free text, so the icon has to
 * be inferred rather than configured. Matching on keywords keeps "Delivery",
 * "Delivery time" and "Fast delivery" all pointing at the same mark.
 *
 * A LABEL THAT MATCHES NOTHING GETS NO ICON, deliberately. A generic fallback
 * — a dot, an info circle — would put a meaningless glyph beside copy nobody
 * here has read, and a wrong icon is worse than none: it tells the customer
 * something the words do not say. The badge simply renders as it does today.
 *
 * Truck is delivery, not shipping cost, so it matches the line under every
 * book card. Free shipping is a price promise and gets its own mark.
 */
const BADGE_ICONS = [
    [/return|refund|exchange/i, RotateCcw],
    [/secure|payment|safe|encrypt/i, ShieldCheck],
    [/authentic|genuine|original|publisher/i, BadgeCheck],
    [/ship/i, PackageCheck],
    [/deliver|dispatch|days/i, Truck],
];
const badgeIcon = (label) =>
    (BADGE_ICONS.find(([re]) => re.test(label || "")) || [])[1] || null;

export default function BookDetail() {
    const [preview, setPreview] = useState({ pages: [], page_count: 0 });
    const [previewOpen, setPreviewOpen] = useState(false);
    const { id } = useParams();
    const [book, setBook] = useState(null);
    const [related, setRelated] = useState([]);
    const relatedRef = useRef(null);
    const scrollRelated = (dir) => {
        const el = relatedRef.current;
        if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
    };
    const [qty, setQty] = useState(1);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState("description");
    const [deskCopyOpen, setDeskCopyOpen] = useState(false);
    // `site` for the eBook copy and toggles below — CartContext already fetches
    // site content once for the whole app, so this costs no extra request.
    const { addItem, setIsOpen, site } = useCart();
    const { user, isAuthenticated } = useAuth();
    const nav = useNavigate();
    const [notifyEmail, setNotifyEmail] = useState("");
    const [notifyBusy, setNotifyBusy] = useState(false);
    const [notified, setNotified] = useState(false);
    const [settings, setSettings] = useState(null);
    // Same hidden_sections setting every other page uses; the book page simply
    // was never listed in SECTION_REGISTRY.
    const hidden = hiddenSet(settings);
    const [binding, setBinding] = useState(null);
    const [size, setSize] = useState(null);

    useEffect(() => {
        setLoading(true);
        /*
         * The two requests have SEPARATE error handling, and that is the point.
         *
         * They used to share one .catch at the end of the chain, so a failure
         * fetching the RELATED books — a nice-to-have carousel at the bottom of
         * the page — ran `setBook(null)` and rendered "Book not found." for a
         * book that had loaded perfectly. One flaky secondary request told a
         * customer the product does not exist.
         *
         * Related books now fail to an empty array. Only the book's own request
         * can produce the not-found state.
         */
        fetchBook(id)
            .then((b) => {
                setBook(b);
                return fetchBooks({ category: b.category, limit: 20 }).catch(() => []);
            })
            .then((list) => setRelated(list.filter((x) => x.id !== id).slice(0, 12)))
            .catch(() => setBook(null))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => {
        fetchSettings().then(setSettings).catch(() => {});
    }, []);

    useEffect(() => {
        setPreview({ pages: [], page_count: 0 });
        fetchBookPreview(id)
            .then((p) => setPreview(p || { pages: [], page_count: 0 }))
            .catch(() => {});
    }, [id]);

    useEffect(() => {
        const vs = book && Array.isArray(book.variants) ? book.variants : [];
        if (vs.length) {
            setBinding(vs[0].binding || null);
            setSize(vs[0].size || null);
        } else {
            setBinding(settings?.binding_options?.[0] ?? null);
            setSize(settings?.size_options?.[0] ?? null);
        }
    }, [book, settings]);

    /*
     * Above the early returns on purpose.
     *
     * useCountdown is a hook, and the two `return`s below mean a hook placed
     * after them runs on some renders and not others — React counts hooks by
     * position, so the first load (still fetching) and the second (book in
     * hand) would disagree about how many there are. preorderState handles a
     * null book, so this is safe to read before the book exists.
     */
    const preorder = preorderState(book);
    const left = useCountdown(preorder.active ? preorder.at : null);

    if (loading) {
        return (
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-32 text-center text-sm font-mono text-[#4B5563]">
                Loading…
            </div>
        );
    }
    if (!book) {
        return (
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-32 text-center">
                {/* This branch had no title source at all, so a dead book URL
                    showed whatever title the previous page left behind and was
                    indexable. noindex also stops a mistyped or retired ID
                    accumulating in search results. */}
                <NoIndex title="Book not found" />
                <h1 className="font-serif text-4xl text-[#002B5C]">Book not found.</h1>
                <Link
                    to="/books"
                    className="mt-6 inline-flex border-b border-[#002B5C] text-sm pb-0.5"
                >
                    Back to bookstore
                </Link>
            </div>
        );
    }

    const discount = book.original_price
        ? Math.round(100 - (book.price / book.original_price) * 100)
        : 0;

    const variants = Array.isArray(book.variants) ? book.variants : [];
    const hasVariants = variants.length > 0;

    /* eBook edition — three conditions, read from two places. The store and the
       PDP mark are site-wide switches; ebook_url belongs to this title alone,
       and is what keeps the CTA off the 141 books that are not on the reader. */
    const ebookHref = (book?.ebook_url || "").trim();
    const ebookOnPdp =
        Boolean(ebookHref) &&
        String(site?.ebook_enabled ?? "on").toLowerCase() !== "off" &&
        String(site?.ebook_pdp_enabled ?? "on").toLowerCase() !== "off";
    const ebookTitle = site?.ebook_pdp_title || "Prefer to read it now?";
    const ebookBody = site?.ebook_pdp_body ?? "This title is available on the Oakbridge eReader.";
    const ebookButton = site?.ebook_pdp_button || "Read";
    /* The price pair. Null unless the price switch is on for this placement AND
       the title is linked — a price the customer cannot act on is worse than no
       price at all. Same helper the tiles use, so the two cannot disagree. */
    const ebookPrice = ebookEdition(book, site, "pdp").price;
    const printLabel = site?.ebook_price_print_label || "Book";
    const ebookPriceLabel = site?.ebook_price_ebook_label || "eBook";

    // Admin-managed trust badges; drop any hidden or empty ones.
    const pdpBadges = (Array.isArray(settings?.pdp_badges) ? settings.pdp_badges : DEFAULT_PDP_BADGES)
        .filter((b) => b && b.enabled !== false && (b.label || b.value));
    // Options: use the book's own matrix if present, else fall back to the
    // global Settings placeholders so PDPs always expose Binding/Size choices.
    // Binding/Size *selectors* appear ONLY for books with a real variant matrix
    // (admin-controlled per book). No global fallback — by default no slicing
    // selectors show. Plain binding/size specs are shown in the Specs tab instead.
    const bindings = hasVariants
        ? [...new Set(variants.map((v) => v.binding).filter(Boolean))]
        : [];
    const sizes = hasVariants
        ? [...new Set(variants.map((v) => v.size).filter(Boolean))]
        : [];
    const hasOptions = bindings.length > 0 || sizes.length > 0;
    const activeVariant = hasVariants
        ? variants.find((v) => v.binding === binding && v.size === size) || null
        : null;
    const activePrice =
        activeVariant && activeVariant.price != null ? Number(activeVariant.price) : book.price;
    const activeStock =
        activeVariant && Number.isFinite(activeVariant.stock)
            ? activeVariant.stock
            : Number.isFinite(book.stock)
              ? book.stock
              : 0;
    const chosenVariant = hasOptions
        ? { binding, size, price: activePrice, stock: activeStock }
        : null;

    const LOW_STOCK = 5;
    const stock = hasVariants ? activeStock : Number.isFinite(book.stock) ? book.stock : 0;
    const oos = stock <= 0 && !preorder.active;
    // Quantity is capped at stock everywhere below; a pre-order has none, so it
    // gets the same per-order limit the cart uses.
    const qtyCap = preorder.active ? 10 : stock;
    const low = !oos && stock <= LOW_STOCK;

    const seoDesc = (book.description || "").slice(0, 160);
    // Absolute, www-host cover URL. og:image and schema.org `image` are fetched
    // by machines that have no page to resolve a relative path against, so the
    // stored "/api/files/…" value is useless to them as-is.
    const coverAbs = mediaUrl(book.cover_image);
    const bookUrl = `${SITE}/books/${book.id}`;
    const bookLd = {
        "@context": "https://schema.org",
        "@type": "Book",
        name: book.title,
        ...(book.subtitle ? { alternateName: book.subtitle } : {}),
        author: { "@type": "Person", name: book.author },
        isbn: book.isbn,
        numberOfPages: book.pages,
        inLanguage: book.language,
        bookFormat: "https://schema.org/Hardcover",
        publisher: { "@type": "Organization", name: book.publisher },
        image: coverAbs,
        description: book.description,
        url: bookUrl,
        /*
         * NO `offers` BLOCK — deliberate, and the reason is prerendering.
         *
         * Prerendered HTML is frozen at build time, so anything in it is only as
         * current as the last deploy. Price and stock are exactly the fields
         * that change without a deploy, and they are the two an Offer exists to
         * state. A search result advertising a price we no longer charge is a
         * consumer-protection problem in India, not merely an SEO one, and
         * "InStock" on a sold-out title earns a cancelled order and a refund.
         *
         * Google simply shows no price rich-result without this, which is the
         * correct outcome: no claim beats a wrong claim. If price in search is
         * ever wanted, the fix is a rebuild hook on price changes, not putting
         * this block back.
         */
    };
    const crumbLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
            { "@type": "ListItem", position: 2, name: "Bookstore", item: `${SITE}/books` },
            { "@type": "ListItem", position: 3, name: book.title, item: bookUrl },
        ],
    };

    const onAdd = () => {
        addItem(book, qty, chosenVariant);
    };

    const submitNotify = async (e) => {
        e.preventDefault();
        const em = (notifyEmail || user?.email || "").trim();
        if (!em) return;
        setNotifyBusy(true);
        try {
            const res = await notifyBackInStock(book.id, em);
            setNotifyEmail(em);
            setNotified(true);
            toast.success(res?.message || "We'll email you when it's back in stock.");
        } catch (err) {
            toast.error("Could not register. Please try again.");
        } finally {
            setNotifyBusy(false);
        }
    };

    return (
        <div data-testid="book-detail-page">
            <Breadcrumbs items={[{ label: "Bookstore", to: "/books" }, { label: book.title }]} />
            <Seo
                title={book.title}
                description={seoDesc}
                path={`/books/${book.id}`}
                image={coverAbs}
                type="book"
                jsonLd={[bookLd, crumbLd]}
            />
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-10 pb-8">
                <Link
                    to="/books"
                    data-testid="back-to-catalog-link"
                    className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#4B5563] hover:text-[#002B5C]"
                >
                    <ArrowLeft size={12} strokeWidth={1.5} /> Back to catalogue
                </Link>
            </div>

            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 grid grid-cols-1 lg:grid-cols-12 gap-12 pb-20">
                {/* Cover */}
                <div className="lg:col-span-5">
                    <div className="sticky top-24 max-w-[300px] sm:max-w-[340px] lg:max-w-[380px] mx-auto lg:mx-0">
                        <div className="relative aspect-[2/3] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden shadow-sm group">
                            <img
                                src={mediaUrl(book.cover_image)}
                                alt={book.author ? `${book.title} — book cover, by ${book.author}` : `${book.title} — book cover`}
                                className="absolute inset-0 w-full h-full object-contain"
                            />
                            {book.bestseller && (
                                <span className="absolute top-4 left-4 bg-[#002B5C] text-[#FFFFFF] text-[10px] font-mono uppercase tracking-widest px-2 py-1">
                                    Bestseller
                                </span>
                            )}
                            {preview.page_count > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setPreviewOpen(true)}
                                    data-testid="look-inside-cover"
                                    aria-label="Look inside this book"
                                    className="absolute inset-0 flex items-end justify-center bg-[#002B5C]/0 hover:bg-[#002B5C]/20 transition-colors"
                                >
                                    <span className="mb-5 inline-flex items-center gap-2 bg-[#F59E0B] text-[#002B5C] text-[11px] font-mono uppercase tracking-widest px-4 py-2 shadow-lg translate-y-0 group-hover:-translate-y-1 transition-transform">
                                        <BookOpen size={13} strokeWidth={2} />
                                        Look inside
                                    </span>
                                </button>
                            )}
                        </div>
                        {preview.page_count > 0 && (
                            <button
                                type="button"
                                onClick={() => setPreviewOpen(true)}
                                data-testid="look-inside-button"
                                className="mt-4 w-full inline-flex items-center justify-center gap-2 border border-[#002B5C] text-[#002B5C] px-5 py-3 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                            >
                                <BookOpen size={15} strokeWidth={1.5} />
                                Look inside · {preview.page_count} pages
                            </button>
                        )}
                    </div>
                </div>

                {/* Details */}
                <div className="lg:col-span-7">
                    <div className="overline">{book.subject}</div>
                    <h1
                        data-testid="book-title"
                        className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-[1.05]"
                    >
                        {book.title}
                    </h1>
                    {book.subtitle && (
                        <p className="font-serif text-xl italic text-[#4B5563] mt-2">
                            {book.subtitle}
                        </p>
                    )}
                    <p className="mt-4 text-[#4B5563]">
                        by <span className="text-[#002B5C] font-medium">{book.author}</span>
                    </p>

                    <div className="mt-6 flex items-center gap-4">
                        <div className="flex items-center gap-1 text-[#F59E0B]">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                    key={`star-${i}`}
                                    size={14}
                                    strokeWidth={1.5}
                                    fill={i < Math.round(book.rating) ? "#F59E0B" : "none"}
                                />
                            ))}
                        </div>
                        <span className="text-xs text-[#4B5563] font-mono">
                            {book.rating.toFixed(1)} · ISBN {book.isbn}
                        </span>
                    </div>

                    {/* Format (Hardback / Paperback) from the Title Master. The
                        `hasOptions` block further down only renders for titles with
                        selectable variants, so without this a book's binding was
                        never surfaced outside the Specifications tab. */}
                    <div className="mt-4 flex items-center gap-3 flex-wrap">
                        {book.binding && (
                            <>
                                <span
                                    data-testid="book-binding-badge"
                                    className="inline-flex items-center gap-2 border border-[#002B5C]/20 bg-[#F5F7FA] px-3 py-1.5"
                                >
                                    <BookOpen size={14} strokeWidth={1.5} className="text-[#002B5C]" />
                                    <span className="font-mono text-[11px] uppercase tracking-widest text-[#002B5C]">
                                        {book.binding}
                                    </span>
                                </span>
                                {book.size && (
                                    <span className="font-mono text-[11px] text-[#4B5563]">
                                        {book.size}
                                    </span>
                                )}
                            </>
                        )}
                        {/* E-book platform link — renders only once ebook_url is set in admin. */}
                        <EbookCta variant="inline" />
                    </div>

                    {/*
                     * No reserved blank row here, unlike the tiles: a product
                     * page has one price block and nothing beside it to line up
                     * with, so the eBook line simply appears or doesn't.
                     */}
                    <div className="mt-8 pb-8 border-b border-[#E5E7EB]">
                        <div className="flex items-baseline gap-4">
                            {ebookPrice !== null && (
                                <span className="text-xs text-[#4B5563] w-11 flex-shrink-0">
                                    {printLabel}
                                </span>
                            )}
                            <span
                                data-testid="book-price"
                                className="font-serif text-5xl text-[#002B5C]"
                            >
                                {formatINR(activePrice)}
                            </span>
                            {book.original_price && (
                                <>
                                    <span className="text-[#4B5563] line-through">
                                        {formatINR(book.original_price)}
                                    </span>
                                    <span className="bg-[#CC0033] text-white text-xs font-mono px-2 py-1">
                                        Save {discount}%
                                    </span>
                                </>
                            )}
                        </div>
                        {ebookPrice !== null && (
                            <div className="mt-3 flex items-baseline gap-4">
                                <span className="text-xs text-[#4B5563] w-11 flex-shrink-0">
                                    {ebookPriceLabel}
                                </span>
                                <a
                                    href={ebookHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    data-testid="pdp-ebook-price"
                                    aria-label={`Read this title on the Oakbridge eReader — ${formatINR(ebookPrice)}`}
                                    className="font-serif text-2xl text-[#0A7D55] border-b border-[#0A7D55]/40 hover:text-[#002B5C] hover:border-[#002B5C] transition-colors inline-flex items-center gap-2"
                                >
                                    {formatINR(ebookPrice)}
                                    <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
                                </a>
                            </div>
                        )}
                    </div>

                    {hasOptions && (
                        <div className="mt-6 space-y-4">
                            {bindings.length > 0 && (
                                <div>
                                    <div className="overline !text-[10px] mb-2">Binding</div>
                                    <div className="flex flex-wrap gap-2">
                                        {bindings.map((b) => (
                                            <button
                                                key={b}
                                                type="button"
                                                onClick={() => setBinding(b)}
                                                className={`px-4 py-2 text-sm border transition-colors ${binding === b ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#E5E7EB] hover:border-[#002B5C]"}`}
                                            >
                                                {b}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {sizes.length > 0 && (
                                <div>
                                    <div className="overline !text-[10px] mb-2">Size</div>
                                    <div className="flex flex-wrap gap-2">
                                        {sizes.map((sz) => (
                                            <button
                                                key={sz}
                                                type="button"
                                                onClick={() => setSize(sz)}
                                                className={`px-4 py-2 text-sm border transition-colors ${size === sz ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#E5E7EB] hover:border-[#002B5C]"}`}
                                            >
                                                {sz}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {low && (
                        <div data-testid="low-stock-note" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#CC0033]">
                            <span className="inline-block w-2 h-2 rounded-full bg-[#CC0033]" />
                            Only {stock} left in stock — order soon
                        </div>
                    )}

                    {preorder.active && (
                        /*
                         * Sits between the price and the buy buttons, which is
                         * the one place a customer is already deciding. Above
                         * the price it would be decoration; below the buttons
                         * it would be an explanation nobody scrolled to.
                         */
                        <div
                            data-testid="preorder-panel"
                            className="mt-8 max-w-md border border-[#F59E0B]/45 bg-[#F59E0B]/[0.07] p-5"
                        >
                            <div className="font-mono uppercase tracking-[0.14em] text-[10px] text-[#854F0B]">
                                Publishes in
                            </div>
                            <div className="mt-3 flex gap-2.5" data-testid="preorder-countdown">
                                {[
                                    ["Days", left.days],
                                    ["Hrs", left.hours],
                                    ["Min", left.minutes],
                                    ["Sec", left.seconds],
                                ].map(([unit, value]) => (
                                    <div
                                        key={unit}
                                        className="flex-1 bg-white border border-[#F59E0B]/40 py-2.5 text-center"
                                    >
                                        <div className="font-serif text-2xl md:text-[26px] leading-none text-[#002B5C]">
                                            {String(value).padStart(2, "0")}
                                        </div>
                                        <div className="mt-1.5 font-mono uppercase tracking-[0.14em] text-[9px] text-[#854F0B]">
                                            {unit}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-3 text-xs text-[#4B5563] leading-relaxed">
                                Ships on {formatLaunchDate(preorder.at)}. Pre-order now and we
                                despatch on publication day — you are charged today.
                            </p>
                        </div>
                    )}

                    {oos ? (
                        <div data-testid="oos-panel" className="mt-8 border border-[#E5E7EB] bg-[#F5F7FA] p-6 max-w-md">
                            <div className="font-serif text-lg text-[#002B5C]">Currently out of stock</div>
                            {notified ? (
                                <p className="mt-2 text-sm text-[#4B5563]">
                                    ✓ Thanks — we'll email <span className="text-[#002B5C]">{notifyEmail}</span> the moment it's back.
                                </p>
                            ) : (
                                <>
                                    <p className="mt-2 text-sm text-[#4B5563]">
                                        Leave your email and we'll notify you the moment it's restocked.
                                    </p>
                                    <form onSubmit={submitNotify} className="mt-4 flex gap-2">
                                        <input
                                            type="email"
                                            required
                                            value={notifyEmail}
                                            onChange={(e) => setNotifyEmail(e.target.value)}
                                            placeholder="you@email.com"
                                            data-testid="notify-email-input"
                                            className="flex-1 border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                        />
                                        <button
                                            type="submit"
                                            disabled={notifyBusy}
                                            data-testid="notify-me-button"
                                            className="bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60 whitespace-nowrap"
                                        >
                                            {notifyBusy ? "…" : "Notify me"}
                                        </button>
                                    </form>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="mt-8 flex flex-wrap items-center gap-4">
                            <div className="flex items-center border border-[#E5E7EB] bg-white">
                                <button
                                    onClick={() => setQty(Math.max(1, qty - 1))}
                                    data-testid="qty-decrement"
                                    className="px-3 py-3 hover:bg-[#F5F7FA]"
                                    aria-label="Decrease"
                                >
                                    <Minus size={14} strokeWidth={1.5} />
                                </button>
                                <span className="px-6 font-mono min-w-[44px] text-center">
                                    {qty}
                                </span>
                                <button
                                    onClick={() => setQty(Math.min(qty + 1, qtyCap))}
                                    data-testid="qty-increment"
                                    disabled={qty >= qtyCap}
                                    className="px-3 py-3 hover:bg-[#F5F7FA] disabled:opacity-40"
                                    aria-label="Increase"
                                >
                                    <Plus size={14} strokeWidth={1.5} />
                                </button>
                            </div>
                            {/*
                             * A pre-order gets ONE button, and it goes straight
                             * to payment.
                             *
                             * Add to Cart beside it would offer a choice that
                             * does not exist: a reserved copy of an unprinted
                             * book is only reserved once it is paid for. Two
                             * buttons would also leave the softer one looking
                             * like the safe option, and a cart full of
                             * unpaid pre-orders reserves nothing for anybody.
                             */}
                            {!preorder.active && (
                                <button
                                    onClick={onAdd}
                                    data-testid="add-to-cart-main-button"
                                    className="inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-8 py-4 text-sm font-medium hover:bg-[#001F42] transition-all"
                                >
                                    <ShoppingBag size={16} strokeWidth={1.5} />
                                    Add to Cart
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    addItem(book, qty, chosenVariant);
                                    setIsOpen(false);
                                    if (isAuthenticated) {
                                        nav("/checkout");
                                    } else {
                                        toast.info("Please sign in to complete your purchase.");
                                        nav("/login", { state: { from: { pathname: "/checkout" } } });
                                    }
                                }}
                                data-testid={preorder.active ? "preorder-button" : "buy-now-button"}
                                className={
                                    preorder.active
                                        ? "inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-8 py-4 text-sm font-medium hover:bg-[#001F42] transition-all"
                                        : "inline-flex items-center gap-2 border border-[#002B5C] px-8 py-4 text-sm font-medium hover:bg-[#F5F7FA] transition-all"
                                }
                            >
                                {preorder.active && <ShoppingBag size={16} strokeWidth={1.5} />}
                                {preorder.active ? "Pre-order" : "Buy Now"}
                            </button>
                        </div>
                    )}

                    <VerifyNotice className="mt-6 max-w-md" />

                    {/* Educator CTA — hideable from Admin -> Pages -> Section
                        visibility. Desk copies are free stock; a press that is
                        not running the programme should not be advertising it on
                        every title. */}
                    {!hidden.has("book.desk_copy") && (
                    <button
                        onClick={() => setDeskCopyOpen(true)}
                        data-testid="request-desk-copy-button"
                        className="mt-6 group flex items-center gap-4 w-full text-left border border-[#F59E0B] bg-[#F59E0B]/10 p-4 hover:bg-[#F59E0B]/20 transition-colors"
                    >
                        <GraduationCap size={24} strokeWidth={1.5} className="text-[#CC0033]" />
                        <div className="flex-1">
                            <div className="font-serif text-base text-[#002B5C]">
                                Are you an educator? <span className="text-[#CC0033]">Request a free desk copy.</span>
                            </div>
                            <div className="text-xs text-[#4B5563] mt-0.5">
                                For teachers, professors and librarians evaluating this title for adoption.
                            </div>
                        </div>
                        <span className="font-mono text-xs uppercase tracking-widest text-[#CC0033] border-b border-[#CC0033] pb-0.5 group-hover:border-[#002B5C] group-hover:text-[#002B5C]">
                            Request →
                        </span>
                    </button>
                    )}

                    {/*
                     * The eBook edition, for titles that have one.
                     *
                     * Sits below Buy Now and above the trust badges: with the
                     * things a customer can DO, not the things they are told.
                     *
                     * Green, deliberately. Navy is the primary buy action and
                     * red means discount on every other surface — a third
                     * meaning needs a third colour or it competes with Add to
                     * Cart, which is the sale we would rather have.
                     *
                     * Every string is admin-owned (Admin → E-Books) and the
                     * whole block needs the store on, the PDP mark on, AND this
                     * title to carry its own ebook_url. Switching the feature on
                     * shows nothing until books are actually linked.
                     */}
                    {ebookOnPdp && (
                        <a
                            href={ebookHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="pdp-ebook-cta"
                            className="mt-6 group flex items-center gap-4 border border-[#0A7D55] bg-[#0A7D55]/[0.06] p-4 hover:bg-[#0A7D55]/[0.12] transition-colors"
                        >
                            <BookOpen size={22} strokeWidth={1.5} className="flex-shrink-0 text-[#0A7D55]" />
                            <div className="flex-1">
                                <div className="font-serif text-base text-[#002B5C]">
                                    {ebookTitle}
                                </div>
                                {ebookBody && (
                                    <div className="text-xs text-[#4B5563] mt-0.5">{ebookBody}</div>
                                )}
                            </div>
                            <span className="font-mono text-xs uppercase tracking-widest text-[#0A7D55] border-b border-[#0A7D55] pb-0.5 whitespace-nowrap group-hover:text-[#002B5C] group-hover:border-[#002B5C]">
                                {ebookButton} ↗
                            </span>
                        </a>
                    )}

                    {pdpBadges.length > 0 && (
                        /*
                         * Packed left, not spread across the column.
                         *
                         * These were a 2-column grid, so with two badges each
                         * took half the full width of the buy panel and
                         * "Delivery" was flung to the far right with a hand's
                         * width of nothing between them. They read as two
                         * unrelated facts rather than one shipping summary.
                         *
                         * flex-wrap keeps them adjacent and left-aligned at any
                         * count, and wraps to a second line on narrow screens
                         * instead of crushing the columns — which is what the
                         * grid was there to avoid in the first place.
                         */
                        <div
                            data-testid="pdp-badges"
                            className="mt-10 flex flex-wrap gap-x-12 gap-y-4 text-xs font-mono text-[#4B5563]"
                        >
                            {pdpBadges.map((b, i) => {
                                const Icon = badgeIcon(b.label);
                                return (
                                    <div key={i}>
                                        <div className="overline !text-[10px]">{b.label}</div>
                                        <div className="mt-1 flex items-center gap-2 text-[#002B5C]">
                                            {Icon && (
                                                <Icon
                                                    size={15}
                                                    strokeWidth={1.5}
                                                    className="flex-shrink-0 text-[#4B5563]"
                                                    aria-hidden="true"
                                                />
                                            )}
                                            <span>{b.value}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="mt-14 border-t border-[#E5E7EB] pt-10">
                        <div className="flex gap-8 border-b border-[#E5E7EB]">
                            {[
                                { v: "description", label: "Description" },
                                { v: "specs", label: "Specifications" },
                                { v: "author", label: "About the Author" },
                            ].map((t) => (
                                <button
                                    key={t.v}
                                    onClick={() => setTab(t.v)}
                                    data-testid={`tab-${t.v}`}
                                    className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.v ? "border-[#002B5C] text-[#002B5C]" : "border-transparent text-[#4B5563] hover:text-[#002B5C]"}`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <div className="py-8 text-[#4B5563] leading-relaxed">
                            {tab === "description" && (
                                <p className="text-base max-w-2xl">{book.description}</p>
                            )}
                            {tab === "specs" && (
                                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4 max-w-2xl">
                                    {[
                                        ["Publisher", book.publisher],
                                        ["Language", book.language],
                                        ["Pages", book.pages],
                                        ["Publication Year", book.publication_year],
                                        ["ISBN", book.isbn],
                                        ["Category", book.category],
                                        ["Subject", book.subject],
                                        // Size (trim name + dimensions, e.g. "Royal · 24 × 16 cm")
                                        // replaces the old Grade / Level row, which was empty for
                                        // every title in this catalogue.
                                        ["Size", book.size || "—"],
                                        ...(book.binding ? [["Binding", book.binding]] : []),
                                    ].map(([k, v]) => (
                                        <div
                                            key={k}
                                            className="flex justify-between border-b border-[#E5E7EB] py-2"
                                        >
                                            <dt className="overline !text-[10px]">{k}</dt>
                                            <dd className="font-mono text-xs text-[#002B5C]">
                                                {v}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                            {tab === "author" && (
                                <div className="max-w-2xl">
                                    <div className="flex items-start gap-6">
                                        {book.author_photo && (
                                            <img
                                                src={book.author_photo.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL}${book.author_photo}` : book.author_photo}
                                                alt={book.author}
                                                data-testid="book-author-photo"
                                                className="w-24 h-24 object-cover border border-[#E5E7EB] flex-shrink-0"
                                            />
                                        )}
                                        <div>
                                            <p
                                                data-testid="book-author-name"
                                                className="font-serif text-2xl text-[#002B5C]"
                                            >
                                                {book.author}
                                            </p>
                                            <p
                                                data-testid="book-author-bio"
                                                className="mt-3 text-sm whitespace-pre-line"
                                            >
                                                {book.author_bio ||
                                                    "A distinguished Oakbridge author with deep subject expertise and years of classroom experience. Every Oakbridge author is vetted by our editorial board for scholarship, clarity and cultural relevance."}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Reviews */}
                    <ReviewsSection bookId={book.id} />
                </div>
            </section>

            <DeskCopyDialog
                book={book}
                open={deskCopyOpen && !hidden.has("book.desk_copy")}
                onClose={() => setDeskCopyOpen(false)}
            />

            {/* Related */}
            {related.length > 0 && (
                <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 bg-[#F5F7FA] border-y border-[#E5E7EB]">
                    <div className="flex items-end justify-between mb-10 gap-4">
                        <div>
                            <div className="overline">Readers also explored</div>
                            <h2 className="font-serif text-3xl md:text-4xl mt-3 text-[#002B5C]">
                                More from this shelf
                            </h2>
                        </div>
                        {related.length > 2 && (
                            <div className="flex items-center gap-2 shrink-0">
                                <button type="button" onClick={() => scrollRelated(-1)} aria-label="Scroll left" data-testid="related-scroll-left" className="w-10 h-10 flex items-center justify-center border border-[#002B5C] text-[#002B5C] bg-white hover:bg-[#002B5C] hover:text-white transition-colors">
                                    <ChevronLeft size={18} strokeWidth={1.75} />
                                </button>
                                <button type="button" onClick={() => scrollRelated(1)} aria-label="Scroll right" data-testid="related-scroll-right" className="w-10 h-10 flex items-center justify-center border border-[#002B5C] text-[#002B5C] bg-white hover:bg-[#002B5C] hover:text-white transition-colors">
                                    <ChevronRight size={18} strokeWidth={1.75} />
                                </button>
                            </div>
                        )}
                    </div>
                    {/* pt-6 leaves room for a Star Title ribbon, which reaches
                        21px above a full-size tile. overflow-x-auto forces the
                        other axis to auto too, so without it a starred book's
                        ribbon is clipped here — same trap as the bestseller
                        marquee. */}
                    <div ref={relatedRef} className="flex gap-6 md:gap-8 overflow-x-auto scroll-smooth snap-x pt-6 pb-2 -mx-1 px-1">
                        {related.map((b, i) => (
                            <div key={b.id} className="flex-none w-[46%] sm:w-[30%] md:w-[23%] lg:w-[18.5%] snap-start">
                                <BookCard book={b} index={i} />
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <BookPreview
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                pages={preview.pages || []}
                title={book.title}
                totalPages={preview.total_pages}
            />
        </div>
          );
}
