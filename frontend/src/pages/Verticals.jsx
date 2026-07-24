import React, { useEffect, useState } from "react";
import { fetchSiteContent, fetchCollection, resolveCollection, mediaUrl } from "../lib/api";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Link } from "react-router-dom";
import { BookOpen, Calendar, Cpu, GraduationCap, ArrowUpRight } from "lucide-react";

// Icons are referenced by name so admin-editable cards can pick one.
const ICONS = { BookOpen, Calendar, Cpu, GraduationCap };

const DEFAULT_HERO_IMAGE =
    "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85";

const DEFAULT_HERO = {
    overline: "What We Do",
    title: "Four businesses.\nOne scholarly",
    highlight: "centre of gravity.",
    body: "Oakbridge started as a publisher. Today we span four complementary businesses — all anchored by the same authoritative content, authors and editorial standards.",
};

const DEFAULT_VERTICALS = [
    {
        id: "publishing",
        icon: "BookOpen",
        kicker: "01 · Publishing",
        title: "Scholarly & Professional Books",
        lede: "Our flagship business — authoritative books across Academic, Law, Tax, Business, General, Coffee Table and Curated Works.",
        bullets: [
            "200+ titles across 5 publishing programs",
            "Distribution across India and 18 international markets",
            "Print, eBook and institutional licensing",
        ],
        cta_label: "Browse the bookstore",
        cta_to: "/books",
        image: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85",
    },
    {
        id: "events",
        icon: "Calendar",
        kicker: "02 · Events",
        title: "Forums, Launches & Conferences",
        lede: "Book launches, thought-leadership forums and policy roundtables — convening the scholars, practitioners and policymakers shaping India.",
        bullets: [
            "Flagship India Law Forum and annual Tax Conclave",
            "Intimate book launches with senior authors",
            "Curated meet-and-greet series with Supreme Court jurists",
        ],
        cta_label: "Partner on an event",
        cta_to: "/contact",
        image: "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1400&q=80",
    },
    {
        id: "digital-solutions",
        icon: "Cpu",
        kicker: "03 · Digital Solutions",
        title: "AI-Powered Knowledge Products",
        lede: "Next-generation digital platforms built on our scholarly content — semantic search, research assistants, subscription databases and institutional APIs.",
        bullets: [
            "Semantic search across our full legal and tax list",
            "AI research copilots for practitioners",
            "Licensed APIs for law firms, universities and fintechs",
        ],
        cta_label: "Get early access",
        cta_to: "/contact",
        coming_soon: true,
        image: "https://images.unsplash.com/photo-1551033406-611cf9a28f67?auto=format&fit=crop&w=1400&q=80",
    },
    {
        id: "training",
        icon: "GraduationCap",
        kicker: "04 · Training & Certification",
        title: "Programs for Practitioners",
        lede: "Training programmes, certification courses and in-house workshops — drawing from the same authors that write our books.",
        bullets: [
            "Programmes for Advocates and Chartered Accountants",
            "In-house workshops for law firms and corporates",
            "Certification tracks in Tax, Corporate Law and Governance",
        ],
        cta_label: "See upcoming cohorts",
        cta_to: "/contact",
        image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80",
    },
];

function asBullets(b) {
    if (Array.isArray(b)) return b.filter(Boolean);
    if (typeof b === "string") return b.split("\n").map((x) => x.trim()).filter(Boolean);
    return [];
}

