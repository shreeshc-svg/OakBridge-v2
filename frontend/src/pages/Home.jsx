import React, { useEffect, useRef, useState } from "react";
import Seo from "../components/Seo";
import HamperBanner from "../components/HamperBanner";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen, GraduationCap, Building2, Calendar, Cpu, Briefcase, Users, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import BestsellerCarousel from "../components/BestsellerCarousel";
import BookRail from "../components/BookRail";
import {
    fetchBooks,
    fetchFeatured,
    fetchNewReleases,
    fetchBestsellers,
    fetchSiteContent,
    fetchSettings,
    fetchCollection,
    mediaUrl,
} from "../lib/api";
import { responsiveImage } from "../lib/img";
import { hiddenSet, resolveSectionOrder } from "../lib/sections";
import EbookCta from "../components/EbookCta";
import MarketingPopup from "../components/MarketingPopup";

// Default top-to-bottom order of the reorderable homepage sections. Admin can
// override via Admin → Pages → Section order & visibility (home_section_order).
const HOME_DEFAULT_ORDER = ["businesses", "gifting_banner", "imprints", "hot_off_press", "solutions", "bestsellers", "testimonials", "manifesto"];

// How many titles the "Hot Off the Press" rail will hold. The API is asked for
// the same number, so raising one without the other quietly does nothing.
const HOT_OFF_PRESS_MAX = 24;

