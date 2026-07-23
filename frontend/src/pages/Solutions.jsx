import React, { useEffect, useState } from "react";
import { fetchSiteContent, fetchCollection, mediaUrl } from "../lib/api";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Check } from "lucide-react";

// Defaults mirror what was live. Every text field is now editable in Admin →
// Pages → Solutions (collection "page_solutions"); images stay on the
// per-slug site slots ("solutions_<slug>"). Anything left blank in Admin falls
// back to the value here, so nothing changes visually until an admin overrides.
const SOLUTION_DEFAULTS = [
    {
        slug: "schools",
        title: "For Schools",
        kicker: "K-12 Programmes",
        lede: "Whole-school textbook adoption programmes aligned with CBSE, ICSE and State Boards — with teacher training, digital supplements and periodic curriculum updates.",
        image: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1600&q=80",
        features: [
            "CBSE, ICSE & NEP 2020 aligned editions",
            "Teacher's manuals and lesson plans included",
            "Quarterly in-service training workshops",
            "Digital companion: practice bank + video lessons",
            "Volume discounts for district-wide adoption",
        ],
    },
    {
        slug: "higher-ed",
        title: "For Colleges",
        kicker: "Higher Education",
        lede: "Rigorous course texts for undergraduate and postgraduate programmes — including custom courseware developed in partnership with your faculty.",
        image: "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1600&q=85",
        features: [
            "Custom courseware bundled for your syllabus",
            "Indian case studies across business, law & tech",
            "Digital lab manuals with live datasets",
            "Instructor review copies within 5 working days",
            "Dedicated campus account manager",
        ],
    },
    {
        slug: "educators",
        title: "For Educators",
        kicker: "Teacher Resources",
        lede: "We equip educators with the tools to teach better — review copies, lesson plans, assessment banks and a growing community of practice. We also provide our educators with customized bundles.",
        image: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1600&q=80",
        features: [
            "Free instructor review copies for adoption consideration",
            "Downloadable lesson plans and rubrics",
            "Private educator community and quarterly meet-ups",
            "Early access to new editions",
            "Co-authoring invitations for subject experts",
        ],
    },
];

// Merge admin overrides (collection "page_solutions") over the defaults.
// Collection order wins when present; each field falls back to its default.
function mergeSolutions(collItems) {
    if (!Array.isArray(collItems) || collItems.length === 0) return SOLUTION_DEFAULTS;
    return collItems
        .map((ci) => {
            const def = SOLUTION_DEFAULTS.find((d) => d.slug === ci.slug) || {};
            const feats =
                typeof ci.features === "string" && ci.features.trim()
                    ? ci.features.split("\n").map((s) => s.trim()).filter(Boolean)
                    : def.features || [];
            return {
                slug: ci.slug || def.slug,
                title: ci.title || def.title || "",
                kicker: ci.kicker || def.kicker || "",
                lede: ci.lede || def.lede || "",
                image: def.image,
                features: feats,
            };
        })
        .filter((s) => s.slug);
}

function useSolutions() {
    const [site, setSite] = useState({});
    const [items, setItems] = useState(SOLUTION_DEFAULTS);
    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchCollection("page_solutions")
            .then((d) => setItems(mergeSolutions(d?.items)))
            .catch(() => {});
    }, []);
    return { site, items };
}

function SolutionDetail({ slug }) {
    const { site, items } = useSolutions();
    const s = items.find((x) => x.slug === slug) || SOLUTION_DEFAULTS.find((x) => x.slug === slug);
    if (!s) return null;
    return (
        <div>
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-12 border-b border-[#E5E7EB]">
                <Link
                    to="/solutions"
                    className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-widest text-[#4B5563] hover:text-[#002B5C]"
                >
                    ← All solutions
                </Link>
                <div className="overline mt-10">{s.kicker}</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-4xl">
                    {s.title}
                </h1>
                <p className="mt-8 max-w-2xl text-[#4B5563] leading-relaxed">
                    {s.lede}
                </p>
            </section>
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-24 grid grid-cols-1 lg:grid-cols-12 gap-10">
                <div className="lg:col-span-5 relative aspect-[4/3] border border-[#E5E7EB] overflow-hidden">
                    <img
                        src={mediaUrl(site["solutions_" + slug]) || s.image}
                        alt={s.title}
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                </div>
                <div className="lg:col-span-7">
                    <div className="overline">{site.solutions_included_label || "What's included"}</div>
                    <ul className="mt-6 space-y-4">
                        {s.features.map((f) => (
                            <li
                                key={f}
                                className="flex gap-4 pb-4 border-b border-[#E5E7EB]"
                            >
                                <Check
                                    size={18}
                                    strokeWidth={1.5}
                                    className="text-[#F59E0B] mt-0.5"
                                />
                                <span className="text-[#002B5C]">{f}</span>
                            </li>
                        ))}
                    </ul>
                    <Link
                        to="/contact"
                        data-testid="solution-contact-cta"
                        className="mt-10 inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-7 py-4 text-sm font-medium hover:bg-[#001F42] transition-colors"
                    >
                        {site.solutions_cta_label || "Talk to our institutional team"}
                        <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>
            </section>
        </div>
    );
}

export default function Solutions() {
    const { slug } = useParams();
    const { site, items } = useSolutions();
    if (slug) return <SolutionDetail slug={slug} />;

    return (
        <div data-testid="solutions-index">
            <Breadcrumbs items={[{ label: "Solutions" }]} />
            <Seo
                title="Solutions"
                description="Institutional solutions from Oakbridge Publishing — for schools, colleges, educators and firms: bulk orders, adoptions and custom publishing."
                path="/solutions"
            />
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-12 border-b border-[#E5E7EB]">
                <div className="overline">{site.solutions_index_overline || "Institutional Solutions"}</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-6 text-[#002B5C] leading-[0.95] max-w-4xl whitespace-pre-line">
                    {site.solutions_index_title || "Partners to\neducators, schools\nand institutions."}
                </h1>
            </section>
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-[#E5E7EB] bg-white">
                    {items.map((s, idx) => (
                        <Link
                            key={s.slug}
                            to={`/solutions/${s.slug}`}
                            data-testid={`solution-link-${s.slug}`}
                            className={`group block p-10 ${idx !== items.length - 1 ? "md:border-r border-[#E5E7EB]" : ""} ${idx !== 0 ? "border-t md:border-t-0" : ""} hover:bg-[#F5F7FA] transition-colors`}
                        >
                            <div className="overline">{s.kicker}</div>
                            <h3 className="font-serif text-3xl mt-4 text-[#002B5C] leading-tight">
                                {s.title}
                            </h3>
                            <p className="mt-4 text-sm text-[#4B5563] leading-relaxed">
                                {s.lede}
                            </p>
                            <span className="mt-6 inline-flex items-center gap-1 text-sm font-medium border-b border-[#002B5C] pb-0.5 group-hover:text-[#CC0033] group-hover:border-[#CC0033] transition-colors">
                                Learn more <ArrowUpRight size={14} strokeWidth={1.5} />
                            </span>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}
