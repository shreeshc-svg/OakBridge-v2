import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen, Check, Cloud, Highlighter, Search, ShoppingBag, Sparkles, Tablet, X } from "lucide-react";
import Seo from "../components/Seo";
import { fetchSiteContent, fetchCollection, resolveCollection, fetchBooks, fetchCategories, mediaUrl, formatINR } from "../lib/api";
import { metaDescription, breadcrumbLd } from "../lib/schema";
import { ebookEdition } from "../lib/ebook";
import { fold } from "../lib/bookSearch";
import { track } from "../lib/analytics";

/**
 * /ebooks — storefront-first redesign (Nov 2026).
 *
 * WHY STOREFRONT-FIRST
 *
 * The old page argued print vs screen with three animated drawings and showed
 * none of the 130+ titles that actually have an eBook — a visitor who had
 * already decided could not see what there was to read. Now the real covers
 * lead: a fanned stack in the hero, then the whole eBook shelf (search,
 * subject chips, sort), a three-step "how it works", and the print/eBook
 * comparison kept compact underneath for anyone still deciding.
 *
 * RULES CARRIED OVER (tests/test-ebooks-page.mjs)
 *
 *  * One master switch (`ebook_enabled`), read exactly as every other eBook
 *    surface reads it. Off -> no reader buttons anywhere on the page.
 *  * Per-title eBook links and prices come from lib/ebook.js `ebookEdition`
 *    (placement "plp"), so the admin's "show eBook prices on listings" switch
 *    and GST gross-up apply here exactly as on the bookstore cards.
 *  * No discount percentages in the copy. The "save ₹X" badge is worked out
 *    per title from that title's own print and eBook prices, and only shown
 *    when the eBook really is cheaper.
 *  * Every exit to the eReader is tracked (`ebook_cta_clicked`), because it is
 *    the last thing we can see before the visitor is on another site.
 *  * All headline copy stays editable in Admin → E-Books (eb_* keys).
 */

const DEFAULTS = {
    eyebrow: "Oakbridge · eBooks",
    headline: "One book.\nTwo ways to",
    accent: "read it.",
    body:
        "Every Oakbridge title is set for the page first. A growing number are set for the screen as well — the same text, the same edition, carried differently. Pick whichever suits how you actually read.",
    print_title: "Printed book",
    print_body: "Shipped to you, and yours afterwards.",
    ebook_title: "eBook",
    ebook_body: "Opens on the Oakbridge eReader, minutes after you buy it.",
    cta_kicker: "Not sure which?",
    cta_headline: "Every book's own page lists both prices side by side.",
    cloud_kicker: "Anywhere you read",
    cloud_tagline: "Oakbridge, now on the cloud.",
    cloud_body:
        "Buy the eBook once and your library, your highlights and your place in the book follow you — phone on the commute, laptop at the desk, tablet in chambers.",
};

const DEFAULT_PRINT = [
    { title: "Arrives in 3–7 days", text: "Tracked delivery across India" },
    { title: "Yours to keep", text: "Lend it, shelve it, pass it on" },
    { title: "Marked up in pen", text: "Margins, flags and sticky notes" },
    { title: "Never needs charging", text: "Reads in court, in class, on a train with no signal" },
    { title: "Discounted off MRP", text: "On every title in the bookstore" },
];

const DEFAULT_EBOOK = [
    { title: "Reading in minutes", text: "Nothing to deliver, nothing to wait for" },
    { title: "Search every word", text: "Find a section without going through the index" },
    { title: "Highlight and annotate", text: "Your notes stay with the book, on every device" },
    { title: "The whole shelf, carried", text: "Phone, tablet or laptop" },
    { title: "Usually the lower price", text: "Stated on each title's page" },
];

const EREADER_FALLBACK = "https://ebooks.oakbridge.in/";
const PAGE = 24;
const SORTS = { featured: "Featured", new: "Newest", low: "Price: low to high", high: "Price: high to low", title: "Title A–Z" };
const PAD = "px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40";

