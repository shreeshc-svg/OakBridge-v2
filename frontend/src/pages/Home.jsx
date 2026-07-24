import React, { useEffect, useRef, useState } from "react";
import Seo from "../components/Seo";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen, GraduationCap, Building2, Calendar, Cpu, Briefcase, Users, ChevronLeft, ChevronRight } from "lucide-react";
import BookCard from "../components/BookCard";
import BestsellerCarousel from "../components/BestsellerCarousel";
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
import { hiddenSet, resolveSectionOrder } from "../lib/sections";

// Default top-to-bottom order of the reorderable homepage sections. Admin can
// override via Admin → Pages → Section order & visibility (home_section_order).
const HOME_DEFAULT_ORDER = ["businesses", "imprints", "hot_off_press", "solutions", "bestsellers", "testimonials", "manifesto"];

// The five homepage "Imprint" tiles. Each is fully editable in Admin → Pages
// (name + image + link). Defaults below mirror what was live so nothing changes
// visually until an admin overrides a field. Image slots read site content;
// coffee_table/curated keep their original slot keys for backward-compat.
const IMPRINT_TILES = [
    { key: "academic", name: "Academic", link: "/books?category=academic", imgSlot: "home_imprint_academic_img", image: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=800&q=80" },
    { key: "professional", name: "Professional", link: "/books?category=professional", imgSlot: "home_imprint_professional_img", image: "https://images.unsplash.com/photo-1589994965851-a8f479c573a9?auto=format&fit=crop&w=800&q=80" },
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
        <section data-testid="testimonials" className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 bg-[#F5F7FA] border-y border-[#E5E7EB]">
            <div className="flex items-end justify-between gap-4 mb-10">
                <div className="max-w-2xl">
                    <div className="overline">{overline || "Testimonials"}</div>
                    <h2 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
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

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchFeatured().then(setFeatured).catch(() => {});
        fetchNewReleases().then(setNewRel).catch(() => {});
        fetchBestsellers(12).then(setBestsellers).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
        fetchCollection("home_testimonials").then((d) => setTestimonials((d?.items || []).filter((t) => t && t.enabled !== false && t.quote))).catch(() => {});
        // Fallback feed in case bestseller / new-release flags are sparse (also the pool for the curated carousel)
        fetchBooks({ sort: "featured", limit: 100 }).then(setFallback).catch(() => {});
    }, []);

    // Compose the bestseller row: bestsellers first, then new releases, then any other books — dedup by id, max 6.
    const bestsellerRow = (() => {
        const seen = new Set();
        const out = [];
        for (const list of [featured, newRel, fallback]) {
            for (const b of list) {
                if (!seen.has(b.id)) {
                    seen.add(b.id);
                    out.push(b);
                    if (out.length >= 6) return out;
                }
            }
        }
        return out;
    })();

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

    // Compose the new-releases row: new releases first, then featured, then fallback — dedup by id and exclude any book already shown in the bestsellers row. Max 7.
    const newReleasesRow = (() => {
        const used = new Set(bestsellerRow.map((b) => b.id));
        const out = [];
        for (const list of [newRel, featured, fallback]) {
            for (const b of list) {
                if (!used.has(b.id)) {
                    used.add(b.id);
                    out.push(b);
                    if (out.length >= 7) return out;
                }
            }
        }
        return out;
    })();

    return (
        <div data-testid="home-page" className="flex flex-col">
            <Seo
                title="Law Books & Academic Publishing House"
                description="Oakbridge Publishing is a leading law and academic publishing house — authoritative law books, tax, business and reference titles, plus events, training and AI-powered digital solutions for students, professionals and institutions."
                path="/"
            />
            {/* ============== HERO ============== */}
            <section style={{ order: -1 }} className="relative overflow-hidden border-b border-[#002B5C]/10">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                    <div className="lg:col-span-7 px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-20 lg:pt-32 lg:pb-36 relative">
                        <div className="overline fade-up">
                            {site.home_hero_overline || "Est. 2017 · A Scholarly Press"}
                        </div>
                        <h1 className="font-serif text-5xl sm:text-6xl lg:text-7xl leading-[0.95] mt-6 text-[#002B5C] whitespace-pre-line fade-up" style={{ animationDelay: "100ms" }}>
                            {renderRich(site.home_hero_title || "A library for\nthe *intellectually*\nrestless.")}
                        </h1>
                        <p className="mt-8 max-w-lg text-base text-[#4B5563] leading-relaxed whitespace-pre-line fade-up" style={{ animationDelay: "200ms" }}>
                            {site.home_hero_body ||
                                "Oakbridge produces authoritative, reliable and opinion-influencing reference titles, legal commentaries, thematic books across various genres, and thought-leadership curated works for students, professionals and curious minds across the globe."}
                        </p>
                        <div className="mt-10 flex flex-wrap gap-4 fade-up" style={{ animationDelay: "300ms" }}>
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

                    <div className="lg:col-span-5 relative min-h-[420px] lg:min-h-[720px] bg-[#002B5C]">
                        <img
                            src={mediaUrl(site.home_hero) || "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85"}
                            alt="A vibrant wall of books"
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
                            <div className="mt-3 font-mono text-xs text-white/60">
                                — Ananya Ghosh, Editor-in-Chief
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ============== BUSINESS VERTICALS (prominent, directly after hero) ============== */}
            {!hidden.has("home.businesses") && (
            <section
                data-testid="home-verticals"
                style={{ order: homeOrd("businesses") }}
                className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-24 border-b border-[#E5E7EB]"
            >
                <div className="flex flex-wrap items-end justify-between gap-4 mb-12">
                    <div>
                        <div className="overline">{site.home_biz_overline || "Our Businesses"}</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] max-w-2xl leading-tight whitespace-pre-line">
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

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                    {VERTICALS.map((v, i) => {
                        const n = i + 1;
                        const tagline = site[`home_biz${n}_tagline`] || v.tagline;
                        const title = site[`home_biz${n}_title`] || v.title;
                        const lede = site[`home_biz${n}_lede`] || v.lede;
                        const cta = site[`home_biz${n}_cta`] || v.cta;
                        return (
                        <Link
                            key={v.id}
                            to={v.to}
                            data-testid={`home-vertical-${v.id}`}
                            className="group relative bg-white border border-[#E5E7EB] p-8 pt-9 flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[#002B5C] hover:shadow-[0_24px_48px_-20px_rgba(0,43,92,0.25)] fade-up"
                            style={{ animationDelay: `${i * 80}ms` }}
                        >
                            {/* Top accent bar — red, scales on hover */}
                            <span
                                aria-hidden="true"
                                className="absolute top-0 left-0 h-[3px] w-12 bg-[#CC0033] transition-all duration-500 ease-out group-hover:w-full"
                            />

                            {/* Watermark numeral */}
                            <span
                                aria-hidden="true"
                                className="absolute top-3 right-5 font-mono text-[64px] leading-none font-semibold text-[#002B5C]/[0.04] group-hover:text-[#002B5C]/[0.07] transition-colors select-none"
                            >
                                {v.num}
                            </span>

                            <div className="relative flex items-start gap-4">
                                <div className="w-11 h-11 bg-[#002B5C] text-white flex items-center justify-center transition-colors duration-300 group-hover:bg-[#CC0033]">
                                    <v.icon size={20} strokeWidth={1.75} />
                                </div>
                                <div className="overline !text-[10px] !text-[#CC0033] mt-1">
                                    {tagline}
                                </div>
                            </div>

                            <h3 className="relative font-sans font-bold text-2xl text-[#002B5C] mt-7 tracking-tight leading-tight">
                                {title}
                            </h3>

                            {v.comingSoon && (
                                <span
                                    data-testid={`home-vertical-coming-soon-${v.id}`}
                                    className="relative mt-3 inline-flex items-center gap-1.5 bg-[#F59E0B] text-[#002B5C] font-mono uppercase tracking-widest text-[10px] px-2 py-1 self-start"
                                >
                                    <span className="w-1.5 h-1.5 bg-[#002B5C] rounded-full animate-pulse" />
                                    Coming Soon
                                </span>
                            )}

                            <p className="relative text-sm text-[#4B5563] mt-3 leading-relaxed flex-1">
                                {lede}
                            </p>

                            <span className="relative mt-7 inline-flex items-center gap-1 text-xs font-mono uppercase tracking-[0.18em] text-[#002B5C] group-hover:text-[#CC0033] transition-colors self-start">
                                {cta}
                                <ArrowUpRight
                                    size={14}
                                    strokeWidth={2}
                                    className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1"
                                />
                            </span>
                        </Link>
                        );
                    })}
                </div>
            </section>
            )}

            {/* ============== CATEGORIES BENTO (Imprints) ============== */}
            {!hidden.has("home.imprints") && (
            <section style={{ order: homeOrd("imprints") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-24 md:py-32">
                <div className="flex items-end justify-between mb-12">
                    <div>
                        <div className="overline">{site.home_imprints_overline || "The Catalogue"}</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] max-w-2xl leading-tight whitespace-pre-line">
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
                                <div className="absolute inset-0 p-5 flex flex-col justify-between text-[#FFFFFF]">
                                    <span className="overline !text-[9px] !text-[#F59E0B]">Imprint</span>
                                    <div>
                                        <h3 className="font-serif text-xl leading-tight">{name}</h3>
                                        {!["coffee_table", "curated"].includes(imp.key) && (
                                            <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest border-b border-[#F59E0B] pb-0.5 text-[#F59E0B]">
                                                Explore
                                                <ArrowUpRight size={11} strokeWidth={1.5} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </section>
            )}

            {/* ============== HOT OFF PRESS (new releases) ============== */}
            {!hidden.has("home.hot_off_press") && newReleasesRow.length > 0 && (
            <section style={{ order: homeOrd("hot_off_press") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 bg-[#F5F7FA] border-y border-[#E5E7EB]">
                <div className="flex items-end justify-between mb-12">
                    <div>
                        <div className="overline">{site.home_hot_overline || "Hot Off the Press"}</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
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
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-4 md:gap-5">
                    {newReleasesRow.map((b, i) => (
                        <BookCard key={b.id} book={b} index={i} compact />
                    ))}
                </div>
            </section>
            )}

            {/* ============== SOLUTIONS ============== */}
            {!hidden.has("home.solutions") && (
            <section style={{ order: homeOrd("solutions") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-24 md:py-32">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                    <div className="lg:col-span-4">
                        <div className="overline">{site.home_solutions_overline || "Solutions"}</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
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
                <section style={{ order: homeOrd("bestsellers") }} className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 border-t border-[#E5E7EB]">
                    <div className="flex items-end justify-between mb-12">
                        <div>
                            <div className="overline">{site.home_bestsellers_overline || "Bestsellers"}</div>
                            <h2 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
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
            <section style={{ order: homeOrd("manifesto") }} className="relative px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-24 md:py-32 bg-[#002B5C] text-[#FFFFFF] overflow-hidden">
                <div className="relative z-10 max-w-3xl">
                    <div className="overline !text-white/50">Manifesto</div>
                    <p className="font-serif text-3xl md:text-5xl mt-6 leading-tight">
                        "We believe a{" "}
                        <span className="text-[#F59E0B]">book</span> is a
                        conversation, not a monument. It should change with its
                        readers — and the country they are inheriting."
                    </p>
                    <div className="mt-8 font-mono text-sm text-white/60">
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
