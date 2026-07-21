import React, { useEffect, useState } from "react";
import { fetchSiteContent, mediaUrl } from "../lib/api";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Check } from "lucide-react";

const SOLUTIONS = {
    schools: {
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
    "higher-ed": {
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
    educators: {
        title: "For Educators",
        kicker: "Teacher Resources",
        lede: "We equip educators with the tools to teach better — review copies, lesson plans, assessment banks and a growing community of practice.",
        image: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1600&q=80",
        features: [
            "Free instructor review copies for adoption consideration",
            "Downloadable lesson plans and rubrics",
            "Private educator community and quarterly meet-ups",
            "Early access to new editions",
            "Co-authoring invitations for subject experts",
        ],
    },
};

function SolutionDetail({ slug }) {
    const s = SOLUTIONS[slug];
    const [site, setSite] = useState({});
    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);
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
                    <div className="overline">What's included</div>
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
                        Talk to our institutional team
                        <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>
            </section>
        </div>
    );
}

export default function Solutions() {
    const { slug } = useParams();
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
                <div className="overline">Institutional Solutions</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-6 text-[#002B5C] leading-[0.95] max-w-4xl">
                    Partners to
                    <br />
                    educators, schools
                    <br />
                    and institutions.
                </h1>
            </section>
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-[#E5E7EB] bg-white">
                    {Object.entries(SOLUTIONS).map(([slug, s], idx) => (
                        <Link
                            key={slug}
                            to={`/solutions/${slug}`}
                            data-testid={`solution-link-${slug}`}
                            className={`group block p-10 ${idx !== 2 ? "md:border-r border-[#E5E7EB]" : ""} ${idx !== 0 ? "border-t md:border-t-0" : ""} hover:bg-[#F5F7FA] transition-colors`}
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
