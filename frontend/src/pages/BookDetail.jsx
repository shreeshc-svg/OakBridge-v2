import React, { useEffect, useState } from "react";
import Seo from "../components/Seo";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingBag, ArrowLeft, Star, GraduationCap } from "lucide-react";
import BookCard from "../components/BookCard";
import DeskCopyDialog from "../components/DeskCopyDialog";
import ReviewsSection from "../components/ReviewsSection";
import { fetchBook, fetchBooks, formatINR, notifyBackInStock } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

export default function BookDetail() {
    const { id } = useParams();
    const [book, setBook] = useState(null);
    const [related, setRelated] = useState([]);
    const [qty, setQty] = useState(1);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState("description");
    const [deskCopyOpen, setDeskCopyOpen] = useState(false);
    const { addItem, setIsOpen } = useCart();
    const { user, isAuthenticated } = useAuth();
    const nav = useNavigate();
    const [notifyEmail, setNotifyEmail] = useState("");
    const [notifyBusy, setNotifyBusy] = useState(false);
    const [notified, setNotified] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetchBook(id)
            .then((b) => {
                setBook(b);
                return fetchBooks({ category: b.category, limit: 8 });
            })
            .then((list) => setRelated(list.filter((x) => x.id !== id).slice(0, 4)))
            .catch(() => setBook(null))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) {
        return (
            <div className="px-6 md:px-12 lg:px-16 py-32 text-center text-sm font-mono text-[#4B5563]">
                Loading…
            </div>
        );
    }
    if (!book) {
        return (
            <div className="px-6 md:px-12 lg:px-16 py-32 text-center">
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

    const LOW_STOCK = 5;
    const stock = Number.isFinite(book.stock) ? book.stock : (book.stock ?? 0);
    const oos = stock <= 0;
    const low = !oos && stock <= LOW_STOCK;

    const seoDesc = (book.description || "").slice(0, 160);
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
        image: book.cover_image,
        description: book.description,
        offers: {
            "@type": "Offer",
            price: book.price,
            priceCurrency: "INR",
            availability: stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: `https://oakbridge.in/books/${book.id}`,
        },
    };
    const crumbLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://oakbridge.in/" },
            { "@type": "ListItem", position: 2, name: "Bookstore", item: "https://oakbridge.in/books" },
            { "@type": "ListItem", position: 3, name: book.title, item: `https://oakbridge.in/books/${book.id}` },
        ],
    };

    const onAdd = () => {
        addItem(book, qty);
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
            <Seo
                title={book.title}
                description={seoDesc}
                path={`/books/${book.id}`}
                image={book.cover_image}
                type="book"
                jsonLd={[bookLd, crumbLd]}
            />
            <div className="px-6 md:px-12 lg:px-16 pt-10 pb-8">
                <Link
                    to="/books"
                    data-testid="back-to-catalog-link"
                    className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#4B5563] hover:text-[#002B5C]"
                >
                    <ArrowLeft size={12} strokeWidth={1.5} /> Back to catalogue
                </Link>
            </div>

            <section className="px-6 md:px-12 lg:px-16 grid grid-cols-1 lg:grid-cols-12 gap-12 pb-20">
                {/* Cover */}
                <div className="lg:col-span-5">
                    <div className="sticky top-24">
                        <div className="relative aspect-[3/4] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                            <img
                                src={book.cover_image}
                                alt={book.title}
                                className="absolute inset-0 w-full h-full object-cover"
                            />
                            {book.bestseller && (
                                <span className="absolute top-4 left-4 bg-[#002B5C] text-[#FFFFFF] text-[10px] font-mono uppercase tracking-widest px-2 py-1">
                                    Bestseller
                                </span>
                            )}
                        </div>
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

                    <div className="mt-8 flex items-baseline gap-4 pb-8 border-b border-[#E5E7EB]">
                        <span
                            data-testid="book-price"
                            className="font-serif text-5xl text-[#002B5C]"
                        >
                            {formatINR(book.price)}
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

                    {low && (
                        <div data-testid="low-stock-note" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#CC0033]">
                            <span className="inline-block w-2 h-2 rounded-full bg-[#CC0033]" />
                            Only {stock} left in stock — order soon
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
                                    onClick={() => setQty(Math.min(qty + 1, stock))}
                                    data-testid="qty-increment"
                                    disabled={qty >= stock}
                                    className="px-3 py-3 hover:bg-[#F5F7FA] disabled:opacity-40"
                                    aria-label="Increase"
                                >
                                    <Plus size={14} strokeWidth={1.5} />
                                </button>
                            </div>
                            <button
                                onClick={onAdd}
                                data-testid="add-to-cart-main-button"
                                className="inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-8 py-4 text-sm font-medium hover:bg-[#001F42] transition-all"
                            >
                                <ShoppingBag size={16} strokeWidth={1.5} />
                                Add to Cart
                            </button>
                            <button
                                onClick={() => {
                                    addItem(book, qty);
                                    setIsOpen(false);
                                    if (isAuthenticated) {
                                        nav("/checkout");
                                    } else {
                                        toast.info("Please sign in to complete your purchase.");
                                        nav("/login", { state: { from: { pathname: "/checkout" } } });
                                    }
                                }}
                                data-testid="buy-now-button"
                                className="inline-flex items-center gap-2 border border-[#002B5C] px-8 py-4 text-sm font-medium hover:bg-[#F5F7FA] transition-all"
                            >
                                Buy Now
                            </button>
                        </div>
                    )}

                    {/* Educator CTA */}
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

                    <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono text-[#4B5563]">
                        <div>
                            <div className="overline !text-[10px]">Free Shipping</div>
                            <div className="mt-1 text-[#002B5C]">On ₹1500+</div>
                        </div>
                        <div>
                            <div className="overline !text-[10px]">Delivery</div>
                            <div className="mt-1 text-[#002B5C]">3-7 days</div>
                        </div>
                        <div>
                            <div className="overline !text-[10px]">Returns</div>
                            <div className="mt-1 text-[#002B5C]">14 days</div>
                        </div>
                        <div>
                            <div className="overline !text-[10px]">Invoice</div>
                            <div className="mt-1 text-[#002B5C]">GST included</div>
                        </div>
                    </div>

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
                                        ["Grade / Level", book.grade || "—"],
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
                open={deskCopyOpen}
                onClose={() => setDeskCopyOpen(false)}
            />

            {/* Related */}
            {related.length > 0 && (
                <section className="px-6 md:px-12 lg:px-16 py-20 bg-[#F5F7FA] border-y border-[#E5E7EB]">
                    <div className="overline">Readers also explored</div>
                    <h2 className="font-serif text-3xl md:text-4xl mt-3 mb-10 text-[#002B5C]">
                        More from this shelf
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-10">
                        {related.map((b, i) => (
                            <BookCard key={b.id} book={b} index={i} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