export default function Ebooks() {
    const [site, setSite] = useState({});
    const [printData, setPrintData] = useState(null);
    const [ebookData, setEbookData] = useState(null);
    const [books, setBooks] = useState(null);
    const [cats, setCats] = useState([]);
    const [q, setQ] = useState("");
    const [cat, setCat] = useState("all");
    const [sort, setSort] = useState("featured");
    const [shown, setShown] = useState(PAGE);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchCollection("page_eb_print").then(setPrintData).catch(() => {});
        fetchCollection("page_eb_ebook").then(setEbookData).catch(() => {});
        fetchBooks({ limit: 1000 }).then(setBooks).catch(() => setBooks([]));
        fetchCategories().then(setCats).catch(() => {});
    }, []);

    // The same master switch every other eBook surface reads, written the same
    // way on purpose — one switch turns off every eBook CTA on the site.
    const ebooksOn = String(site?.ebook_enabled ?? "on").toLowerCase() !== "off";
    const readerUrl = (site?.ebook_url ?? EREADER_FALLBACK).trim();
    const canGoToReader = ebooksOn && Boolean(readerUrl);

    const txt = (key) => site?.[`eb_${key}`] || DEFAULTS[key];
    const printPoints = resolveCollection(printData, DEFAULT_PRINT).filter((i) => i && i.title);
    const ebookPoints = resolveCollection(ebookData, DEFAULT_EBOOK).filter((i) => i && i.title);
    const catName = useMemo(() => Object.fromEntries((cats || []).map((c) => [c.id, c.name])), [cats]);

    // Only titles the eBook rules say may be shown as eBooks (linked, switch on).
    const shelf = useMemo(() => (books || [])
        .filter((b) => b.product_type !== "hamper" && b.enabled !== false)
        .map((b) => ({ b, ed: ebookEdition(b, site, "plp") }))
        .filter((x) => x.ed.linked), [books, site]);

    const chips = useMemo(() => {
        const n = {};
        shelf.forEach(({ b }) => { if (b.category) n[b.category] = (n[b.category] || 0) + 1; });
        return Object.entries(n).sort((a, b) => b[1] - a[1]);
    }, [shelf]);

    const list = useMemo(() => {
        const f = fold(q);
        let a = shelf.filter(({ b }) => (cat === "all" || b.category === cat)
            && (!f || fold(`${b.title} ${b.subtitle || ""} ${b.author || ""} ${b.isbn || ""} ${b.subject || ""}`).includes(f)));
        const price = (x) => x.ed.price ?? Number(x.b.price) ?? 0;
        if (sort === "new") a = [...a].sort((x, y) => (Number(y.b.publication_year) || 0) - (Number(x.b.publication_year) || 0));
        if (sort === "low") a = [...a].sort((x, y) => price(x) - price(y));
        if (sort === "high") a = [...a].sort((x, y) => price(y) - price(x));
        if (sort === "title") a = [...a].sort((x, y) => x.b.title.localeCompare(y.b.title));
        return a;
    }, [shelf, q, cat, sort]);

    useEffect(() => { setShown(PAGE); }, [q, cat, sort]);

    // Hero stack: five covers, bestsellers / new first.
    const hero = useMemo(() => [...shelf].filter(({ b }) => b.cover_image)
        .sort((x, y) => (y.b.bestseller ? 2 : 0) + (y.b.new_release ? 1 : 0) - ((x.b.bestseller ? 2 : 0) + (x.b.new_release ? 1 : 0)))
        .slice(0, 5), [shelf]);

    const onLeave = (placement, url, b) => track("ebook_cta_clicked", { placement, url, ...(b ? { book_id: b.id, title: b.title } : {}) });
    const toShelf = () => document.getElementById("ebook-shelf")?.scrollIntoView({ behavior: "smooth", block: "start" });

    return (
        <div data-testid="ebooks-page" className="flex flex-col">
            <Seo
                title="eBooks — Read Oakbridge Titles on Any Device"
                description={metaDescription(
                    "Oakbridge law, tax and academic titles in print and as eBooks. Browse every eBook, compare the two editions — delivery, annotation, search and price — then read on the Oakbridge eReader.",
                )}
                path="/ebooks"
                jsonLd={breadcrumbLd([{ name: "eBooks" }])}
            />
            <style>{`
                .eb-fan > a { transition: transform .5s cubic-bezier(.2,.8,.2,1), box-shadow .5s; }
                .eb-fan:hover > a { transform: var(--spread); }
                .eb-fan > a:hover { z-index: 20; box-shadow: 0 30px 60px -15px rgba(0,0,0,.6); }
                .eb-card .eb-cover { transition: transform .45s cubic-bezier(.2,.8,.2,1), box-shadow .45s; transform: perspective(900px) rotateY(0); }
                .eb-card:hover .eb-cover { transform: perspective(900px) rotateY(-8deg) translateY(-6px); box-shadow: 18px 22px 40px -18px rgba(0,43,92,.55); }
                @keyframes eb-float { from { transform: translateY(0) } to { transform: translateY(-8px) } }
                .eb-float { animation: eb-float 3s ease-in-out infinite alternate; }
                @media (prefers-reduced-motion: reduce) { .eb-float { animation: none } .eb-fan > a, .eb-card .eb-cover { transition: none } }
            `}</style>

            {/* ============== HERO ============== */}
            <section className="relative overflow-hidden text-white" style={{ background: "linear-gradient(135deg,#001A38 0%,#002B5C 45%,#0B4A8B 100%)" }}>
                <div aria-hidden="true" className="absolute inset-0 opacity-[0.18]"
                    style={{ background: "radial-gradient(circle at 15% 20%, #F59E0B 0%, transparent 40%), radial-gradient(circle at 85% 80%, #0A7D55 0%, transparent 45%)" }} />
                <div aria-hidden="true" className="absolute inset-0 opacity-[0.06]"
                    style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
                <div className={`relative ${PAD} py-16 md:py-24 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center max-w-[1500px] mx-auto w-full`}>
                    <div>
                        <div className="inline-flex items-center gap-2 bg-white/10 border border-white/15 px-3 py-1 text-xs tracking-[0.18em] uppercase text-[#F59E0B]">
                            <Sparkles size={13} />{txt("eyebrow")}
                        </div>
                        <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl mt-6 leading-[0.95] whitespace-pre-line fade-up" style={{ animationDelay: "80ms" }}>
                            {txt("headline")}{" "}
                            <em className="not-italic bg-gradient-to-r from-[#F59E0B] to-[#FCD34D] bg-clip-text text-transparent">{site?.eb_accent ?? DEFAULTS.accent}</em>
                        </h1>
                        <p className="text-base md:text-lg text-white/80 mt-6 max-w-xl leading-relaxed fade-up" style={{ animationDelay: "160ms" }}>{txt("body")}</p>

                        {ebooksOn && (
                            <form onSubmit={(e) => { e.preventDefault(); toShelf(); }} className="mt-8 flex max-w-xl bg-white shadow-2xl fade-up" style={{ animationDelay: "240ms" }} role="search">
                                <Search size={18} className="self-center ml-4 text-[#6B7280]" aria-hidden="true" />
                                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search eBooks by title, author or ISBN"
                                    aria-label="Search eBooks" className="flex-1 min-w-0 px-3 py-4 text-[#002B5C] text-sm focus:outline-none" data-testid="ebooks-search" />
                                <button type="submit" className="bg-[#F59E0B] text-[#001A38] px-5 text-sm font-semibold hover:bg-[#FBBF24] transition-colors">Find</button>
                            </form>
                        )}
                        <div className="mt-6 flex flex-wrap gap-3 items-center fade-up" style={{ animationDelay: "320ms" }}>
                            {shelf.length > 0 && (
                                <button type="button" onClick={toShelf} className="inline-flex items-center gap-2 bg-white text-[#002B5C] px-5 py-3 text-sm font-medium hover:bg-[#F5F7FA] transition-colors">
                                    <BookOpen size={15} />Browse {shelf.length} eBooks
                                </button>
                            )}
                            {canGoToReader ? (
                                <a href={readerUrl} target="_blank" rel="noopener noreferrer" onClick={() => onLeave("ebooks_page", readerUrl)} data-testid="ebooks-reader-link"
                                    className="inline-flex items-center gap-2 border border-white/40 text-white px-5 py-3 text-sm font-medium hover:bg-white/10 transition-colors">
                                    Open the eReader <ArrowUpRight size={14} strokeWidth={1.5} />
                                </a>
                            ) : (
                                /* Master switch off, or the destination was cleared in admin:
                                   say so rather than render a button that goes nowhere. */
                                <span data-testid="ebooks-reader-off" className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest text-white/70 border border-white/20 px-3 py-3">
                                    eReader opening soon
                                </span>
                            )}
                        </div>
                        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/70">
                            {["Phone, tablet or laptop", "Highlights sync everywhere", "Read in minutes"].map((t) => (
                                <li key={t} className="inline-flex items-center gap-1.5"><Check size={13} className="text-[#34D399]" />{t}</li>))}
                        </ul>
                    </div>

                    {/* Fanned stack of real covers — hover spreads them. */}
                    <div className="relative h-[340px] md:h-[420px] hidden sm:block" aria-hidden={hero.length === 0}>
                        <div aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-[#F59E0B]/20 blur-3xl" />
                        <div className="eb-fan eb-float absolute inset-0">
                            {hero.map(({ b }, i) => {
                                const mid = (hero.length - 1) / 2;
                                const o = i - mid;
                                const rest = `translate(-50%,-50%) translateX(${o * 56}px) translateY(${Math.abs(o) * 14}px) rotate(${o * 7}deg)`;
                                const spread = `translate(-50%,-50%) translateX(${o * 96}px) translateY(${Math.abs(o) * 22}px) rotate(${o * 10}deg)`;
                                return (
                                    <Link key={b.id} to={`/books/${b.id}`} title={b.title}
                                        className="absolute left-1/2 top-1/2 w-[150px] md:w-[180px] aspect-[2/3] bg-white shadow-[0_20px_40px_-12px_rgba(0,0,0,.55)] overflow-hidden"
                                        style={{ transform: rest, "--spread": spread, zIndex: 10 - Math.abs(Math.round(o)) }}>
                                        <img src={mediaUrl(b.cover_image)} alt={b.title} className="w-full h-full object-cover" loading="eager" />
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            {/* ============== HOW IT WORKS ============== */}
            <section className={`${PAD} py-14 md:py-16 bg-white border-b border-[#E5E7EB]`}>
                <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
                    {[
                        [ShoppingBag, "1", "Pick your book", "Choose any title below and buy it on the Oakbridge eReader."],
                        [Tablet, "2", "Open it in minutes", "Nothing to deliver — it's in your library straight away."],
                        [Cloud, "3", txt("cloud_tagline"), txt("cloud_body")],
                    ].map(([I, n, t, d]) => (
                        <div key={n} className="group relative bg-[#F8FAFC] border border-[#E5E7EB] p-6 transition-all hover:-translate-y-1 hover:shadow-lg hover:border-[#0A7D55]/40">
                            <span className="absolute top-4 right-5 font-serif text-5xl text-[#002B5C]/10 group-hover:text-[#0A7D55]/20 transition-colors">{n}</span>
                            <span className="w-11 h-11 grid place-items-center bg-[#0A7D55] text-white"><I size={20} /></span>
                            <h3 className="font-serif text-xl text-[#002B5C] mt-4 leading-snug">{t}</h3>
                            <p className="text-sm text-[#4B5563] mt-2 leading-relaxed">{d}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ============== THE SHELF ============== */}
            <section id="ebook-shelf" data-testid="ebooks-shelf" className={`${PAD} py-14 md:py-20 bg-[#F5F7FA] scroll-mt-20`}>
                <div className="max-w-[1400px] mx-auto">
                    <div className="flex flex-wrap items-end gap-4 justify-between">
                        <div>
                            <div className="overline">{txt("cloud_kicker")}</div>
                            <h2 className="font-serif text-3xl md:text-4xl text-[#002B5C] mt-1">The eBook shelf</h2>
                            <p className="text-sm text-[#4B5563] mt-1">{books === null ? "Loading titles…" : `${list.length} of ${shelf.length} titles`}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
                                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the shelf" aria-label="Search the eBook shelf"
                                    className="pl-9 pr-8 py-2.5 border border-[#E5E7EB] bg-white text-sm w-60 focus:outline-none focus:ring-2 focus:ring-[#0A7D55]/30" />
                                {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280]"><X size={14} /></button>}
                            </div>
                            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm">
                                {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                        </div>
                    </div>

                    {chips.length > 1 && (
                        <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Subjects">
                            {[["all", shelf.length], ...chips].map(([k, n]) => (
                                <button key={k} type="button" role="tab" aria-selected={cat === k} onClick={() => setCat(k)}
                                    className={`px-4 py-2 text-sm border transition-all ${cat === k ? "bg-[#002B5C] border-[#002B5C] text-white shadow-md" : "bg-white border-[#E5E7EB] text-[#002B5C] hover:border-[#002B5C]"}`}>
                                    {k === "all" ? "All" : catName[k] || k}<span className={`ml-1.5 text-xs ${cat === k ? "text-white/70" : "text-[#9CA3AF]"}`}>{n}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {!ebooksOn ? (
                        <p className="mt-10 bg-white border border-[#E5E7EB] p-8 text-center text-[#4B5563]">eBooks are coming soon. Meanwhile, every title is available in print in the <Link to="/books" className="underline">bookstore</Link>.</p>
                    ) : books === null ? (
                        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-5">
                            {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[2/3] bg-white/70 animate-pulse" />)}
                        </div>
                    ) : list.length === 0 ? (
                        <div className="mt-10 bg-white border border-[#E5E7EB] p-10 text-center">
                            <p className="text-[#4B5563]">No eBooks match “{q}”.</p>
                            <button type="button" onClick={() => { setQ(""); setCat("all"); }} className="mt-3 text-sm underline text-[#002B5C]">Show all eBooks</button>
                        </div>
                    ) : (
                        <>
                            <ul className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-x-5 gap-y-8">
                                {list.slice(0, shown).map(({ b, ed }) => <ShelfCard key={b.id} b={b} ed={ed} cat={catName[b.category]} onLeave={onLeave} />)}
                            </ul>
                            {shown < list.length && (
                                <div className="mt-10 text-center">
                                    <button type="button" onClick={() => setShown(shown + PAGE)} className="bg-white border border-[#002B5C] text-[#002B5C] px-6 py-3 text-sm font-medium hover:bg-[#002B5C] hover:text-white transition-colors">
                                        Show more ({list.length - shown} left)
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </section>

            {/* ============== PRINT vs eBOOK ============== */}
            <section data-testid="ebooks-compare" className={`${PAD} py-16 md:py-20 bg-white`}>
                <div className="max-w-6xl mx-auto">
                    <div className="text-center max-w-2xl mx-auto">
                        <div className="overline">{txt("cta_kicker")}</div>
                        <h2 className="font-serif text-3xl md:text-4xl text-[#002B5C] mt-2">Print or eBook?</h2>
                    </div>
                    <div className="mt-10 grid md:grid-cols-2 gap-6">
                        <Compare icon={BookOpen} tone="#CC0033" title={txt("print_title")} body={txt("print_body")} points={printPoints}
                            cta={<Link to="/books" data-testid="ebooks-browse-print" className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors">Browse the Bookstore <ArrowUpRight size={14} strokeWidth={1.5} /></Link>} />
                        <Compare icon={Highlighter} tone="#0A7D55" title={txt("ebook_title")} body={txt("ebook_body")} points={ebookPoints} featured
                            cta={canGoToReader ? (
                                <a href={readerUrl} target="_blank" rel="noopener noreferrer" onClick={() => onLeave("ebooks_compare", readerUrl)}
                                    className="inline-flex items-center gap-2 bg-[#0A7D55] text-white px-6 py-3 text-sm font-medium hover:bg-[#086645] transition-colors">Open the eReader <ArrowUpRight size={14} strokeWidth={1.5} /></a>
                            ) : <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest text-[#4B5563] border border-[#E5E7EB] px-3 py-3">eReader opening soon</span>} />
                    </div>
                </div>
            </section>

            {/* ============== CLOSING STRIP ============== */}
            <section className={`${PAD} py-14 text-white`} style={{ background: "linear-gradient(120deg,#002B5C 0%,#0B4A8B 100%)" }}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 max-w-6xl mx-auto">
                    <h2 className="font-serif text-2xl md:text-3xl max-w-2xl leading-tight">{txt("cta_headline")}</h2>
                    <Link to="/books" data-testid="ebooks-cta-books"
                        className="inline-flex items-center gap-2 bg-[#F59E0B] text-[#001A38] px-6 py-3 text-sm font-semibold hover:bg-[#FBBF24] transition-colors flex-shrink-0 self-start md:self-auto">
                        Browse all titles <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>
            </section>
        </div>
    );
}

/* One eBook on the shelf: cover with a 3D tilt on hover, prices from the
   title's own data, and the way out to the eReader. */
function ShelfCard({ b, ed, cat, onLeave }) {
    const print = Number(b.price) || null;
    const save = ed.price != null && print && ed.price < print ? print - ed.price : 0;
    return (
        <li className="eb-card group flex flex-col" data-testid="ebooks-card">
            <Link to={`/books/${b.id}`} className="relative block">
                <div className="eb-cover relative aspect-[2/3] bg-white border border-[#E5E7EB] overflow-hidden">
                    {b.cover_image ? <img src={mediaUrl(b.cover_image)} alt={b.title} loading="lazy" className="w-full h-full object-cover" />
                        : <div className="w-full h-full grid place-items-center p-3 text-center font-serif text-[#002B5C]">{b.title}</div>}
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-[#3D9970] text-white text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5"><Tablet size={10} />eBook</span>
                    {save > 0 && <span className="absolute bottom-2 left-2 bg-[#F59E0B] text-[#001A38] text-[11px] font-semibold px-2 py-0.5 shadow">Save {formatINR(save)} vs print</span>}
                </div>
            </Link>
            {/* Fixed slots (subject 1 line, title 2, author 1) and the button
                pinned to the bottom, so every CTA in a row lines up whatever
                the title length — a one-line title used to lift its button
                above its neighbours'. */}
            <div className="mt-3 flex-1 flex flex-col">
                <div className="text-[10px] uppercase tracking-[0.15em] text-[#9CA3AF] h-4 truncate">{cat || "\u00a0"}</div>
                <Link to={`/books/${b.id}`} title={b.title} className="font-serif text-[15px] text-[#002B5C] leading-snug mt-0.5 line-clamp-2 min-h-[2.75em] hover:underline">{b.title}</Link>
                <div className="text-xs text-[#6B7280] mt-0.5 h-4 truncate">{b.author || "\u00a0"}</div>
                <div className="mt-2 mb-3 flex items-baseline gap-2 text-sm h-6">
                    {ed.price != null && <span className="font-semibold text-[#3D9970]">{formatINR(ed.price)}</span>}
                    {print && <span className="text-xs text-[#9CA3AF]">Print {formatINR(print)}</span>}
                </div>
                {/* Same words and green as the eBook link on bookstore cards
                    (components/BookCard.jsx), as a full-width button here. */}
                <a href={ed.url} target="_blank" rel="noopener noreferrer" onClick={() => onLeave("ebooks_shelf", ed.url, b)}
                    data-testid={`ebooks-read-${b.id}`}
                    className="mt-auto inline-flex items-center justify-center gap-1.5 border border-[#3D9970] text-[#3D9970] h-10 text-xs font-semibold hover:bg-[#3D9970] hover:text-white transition-colors">
                    Read eBook <ArrowUpRight size={12} />
                </a>
            </div>
        </li>
    );
}

function Compare({ icon: I, tone, title, body, points, cta, featured = false }) {
    return (
        <div className={`relative p-7 border transition-shadow hover:shadow-xl ${featured ? "border-[#0A7D55]/40 bg-gradient-to-br from-[#ECFDF5] to-white" : "border-[#E5E7EB] bg-white"}`}>
            <div className="flex items-center gap-3">
                <span className="w-11 h-11 grid place-items-center text-white" style={{ background: tone }}><I size={20} strokeWidth={1.75} /></span>
                <div>
                    <h3 className="font-serif text-2xl text-[#002B5C]">{title}</h3>
                    <p className="text-sm text-[#4B5563]">{body}</p>
                </div>
            </div>
            <ul className="mt-6 space-y-3">
                {points.map((item, i) => (
                    <li key={item.id || i} className="flex gap-3">
                        <Check size={16} className="mt-0.5 shrink-0" style={{ color: tone }} />
                        <span><span className="text-[15px] font-medium text-[#002B5C]">{item.title}</span>
                            {item.text && <span className="block text-[13px] text-[#4B5563] leading-relaxed">{item.text}</span>}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-7">{cta}</div>
        </div>
    );
}
