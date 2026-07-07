import React, { useEffect, useState } from "react";
import { fetchSiteContent, mediaUrl } from "../lib/api";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Link } from "react-router-dom";
import { BookOpen, Calendar, Cpu, GraduationCap, ArrowUpRight } from "lucide-react";

const VERTICALS = [
    {
        id: "publishing",
        icon: BookOpen,
        kicker: "01 · Publishing",
        title: "Scholarly & Professional Books",
        lede: "Our flagship business — authoritative books across Academic, Law, Tax, Business, General, Coffee Table and Curated Works.",
        bullets: [
            "500+ titles across 5 publishing programs",
            "Distribution across India and 18 international markets",
            "Print, eBook and institutional licensing",
        ],
        cta: { to: "/books", label: "Browse the bookstore" },
        image: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85",
    },
    {
        id: "events",
        icon: Calendar,
        kicker: "02 · Events",
        title: "Forums, Launches & Conferences",
        lede: "Book launches, thought-leadership forums and policy roundtables — convening the scholars, practitioners and policymakers shaping India.",
        bullets: [
            "Flagship India Law Forum and annual Tax Conclave",
            "Intimate book launches with senior authors",
            "Curated meet-and-greet series with Supreme Court jurists",
        ],
        cta: { to: "/contact", label: "Partner on an event" },
        image: "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1400&q=80",
    },
    {
        id: "digital-solutions",
        icon: Cpu,
        kicker: "03 · Digital Solutions",
        title: "AI-Powered Knowledge Products",
        lede: "Next-generation digital platforms built on our scholarly content — semantic search, research assistants, subscription databases and institutional APIs.",
        bullets: [
            "Semantic search across 500+ legal and tax titles",
            "AI research copilots for practitioners",
            "Licensed APIs for law firms, universities and fintechs",
        ],
        cta: { to: "/contact", label: "Get early access" },
        comingSoon: true,
        image: "https://images.unsplash.com/photo-1551033406-611cf9a28f67?auto=format&fit=crop&w=1400&q=80",
    },
    {
        id: "training",
        icon: GraduationCap,
        kicker: "04 · Training & Certification",
        title: "Programs for Practitioners",
        lede: "CPD-accredited training programs, certification courses and in-house workshops — drawing from the same authors that write our books.",
        bullets: [
            "Advocate and Chartered Accountant CPD programmes",
            "In-house workshops for law firms and corporates",
            "Certification tracks in Tax, Corporate Law and Governance",
        ],
        cta: { to: "/contact", label: "See upcoming cohorts" },
        image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80",
    },
];

function VerticalCard({ v, reverse, site }) {
    return (
        <section
            data-testid={`vertical-${v.id}`}
            className={`grid grid-cols-1 lg:grid-cols-12 gap-10 py-20 border-t border-[#E5E7EB] ${reverse ? "lg:[&>div:first-child]:order-2" : ""}`}
        >
            <div className="lg:col-span-7">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="overline">{v.kicker}</div>
                    {v.comingSoon && (
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
                <p className="mt-6 text-[#4B5563] leading-relaxed max-w-xl">
                    {v.lede}
                </p>
                <ul className="mt-6 space-y-2 max-w-xl">
                    {v.bullets.map((b) => (
                        <li
                            key={b}
                            className="flex gap-3 text-sm text-[#002B5C] border-b border-[#E5E7EB] pb-2"
                        >
                            <span className="text-[#F59E0B] font-mono mt-0.5">✦</span>
                            <span>{b}</span>
                        </li>
                    ))}
                </ul>
                <Link
                    to={v.cta.to}
                    data-testid={`vertical-cta-${v.id}`}
                    className="mt-8 inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                >
                    {v.cta.label} <ArrowUpRight size={14} strokeWidth={1.5} />
                </Link>
            </div>
            <div className="lg:col-span-5 relative aspect-[4/3] bg-[#002B5C] overflow-hidden">
                <img
                    src={mediaUrl(site?.["verticals_" + v.id]) || v.image}
                    alt={v.title}
                    className="absolute inset-0 w-full h-full object-cover opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-[#002B5C]/60 to-transparent" />
                <v.icon
                    size={32}
                    strokeWidth={1.5}
                    className="absolute top-6 left-6 text-[#F59E0B]"
                />
            </div>
        </section>
    );
}

export default function Verticals() {
    const [site, setSite] = useState({});
    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);
    return (
        <div data-testid="verticals-page">
            <Breadcrumbs items={[{ label: "What We Do" }]} />
            <Seo
                title="What We Do"
                description="Oakbridge Publishing's business verticals — publishing, events, digital solutions and professional training."
                path="/what-we-do"
            />
            <section className="px-6 md:px-12 lg:px-16 pt-20 pb-12 border-b border-[#E5E7EB]">
                <div className="overline">What We Do</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-4xl">
                    Four businesses.
                    <br />
                    One scholarly
                    <br />
                    <em className="text-[#CC0033]">centre of gravity.</em>
                </h1>
                <p className="mt-10 max-w-xl text-[#4B5563] leading-relaxed">
                    Oakbridge started as a publisher. Today we span four
                    complementary businesses — all anchored by the same
                    authoritative content, authors and editorial standards.
                </p>
            </section>
            <div className="px-6 md:px-12 lg:px-16">
                {VERTICALS.map((v, i) => (
                    <VerticalCard key={v.id} v={v} reverse={i % 2 === 1} site={site} />
                ))}
            </div>
        </div>
    );
}