// The five homepage "Imprint" tiles. Each is fully editable in Admin → Pages
// (name + image + link). Defaults below mirror what was live so nothing changes
// visually until an admin overrides a field. Image slots read site content;
// coffee_table/curated keep their original slot keys for backward-compat.
//
// Those two still point at the whole shop, not at ?category=coffee-table or
// ?category=bespoke. The categories now exist, but they have no titles yet, and
// the entire tile is a link -- so aiming it at its own category would land the
// visitor on an empty shelf, which is the one thing the bookstore's category row
// is careful never to do. When there is stock, point them at their categories
// from Admin -> Pages: `home_imprint_coffee_table_link` overrides this value
// without a deploy (see the `site[...] || imp.link` lookup below), and the
// Explore label unhides itself once the link is no longer the bare shop.
const IMPRINT_TILES = [
    { key: "academic", name: "Academic", link: "/books?category=academic", imgSlot: "home_imprint_academic_img", image: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=800&q=80" },
    { key: "professional", name: "Law & Tax", link: "/books?category=professional", imgSlot: "home_imprint_professional_img", image: "https://images.unsplash.com/photo-1589994965851-a8f479c573a9?auto=format&fit=crop&w=800&q=80" },
    { key: "bgr", name: "Business & General", link: "/books?category=bgr", imgSlot: "home_imprint_bgr_img", image: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=800&q=80" },
    { key: "coffee_table", name: "Coffee Table Books", link: "/books", imgSlot: "home_imprint_coffee_table", image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=800&q=80" },
    { key: "curated", name: "Bespoke and Curated Works", link: "/books", imgSlot: "home_imprint_curated", image: "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=800&q=80" },
];

const VERTICALS = [
    {
        id: "publishing",
        num: "01",
        icon: BookOpen,
        title: "Publishing",
        tagline: "Scholarly & professional books",
        lede: "Authoritative titles across Academic, Professional, General, Coffee Table and Bespoke Works programmes.",
        to: "/books",
        cta: "Browse bookstore",
    },
    {
        id: "events",
        num: "02",
        icon: Calendar,
        title: "Events",
        tagline: "Seminars and conferences",
        lede: "India Legal Tech & AI Summit, Vidhi Utsav, book launches and roundtables with scholars and policymakers.",
        to: "/what-we-do#events",
        cta: "Upcoming events",
    },
    {
        id: "digital-solutions",
        num: "03",
        icon: Cpu,
        title: "Digital Solutions",
        tagline: "AI-powered knowledge products",
        lede: "Semantic search, research copilots and licensed APIs built on our scholarly content for law firms, universities and Corporate & Judiciary.",
        to: "/digital-solutions",
        cta: "Get early access",
        comingSoon: true,
    },
    {
        id: "training",
        num: "04",
        icon: GraduationCap,
        title: "Training & Certification",
        tagline: "Training programmes for practitioners",
        lede: "Certification tracks and in-house workshops in Law, Tax and Corporate Governance — delivered by our authors and Subject Matter experts.",
        to: "/academy",
        cta: "Get early access",
        comingSoon: true,
    },
];

// Renders admin copy where *text* becomes the red accent, and \n a line break.
function renderRich(text) {
    return String(text || "")
        .split(/(\*[^*]+\*)/g)
        .map((p, i) =>
            p.length > 2 && p.startsWith("*") && p.endsWith("*") ? (
                <em key={i} className="text-[#CC0033] not-italic">{p.slice(1, -1)}</em>
            ) : (
                <React.Fragment key={i}>{p}</React.Fragment>
            ),
        );
}

// Auto-rotating testimonials carousel. Advances one card per tick, loops at the
// end, pauses on hover/touch. Arrows for manual control.
function TestimonialsCarousel({ items, overline, title }) {
    const railRef = useRef(null);

    const scroll = (dir) => {
        const el = railRef.current;
        if (!el) return;
        const first = el.children[0];
        const step = first ? first.getBoundingClientRect().width + 24 : el.clientWidth * 0.8;
        el.scrollBy({ left: dir * step, behavior: "smooth" });
    };

    useEffect(() => {
        const el = railRef.current;
        if (!el || items.length <= 1) return undefined;
        let paused = false;
        const pause = () => { paused = true; };
        const resume = () => { paused = false; };
        el.addEventListener("mouseenter", pause);
        el.addEventListener("mouseleave", resume);
        el.addEventListener("touchstart", pause, { passive: true });
        const iv = setInterval(() => {
            if (paused) return;
            const first = el.children[0];
            const step = first ? first.getBoundingClientRect().width + 24 : el.clientWidth * 0.8;
            const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
            el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: "smooth" });
        }, 5000);
        return () => {
            clearInterval(iv);
            el.removeEventListener("mouseenter", pause);
            el.removeEventListener("mouseleave", resume);
            el.removeEventListener("touchstart", pause);
        };
    }, [items.length]);

    return (
        <section data-testid="testimonials" className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-12 md:py-28 bg-[#F5F7FA] border-y border-[#E5E7EB]">
            <div className="flex items-end justify-between gap-4 mb-6 md:mb-10">
                <div className="max-w-2xl">
                    <div className="overline">{overline || "Testimonials"}</div>
                    <h2 className="font-serif text-3xl md:text-5xl mt-2 md:mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
                        {renderRich(title || "Trusted by the people we publish for.")}
                    </h2>
                </div>
                <div className="hidden md:flex items-center gap-2">
                    <button onClick={() => scroll(-1)} aria-label="Previous" className="p-2 border border-[#E5E7EB] bg-white hover:border-[#002B5C] transition-colors">
                        <ChevronLeft size={16} strokeWidth={1.5} />
                    </button>
                    <button onClick={() => scroll(1)} aria-label="Next" className="p-2 border border-[#E5E7EB] bg-white hover:border-[#002B5C] transition-colors">
                        <ChevronRight size={16} strokeWidth={1.5} />
                    </button>
                </div>
            </div>
            <div
                ref={railRef}
                className="flex gap-6 overflow-x-auto snap-x scroll-smooth pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {items.map((t, i) => (
                    <figure
                        key={t.id || i}
                        data-testid={`testimonial-${i}`}
                        className="snap-start flex-shrink-0 w-[85%] sm:w-[46%] lg:w-[31%] bg-white border border-[#E5E7EB] p-7 flex flex-col"
                    >
                        <div className="font-serif text-5xl text-[#F59E0B] leading-none">“</div>
                        <blockquote className="mt-2 flex-1 text-[#002B5C] leading-relaxed">{t.quote}</blockquote>
                        <figcaption className="mt-6 pt-4 border-t border-[#E5E7EB]">
                            <div className="font-medium text-[#002B5C] text-sm">{t.name}</div>
                            {t.role && <div className="text-xs font-mono uppercase tracking-widest text-[#4B5563] mt-1">{t.role}</div>}
                        </figcaption>
                    </figure>
                ))}
            </div>
        </section>
    );
}