function VerticalCard({ v, reverse, site }) {
    const Icon = ICONS[v.icon] || BookOpen;
    const bullets = asBullets(v.bullets);
    const img =
        mediaUrl(site?.["verticals_" + v.id]) || mediaUrl(v.image) || v.image;
    const ctaTo = v.cta_to || v.cta?.to || "/contact";
    const ctaLabel = v.cta_label || v.cta?.label || "Learn more";
    return (
        <section
            id={`vertical-${v.id}`}
            data-testid={`vertical-${v.id}`}
            className={`scroll-mt-24 grid grid-cols-1 lg:grid-cols-12 gap-10 py-20 border-t border-[#E5E7EB] ${reverse ? "lg:[&>div:first-child]:order-2" : ""}`}
        >
            <div className="lg:col-span-7">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="overline">{v.kicker}</div>
                    {v.coming_soon && (
                        <span
                            data-testid={`vertical-coming-soon-${v.id}`}
                            className="inline-flex items-center gap-1.5 bg-[#F59E0B] text-[#002B5C] font-mono uppercase tracking-widest text-[10px] px-2.5 py-1"
                        >
                            <span className="w-1.5 h-1.5 bg-[#002B5C] rounded-full animate-pulse" />
                            Coming Soon
                        </span>
                    )}
                </div>
                <h2 className="font-serif text-4xl md:text-5xl mt-4 text-[#002B5C] leading-tight max-w-xl">
                    {v.title}
                </h2>
                <p className="mt-6 text-[#4B5563] leading-relaxed max-w-xl">{v.lede}</p>
                {bullets.length > 0 && (
                    <ul className="mt-6 space-y-2 max-w-xl">
                        {bullets.map((b) => (
                            <li
                                key={b}
                                className="flex gap-3 text-sm text-[#002B5C] border-b border-[#E5E7EB] pb-2"
                            >
                                <span className="text-[#F59E0B] font-mono mt-0.5">✦</span>
                                <span>{b}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <Link
                    to={ctaTo}
                    data-testid={`vertical-cta-${v.id}`}
                    className="mt-8 inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                >
                    {ctaLabel} <ArrowUpRight size={14} strokeWidth={1.5} />
                </Link>
            </div>
            <div className="lg:col-span-5 relative aspect-[4/3] bg-[#002B5C] overflow-hidden">
                <img src={img} alt={v.title} className="absolute inset-0 w-full h-full object-cover opacity-90" />
                <div className="absolute inset-0 bg-gradient-to-tr from-[#002B5C]/60 to-transparent" />
                <Icon size={32} strokeWidth={1.5} className="absolute top-6 left-6 text-[#F59E0B]" />
            </div>
        </section>
    );
}

export default function Verticals() {
    const [site, setSite] = useState({});
    const [cardsData, setCardsData] = useState(null);
    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchCollection("page_verticals")
            .then(setCardsData)
            .catch(() => {});
    }, []);

    const hero = {
        overline: site.wwd_overline || DEFAULT_HERO.overline,
        title: site.wwd_title || DEFAULT_HERO.title,
        highlight: site.wwd_highlight ?? DEFAULT_HERO.highlight,
        body: site.wwd_body || DEFAULT_HERO.body,
    };
    const verticals = resolveCollection(cardsData, DEFAULT_VERTICALS);
    // Four tiles for the hero. Falls back to the old single hero image if a
    // vertical has no picture of its own, so the grid is never patchy.
    const heroFallback = mediaUrl(site.wwd_hero) || site.wwd_hero || DEFAULT_HERO_IMAGE;
    const heroTiles = verticals.slice(0, 4).map((v) => ({
        id: v.id,
        img: mediaUrl(site?.["verticals_" + v.id]) || mediaUrl(v.image) || v.image || heroFallback,
        // "01 · Publishing" -> "Publishing"; the number is already implied by position.
        label: (v.kicker || v.title || "").split("·").pop().trim(),
    }));

    return (
        <div data-testid="verticals-page">
            <Breadcrumbs items={[{ label: "What We Do" }]} />
            <Seo
                title="What We Do"
                description="Oakbridge Publishing's business verticals — publishing, events, digital solutions and professional training."
                path="/what-we-do"
            />
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-16 md:pt-20 pb-12 border-b border-[#E5E7EB]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
                    <div className="lg:col-span-7">
                        <div className="overline">{hero.overline}</div>
                        <h1 className="font-serif text-5xl md:text-6xl xl:text-7xl mt-4 text-[#002B5C] leading-[0.95] whitespace-pre-line">
                            {hero.title}
                            {hero.highlight ? (
                                <>
                                    <br />
                                    <em className="text-[#CC0033] not-italic">{hero.highlight}</em>
                                </>
                            ) : null}
                        </h1>
                        <p className="mt-8 max-w-xl text-[#4B5563] leading-relaxed whitespace-pre-line">
                            {hero.body}
                        </p>
                    </div>
                    {/*
                      One tile per business, so the headline's "four businesses"
                      is visible before you scroll. Each tile reuses that
                      vertical's own image key, so editing the picture in the
                      section below updates this grid too — no second place to
                      keep in sync.
                    */}
                    <div className="lg:col-span-5">
                        <div className="grid grid-cols-2 gap-3" data-testid="wwd-hero-grid">
                            {heroTiles.map((t) => (
                                <a
                                    key={t.id}
                                    href={`#vertical-${t.id}`}
                                    className="group relative aspect-square bg-[#002B5C] overflow-hidden block"
                                    data-testid={`wwd-hero-tile-${t.id}`}
                                >
                                    <img
                                        src={t.img}
                                        alt=""
                                        aria-hidden="true"
                                        loading="lazy"
                                        className="absolute inset-0 w-full h-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-[#002B5C]/85 via-[#002B5C]/25 to-transparent" />
                                    <span className="absolute inset-x-0 bottom-0 p-3 font-mono text-[10px] uppercase tracking-widest text-white/90 leading-tight">
                                        {t.label}
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className="absolute bottom-0 left-0 h-0.5 w-0 bg-[#F59E0B] transition-all duration-500 group-hover:w-full"
                                    />
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40">
                {verticals.map((v, i) => (
                    <VerticalCard key={v.id || i} v={v} reverse={i % 2 === 1} site={site} />
                ))}
            </div>
        </div>
    );
}