export default function Home() {
    const [featured, setFeatured] = useState([]);
    const [newRel, setNewRel] = useState([]);
    const [fallback, setFallback] = useState([]);
    const [bestsellers, setBestsellers] = useState([]);
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState(null);
    const [testimonials, setTestimonials] = useState([]);
    /*
     * Which business descriptions are expanded, on mobile only.
     *
     * Per card rather than one-at-a-time: these are four parallel things a
     * visitor may want to compare, and closing one to read another turns a
     * comparison into a memory test. Nothing here is persisted — an expander
     * is a reading position, not a preference.
     */
    const [openBiz, setOpenBiz] = useState({});

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchFeatured().then(setFeatured).catch(() => {});
        fetchNewReleases(HOT_OFF_PRESS_MAX).then(setNewRel).catch(() => {});
        fetchBestsellers(12).then(setBestsellers).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
        fetchCollection("home_testimonials").then((d) => setTestimonials((d?.items || []).filter((t) => t && t.enabled !== false && t.quote))).catch(() => {});
        // Fallback feed in case bestseller / new-release flags are sparse (also the pool for the curated carousel)
        fetchBooks({ sort: "featured", limit: 100 }).then(setFallback).catch(() => {});
    }, []);

    // "What leaders are reading" shows ONLY the books the admin has explicitly
    // selected (home_bestsellers), in the admin's order — never the whole catalogue.
    // If nothing is selected (or the carousel is disabled), it doesn't render.
    const carouselBooks = (() => {
        const ids = Array.isArray(settings?.home_bestsellers) ? settings.home_bestsellers : [];
        if (!ids.length) return [];
        const pool = new Map(
            [...bestsellers, ...featured, ...newRel, ...fallback].map((b) => [b.id, b]),
        );
        return ids.map((id) => pool.get(id)).filter(Boolean);
    })();
    const bestsellersEnabled = settings?.home_bestsellers_enabled !== false; // default on
    const bestsellersSpeed = Number(settings?.home_bestsellers_speed) || 40; // px/sec
    const hidden = hiddenSet(settings); // admin section show/hide
    const homeOrder = resolveSectionOrder(HOME_DEFAULT_ORDER, settings?.home_section_order);
    const homeOrd = (k) => { const i = homeOrder.indexOf(k); return i === -1 ? 99 : i; };

    // "Hot Off the Press" = strictly the most recently PUBLISHED titles, in
    // publication-date order (the API sorts by release_rank, rank 1 = newest).
    //
    // This used to compose new releases + featured + any-other-book, minus a
    // hidden "bestsellerRow" that was itself built from the newest titles. With
    // almost no book carrying the `bestseller` flag, that row silently swallowed
    // the 5 newest titles and the carousel began at rank 6. No dedup, no
    // backfill: the row now shows exactly what the catalogue says is newest.
    // Was capped at 7 — exactly one desktop row of the old grid. Now that the
    // row scrolls, the cap is only there to stop a very large catalogue putting
    // hundreds of cards and their covers into the DOM for a section nobody
    // scrolls to the end of.
    const newReleasesRow = (newRel.length ? newRel : fallback).slice(0, HOT_OFF_PRESS_MAX);

    return (
        <div data-testid="home-page" className="flex flex-col">
            {/* Homepage only, by design: an overlay on every route would meet
                people mid-task — on a product page, or in the middle of
                checkout. It renders nothing unless an admin has switched it on
                and saved a creative. */}
            <MarketingPopup site={site} />
            <Seo
                /* Kept inside Google's limits on purpose.
                 *
                 * Seo appends " · Oakbridge Publishing" (22 chars), and Google
                 * cuts the title around 60 and the description around 155. The
                 * previous title measured exactly 60 and showed as "… ·
                 * Oakbridge …"; the description ran to 231, so the whole of
                 * "AI-powered digital solutions for students, professionals and
                 * institutions" — the newest part of the business — never
                 * reached a single search result. Anything added here should be
                 * measured, not eyeballed. */
                title="Law, Tax & Academic Books"
                description="Independent Indian publisher of authoritative law, tax, business and academic titles — with events, training and AI-powered research tools."
                path="/"
            />
            {/* ============== HERO ============== */}
            <section style={{ order: -1 }} className="relative overflow-hidden border-b border-[#002B5C]/10">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                    <div className="lg:col-span-7 px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-12 pb-12 lg:pt-32 lg:pb-36 relative">
                        <div className="overline fade-up">
                            {site.home_hero_overline || "Est. 2017 · A Scholarly Press"}
                        </div>
                        <h1 className="font-serif text-[2.6rem] sm:text-6xl lg:text-7xl leading-[0.98] sm:leading-[0.95] mt-4 sm:mt-6 text-[#002B5C] whitespace-pre-line fade-up" style={{ animationDelay: "100ms" }}>
                            {renderRich(site.home_hero_title || "A library for\nthe *intellectually*\nrestless.")}
                        </h1>
                        <p className="mt-5 sm:mt-8 max-w-lg text-base text-[#4B5563] leading-relaxed whitespace-pre-line fade-up" style={{ animationDelay: "200ms" }}>
                            {site.home_hero_body ||
                                "Oakbridge produces authoritative, reliable and opinion-influencing reference titles, legal commentaries, thematic books across various genres, and thought-leadership curated works for students, professionals and curious minds across the globe."}
                        </p>
                        <div className="mt-6 sm:mt-10 flex flex-wrap gap-3 sm:gap-4 fade-up" style={{ animationDelay: "300ms" }}>
                            <Link
                                to="/books"
                                data-testid="hero-browse-books-link"
                                className="inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-7 py-4 text-sm font-medium hover:bg-[#001F42] transition-all"
                            >
                                Browse the Bookstore
                                <ArrowUpRight size={16} strokeWidth={1.5} />
                            </Link>
                            <Link
                                to="/what-we-do"
                                data-testid="hero-solutions-link"
                                className="inline-flex items-center gap-2 border border-[#002B5C] px-7 py-4 text-sm font-medium hover:bg-[#F5F7FA] transition-all"
                            >
                                What We Do
                            </Link>
                        </div>

                        <div className="mt-20 grid grid-cols-3 gap-8 max-w-xl pt-8 border-t border-[#002B5C]/15">
                            <div>
                                <div className="font-serif text-3xl text-[#002B5C]">
                                    {site.home_stat1_value || "230+"}
                                </div>
                                <div className="overline mt-1 !text-[10px]">
                                    {site.home_stat1_label || "Titles in print"}
                                </div>
                            </div>
                            <div>
                                <div className="font-serif text-3xl text-[#002B5C]">
                                    {site.home_stat2_value || "320K"}
                                </div>
                                <div className="overline mt-1 !text-[10px]">
                                    {site.home_stat2_label || "Students served"}
                                </div>
                            </div>
                            <div>
                                <div className="font-serif text-3xl text-[#002B5C]">
                                    {site.home_stat3_value || "Global"}
                                </div>
                                <div className="overline mt-1 !text-[10px]">
                                    {site.home_stat3_label || "Reach"}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 420px of decorative photograph was a third of a phone
                        screen and, since the density pass pulled it up the
                        page, the largest thing in the first viewport — which
                        makes it the LCP. Smaller box, smaller file, sooner. */}
                    <div className="lg:col-span-5 relative min-h-[260px] sm:min-h-[420px] lg:min-h-[720px] bg-[#002B5C]">
                        <img
                            {...responsiveImage(
                                mediaUrl(site.home_hero) ||
                                    "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85",
                                /*
                                 * Under-declared on purpose below the split.
                                 *
                                 * A phone at DPR 2.6 asking for 100vw makes the
                                 * browser fetch the 1200px candidate for a
                                 * 390px-wide box — for a photograph behind a
                                 * gradient, on the slowest connection any of
                                 * our visitors are on, as the LCP. 60vw picks
                                 * the 800px file instead. Desktop is unaffected:
                                 * the first clause still describes its box
                                 * exactly.
                                 */
                                "(min-width: 1024px) 42vw, 60vw",
                                true,
                            )}
                            /* Decorative: a mood image behind a gradient, with the
                               headline beside it carrying the actual meaning. An
                               empty alt is the correct answer — a screen reader
                               should skip it, not read a caption. It was also
                               hardcoded while the image is admin-replaceable, so
                               the description became a lie the moment anyone
                               uploaded a different banner. */
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#002B5C]/95 via-[#002B5C]/30 to-transparent" />
                        <div className="absolute top-6 right-6 bg-[#CC0033] text-white font-mono uppercase tracking-widest text-[10px] px-3 py-1.5">
                            Spring 2026 catalogue
                        </div>
                        <div className="absolute bottom-8 left-8 right-8 text-[#FFFFFF]">
                            <div className="overline !text-white/60">
                                Featured Publication
                            </div>
                            <div className="font-serif text-2xl mt-2 leading-tight">
                                "A publisher's job is to ask the question the
                                classroom has not yet thought of."
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* E-book platform band. No `order` style, so it ties with the hero at 0
                and DOM order keeps it directly beneath — visible immediately without
                displacing the admin-managed section ordering below. Hidden until an
                `ebook_url` is set in admin. */}
            <EbookCta variant="banner" site={site} />

            {/* ============== BUSINESS VERTICALS (prominent, directly after hero) ============== */}
            {!hidden.has("home.businesses") && (
            <section
                data-testid="home-verticals"
                style={{ order: homeOrd("businesses") }}
                className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-12 md:py-24 border-b border-[#E5E7EB]"
            >
                <div className="flex flex-wrap items-end justify-between gap-3 md:gap-4 mb-7 md:mb-12">
                    <div>
                        <div className="overline">{site.home_biz_overline || "Our Businesses"}</div>
                        <h2 className="font-serif text-3xl md:text-5xl mt-2 md:mt-3 text-[#002B5C] max-w-2xl leading-tight whitespace-pre-line">
                            {renderRich(site.home_biz_title || "Four complementary lines of business.")}
                        </h2>
                    </div>
                    <Link
                        to="/what-we-do"
                        data-testid="verticals-view-all"
                        className="inline-flex items-center gap-1 text-sm font-medium border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033] transition-colors"
                    >
                        Learn more about what we do <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
                    {VERTICALS.map((v, i) => {
                        const n = i + 1;
                        const tagline = site[`home_biz${n}_tagline`] || v.tagline;
                        const title = site[`home_biz${n}_title`] || v.title;
                        const lede = site[`home_biz${n}_lede`] || v.lede;
                        const cta = site[`home_biz${n}_cta`] || v.cta;
                        const open = !!openBiz[v.id];
                        return (
                        <article
                            key={v.id}
                            data-testid={`home-vertical-${v.id}`}
                            className="group relative bg-white border border-[#E5E7EB] p-4 pt-5 md:p-8 md:pt-9 flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[#002B5C] hover:shadow-[0_24px_48px_-20px_rgba(0,43,92,0.25)] focus-within:border-[#002B5C] fade-up"
                            style={{ animationDelay: `${i * 80}ms` }}
                        >
                            {/* Top accent bar — red, scales on hover */}
                            <span
                                aria-hidden="true"
                                className="absolute top-0 left-0 h-[3px] w-12 bg-[#CC0033] transition-all duration-500 ease-out group-hover:w-full"
                            />

                            {/* Watermark numeral. Scaled down on mobile: at 64px
                                it was two thirds the width of a half-screen card. */}
                            <span
                                aria-hidden="true"
                                className="absolute top-2 right-3 md:top-3 md:right-5 font-mono text-[40px] md:text-[64px] leading-none font-semibold text-[#002B5C]/[0.04] group-hover:text-[#002B5C]/[0.07] transition-colors select-none"
                            >
                                {v.num}
                            </span>

                            {/* Stacked on mobile, side by side from md.
                                Two columns leave ~130px of content width, and a
                                30-character tagline set beside a 44px icon in
                                that space wraps to four lines. */}
                            <div className="relative flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
                                <div className="w-9 h-9 md:w-11 md:h-11 bg-[#002B5C] text-white flex items-center justify-center flex-shrink-0 transition-colors duration-300 group-hover:bg-[#CC0033]">
                                    <v.icon size={20} strokeWidth={1.75} />
                                </div>
                                <div className="overline !text-[10px] !text-[#CC0033] md:mt-1">
                                    {tagline}
                                </div>
                            </div>

                            {/*
                             * The link is on the heading, and its ::after covers
                             * the whole card — so the entire tile is still one
                             * click target, from one anchor, with one thing for
                             * a screen reader to announce.
                             *
                             * It has to be built this way now the card holds a
                             * button: a <button> inside an <a> is invalid HTML,
                             * and browsers recover from it by dropping one of
                             * the two — usually the one you needed.
                             */}
                            <h3 className="relative font-sans font-bold text-lg md:text-2xl text-[#002B5C] mt-4 md:mt-7 tracking-tight leading-tight">
                                <Link
                                    to={v.to}
                                    className="after:absolute after:inset-0 after:content-[''] hover:text-[#CC0033] transition-colors"
                                >
                                    {title}
                                </Link>
                            </h3>

                            {v.comingSoon && (
                                <span
                                    data-testid={`home-vertical-coming-soon-${v.id}`}
                                    className="relative mt-2 md:mt-3 inline-flex items-center gap-1.5 bg-[#F59E0B] text-[#002B5C] font-mono uppercase tracking-widest text-[10px] px-2 py-1 self-start"
                                >
                                    <span className="w-1.5 h-1.5 bg-[#002B5C] rounded-full animate-pulse" />
                                    Coming Soon
                                </span>
                            )}

                            {/*
                             * The description is collapsed on mobile, never cut.
                             *
                             * Four of these paragraphs are what made this one
                             * section two screens tall. Truncating them would
                             * have hidden the same words with no way to read
                             * them; behind a control, the whole sentence is one
                             * tap away and the default view stays short.
                             *
                             * z-10 lifts the button above the heading's overlay,
                             * or the card's own link would swallow the tap.
                             */}
                            <button
                                type="button"
                                onClick={() => setOpenBiz((o) => ({ ...o, [v.id]: !o[v.id] }))}
                                aria-expanded={open}
                                aria-controls={`biz-lede-${v.id}`}
                                data-testid={`home-vertical-toggle-${v.id}`}
                                className="md:hidden relative z-10 mt-3 -ml-1 self-start inline-flex items-center gap-1 px-1 py-1.5 text-[11px] font-mono uppercase tracking-widest text-[#4B5563] hover:text-[#002B5C]"
                            >
                                {open ? "Less" : "What this is"}
                                <ChevronDown
                                    size={13}
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                    className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                                />
                            </button>

                            <p
                                id={`biz-lede-${v.id}`}
                                className={`relative text-sm text-[#4B5563] mt-2 md:mt-3 leading-relaxed flex-1 ${open ? "" : "hidden"} md:block`}
                            >
                                {lede}
                            </p>

                            <span className="relative mt-4 md:mt-7 inline-flex items-center gap-1 text-[10px] md:text-xs font-mono uppercase tracking-[0.18em] text-[#002B5C] group-hover:text-[#CC0033] transition-colors self-start">
                                {cta}
                                <ArrowUpRight
                                    size={14}
                                    strokeWidth={2}
                                    className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1"
                                />
                            </span>
                        </article>
                        );
                    })}
                </div>
            </section>
            )}

            {/* ============== CATEGORIES BENTO (Imprints) ============== */}
            {!hidden.has("home.imprints") && (
            <section style={{ order: homeOrd("imprints") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-14 md:py-32">
                <div className="flex items-end justify-between mb-7 md:mb-12">
                    <div>
                        <div className="overline">{site.home_imprints_overline || "The Catalogue"}</div>
                        <h2 className="font-serif text-3xl md:text-5xl mt-2 md:mt-3 text-[#002B5C] max-w-2xl leading-tight whitespace-pre-line">
                            {renderRich(site.home_imprints_title || "Five imprints.\nOne scholarly standard.")}
                        </h2>
                    </div>
                    <Link
                        to="/books"
                        data-testid="categories-view-all-link"
                        className="hidden md:inline-flex items-center gap-1 text-sm font-medium border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033] transition-colors"
                    >
                        Browse all <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-5">
                    {IMPRINT_TILES.map((imp) => {
                        const name = site[`home_imprint_${imp.key}_name`] || imp.name;
                        const link = site[`home_imprint_${imp.key}_link`] || imp.link;
                        const image = mediaUrl(site[imp.imgSlot]) || imp.image;
                        return (
                            <Link
                                key={imp.key}
                                to={link}
                                data-testid={`imprint-tile-${imp.key}`}
                                className="group relative block overflow-hidden bg-[#002B5C] border border-[#E5E7EB] aspect-[3/4] hover:border-[#002B5C] transition-colors"
                            >
                                <img
                                    src={image}
                                    alt={name}
                                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#002B5C]/90 via-[#002B5C]/30 to-transparent" />
                                {/* Titles and Explore links line up across all five tiles:
                                    the title box reserves two lines and bottom-aligns its text
                                    (so one- and two-line names share a baseline), and the tiles
                                    without an Explore link keep the row as invisible spacing
                                    rather than collapsing and riding lower than their neighbours. */}
                                <div className="absolute inset-0 p-5 flex flex-col justify-between text-[#FFFFFF]">
                                    <span className="overline !text-[9px] !text-[#F59E0B]">Imprint</span>
                                    <div>
                                        <h3 className="font-serif text-xl leading-tight min-h-[3.25rem] flex items-end">
                                            {name}
                                        </h3>
                                        <div
                                            /* Hidden while the tile has nowhere
                                               of its own to go. Driven by the
                                               resolved link rather than a list of
                                               keys, so pointing Coffee Table at
                                               its category from Admin reveals the
                                               Explore label with no code change. */
                                            aria-hidden={link === "/books"}
                                            className={`mt-3 inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest border-b border-[#F59E0B] pb-0.5 text-[#F59E0B] ${link === "/books" ? "invisible" : ""}`}
                                        >
                                            Explore
                                            <ArrowUpRight size={11} strokeWidth={1.5} />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </section>
            )}

            {/* ============== GIFTING BANNER ==============
                A photograph the admin uploads. Sits in the ordinary section
                order, so it can be dragged anywhere on the page or hidden from
                Admin → Pages like any other block, and it renders nothing at
                all until an image is uploaded and the switch is on. */}
            {/* order -2 puts it ahead of the hero, which sits at -1. That is the
                most prominent slot on the site and a marketing decision, so it
                is a setting rather than a constant. */}
            {!hidden.has("home.gifting_banner") && (
                <section
                    style={{
                        order:
                            site?.hamper_banner?.position === "above_hero"
                                ? -2
                                : homeOrd("gifting_banner"),
                    }}
                >
                    <HamperBanner banner={site?.hamper_banner} />
                </section>
            )}

            {/* ============== HOT OFF PRESS (new releases) ============== */}
            {!hidden.has("home.hot_off_press") && newReleasesRow.length > 0 && (
            <section style={{ order: homeOrd("hot_off_press") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-12 md:py-28 bg-[#F5F7FA] border-y border-[#E5E7EB]">
                <div className="flex items-end justify-between mb-7 md:mb-12">
                    <div>
                        <div className="overline">{site.home_hot_overline || "Hot Off the Press"}</div>
                        <h2 className="font-serif text-3xl md:text-5xl mt-2 md:mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
                            {renderRich(site.home_hot_title || "New this season.")}
                        </h2>
                    </div>
                    <Link
                        to="/books?new_release=true"
                        data-testid="new-releases-view-all-link"
                        className="hidden md:inline-flex items-center gap-1 text-sm font-medium border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033] transition-colors"
                    >
                        View all new titles <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>
                <BookRail books={newReleasesRow} label="New this season" />
            </section>
            )}

            {/* ============== SOLUTIONS ============== */}
            {!hidden.has("home.solutions") && (
            <section style={{ order: homeOrd("solutions") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-14 md:py-32">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-10">
                    <div className="lg:col-span-4">
                        <div className="overline">{site.home_solutions_overline || "Solutions"}</div>
                        <h2 className="font-serif text-3xl md:text-5xl mt-2 md:mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
                            {renderRich(site.home_solutions_title || "We work with the institutions shaping tomorrow.")}
                        </h2>
                        <p className="mt-6 text-[#4B5563] text-sm leading-relaxed whitespace-pre-line">
                            {site.home_solutions_body ||
                                "We collaborate with professionals and scholars to curate opinion-building books that empower readers and users to gain a competitive edge."}
                        </p>
                        <Link
                            to="/contact"
                            data-testid="solutions-contact-link"
                            className="mt-8 inline-flex items-center gap-2 border-b border-[#002B5C] pb-0.5 text-sm font-medium hover:text-[#CC0033] hover:border-[#CC0033] transition-colors"
                        >
                            Talk to our institutional team
                            <ArrowUpRight size={14} strokeWidth={1.5} />
                        </Link>
                    </div>
                    <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-5">
                        {[
                            { icon: Briefcase, title: "For Firms", tagline: "Bespoke & branded", text: "Bespoke handbooks, corporate histories and practitioner references — co-created with your in-house teams for training, compliance and brand building." },
                            { icon: Building2, title: "For Institutions", tagline: "Adoption & licensing", text: "Whole-campus adoption programmes, library-grade editions and custom imprints for schools, universities and research bodies." },
                            { icon: Users, title: "For Professionals", tagline: "Practice references", text: "Authoritative Law, Tax, Business and Technology titles — ready-reckoners and updates written by leading practitioners." },
                            { icon: GraduationCap, title: "For Educators", tagline: "Classroom-ready", text: "Instructor review copies, lesson plans and classroom-ready ancillaries mapped to current curricula, plus customized bundle offerings." },
                        ].map((s, i) => {
                            const n = i + 1;
                            const tagline = site[`home_sol${n}_tagline`] || s.tagline;
                            const title = site[`home_sol${n}_title`] || s.title;
                            const text = site[`home_sol${n}_text`] || s.text;
                            return (
                            <div
                                key={s.title}
                                data-testid={`solution-card-${s.title.toLowerCase().replace(/\s+/g, "-")}`}
                                className="group relative bg-white border border-[#E5E7EB] p-8 pt-9 flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[#002B5C] hover:shadow-[0_24px_48px_-20px_rgba(0,43,92,0.25)] fade-up"
                                style={{ animationDelay: `${i * 80}ms` }}
                            >
                                <span
                                    aria-hidden="true"
                                    className="absolute top-0 left-0 h-[3px] w-12 bg-[#CC0033] transition-all duration-500 ease-out group-hover:w-full"
                                />
                                <span
                                    aria-hidden="true"
                                    className="absolute top-3 right-5 font-mono text-[64px] leading-none font-semibold text-[#002B5C]/[0.04] group-hover:text-[#002B5C]/[0.07] transition-colors select-none"
                                >
                                    {String(n).padStart(2, "0")}
                                </span>

                                <div className="relative flex items-start gap-4">
                                    <div className="w-11 h-11 bg-[#002B5C] text-white flex items-center justify-center transition-colors duration-300 group-hover:bg-[#CC0033]">
                                        <s.icon size={20} strokeWidth={1.75} />
                                    </div>
                                    <div className="overline !text-[10px] !text-[#CC0033] mt-1">
                                        {tagline}
                                    </div>
                                </div>

                                <h3 className="relative font-sans font-bold text-2xl text-[#002B5C] mt-7 tracking-tight leading-tight">
                                    {title}
                                </h3>
                                <p className="relative text-sm text-[#4B5563] mt-3 leading-relaxed flex-1">
                                    {text}
                                </p>
                            </div>
                            );
                        })}
                    </div>
                </div>
            </section>
            )}

            {/* ============== BESTSELLERS ============== */}
            {!hidden.has("home.bestsellers") && bestsellersEnabled && carouselBooks.length > 0 && (
                <section style={{ order: homeOrd("bestsellers") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-12 md:py-28 border-t border-[#E5E7EB]">
                    <div className="flex items-end justify-between mb-7 md:mb-12">
                        <div>
                            <div className="overline">{site.home_bestsellers_overline || "Bestsellers"}</div>
                            <h2 className="font-serif text-3xl md:text-5xl mt-2 md:mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
                                {renderRich(site.home_bestsellers_title || "What leaders are reading.")}
                            </h2>
                        </div>
                        <Link
                            to="/books?bestseller=true"
                            data-testid="bestsellers-view-all-link"
                            className="hidden md:inline-flex items-center gap-1 text-sm font-medium border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033] transition-colors"
                        >
                            View all bestsellers <ArrowUpRight size={14} strokeWidth={1.5} />
                        </Link>
                    </div>
                    <BestsellerCarousel books={carouselBooks} speed={bestsellersSpeed} />
                </section>
            )}

            {/* ============== TESTIMONIALS (carousel) ============== */}
            {!hidden.has("home.testimonials") && testimonials.length > 0 && (
                <div style={{ order: homeOrd("testimonials") }}>
                    <TestimonialsCarousel
                        items={testimonials}
                        overline={site.home_testimonials_overline}
                        title={site.home_testimonials_title}
                    />
                </div>
            )}

            {/* ============== EDITORIAL CTA (Manifesto) ============== */}
            {!hidden.has("home.manifesto") && (
            /* Bottom padding is deliberately lighter than the top.
             *
             * This section is navy and the footer directly beneath it is the
             * same navy, so nothing marks the join — the two paddings simply
             * add up into one tall column of empty colour. It was pb-32 here
             * plus pt-20 on the footer: 208px of nothing on a desktop screen,
             * reading as a gap in the page rather than as breathing room.
             *
             * Not zero, and not asymmetric only when last: the admin can
             * reorder home sections, so this may sit above a light section
             * instead, where it needs real space beneath it. 64px works in
             * both places. */
            <section style={{ order: homeOrd("manifesto") }} className="relative px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-14 pb-10 md:pt-32 md:pb-16 bg-[#002B5C] text-[#FFFFFF] overflow-hidden">
                <div className="relative z-10 max-w-3xl">
                    <div className="overline !text-white/50">Manifesto</div>
                    <p className="font-serif text-2xl md:text-5xl mt-4 md:mt-6 leading-tight">
                        "We believe a{" "}
                        <span className="text-[#F59E0B]">book</span> is a
                        conversation, not a monument. It should change with its
                        readers — and the country they are inheriting."
                    </p>
                    <div className="mt-5 md:mt-8 font-mono text-sm text-white/60">
                        — The Oakbridge Editorial Charter, 2017
                    </div>
                </div>
                <div className="absolute inset-0 opacity-20 pointer-events-none">
                    <div className="grid grid-cols-12 h-full">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div key={`grid-col-${i}`} className="border-l border-white/20" />
                        ))}
                    </div>
                </div>
            </section>
            )}
        </div>
    );
}
