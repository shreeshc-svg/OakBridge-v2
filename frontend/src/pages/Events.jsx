import React, { useEffect, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { fetchSiteContent, fetchCollection, fetchSettings, mediaUrl } from "../lib/api";

// Reorderable sections of the Events page, in their default order.
const EVENT_SECTION_DEFS = [
    { key: "flagship", label: "Flagship Events" },
    { key: "experiences", label: "The Experience" },
    { key: "summit_speakers", label: "Summit Speakers" },
    { key: "who_attends", label: "Who Attends" },
    { key: "vidhi_speakers", label: "Vidhi Utsav Speakers" },
    { key: "cta", label: "Get Involved (CTA)" },
];
const DEFAULT_EVENT_ORDER = EVENT_SECTION_DEFS.map((s) => s.key);
import { ArrowUpRight, Calendar, MapPin, Users, Sparkles, Mic, BookOpen, Award, Music, Smile, ShoppingBag, Brain, Building2 } from "lucide-react";

const ASSET = (p) => `${process.env.REACT_APP_BACKEND_URL}${p}`;

const FLAGSHIP_EVENTS = [
    {
        id: "law-ai-tech-summit",
        eyebrow: "An Oakbridge Initiative",
        title: "India Law, AI & Tech Summit",
        subtitle: "Forging the Future of Law, AI & Tech",
        tagline: "Where Law meets Innovation.",
        description:
            "India's premier annual forum for legal innovation — a dynamic experience designed for maximum engagement and unparalleled access, celebrating Law, AI & Tech pioneers, leaders and innovators.",
        date: "Coming soon · Next edition 2026",
        venue: "New Delhi",
        time: "Full-day premium summit",
        href: "https://www.oakbridge.events",
        cta: "Visit oakbridge.events",
        image: ASSET("/api/files/oakbridge/events/summit-banner.webp"),
        chips: ["Legal Tech", "AI", "Innovation", "Networking"],
    },
    {
        id: "vidhi-utsav",
        eyebrow: "An Oakbridge Initiative · 4th Edition",
        title: "Vidhi Utsav 2027",
        subtitle: "The Legal Literature Festival",
        tagline: "Kanoon aur Kala ka Utsav, ek Naye Rang Mein.",
        description:
            "A unique festival that celebrates Law, Legal Literature and Legal Luminaries — a confluence of eminent judges, jurists, writers, lawyers, corporate counsels, leaders and artists.",
        date: "Coming soon · Feb – Mar 2027",
        venue: "New Delhi",
        time: "Two-day premium festival",
        href: "https://www.vidhiutsav.com",
        cta: "Visit vidhiutsav.com",
        image: ASSET("/api/files/oakbridge/events/vidhi-banner.webp"),
        chips: ["Law", "Literature", "Luminaries", "Awards", "Music", "Comedy"],
    },
];

const VIDHI_SPEAKERS = [
    { name: "Arjun Ram Meghwal", role: "Union Minister for Law & Justice, GoI", photo: ASSET("/api/files/oakbridge/events/vidhi-arjun-meghwal.png") },
    { name: "Justice A K Sikri", role: "Former SC Judge · Singapore Int'l Commercial Court", photo: ASSET("/api/files/oakbridge/events/vidhi-justice-sikri.png") },
    { name: "R Venkataramani", role: "Attorney General for India", photo: ASSET("/api/files/oakbridge/events/vidhi-venkataramani.png") },
    { name: "Dr Lalit Bhasin", role: "President, Society of Indian Law Firms", photo: ASSET("/api/files/oakbridge/events/vidhi-lalit-bhasin.png") },
    { name: "Ravi Kishan", role: "Member of Parliament & Actor", photo: ASSET("/api/files/oakbridge/events/vidhi-ravi-kishan.png") },
    { name: "Gaythri Raman", role: "Managing Director SEA & India, LexisNexis", photo: ASSET("/api/files/oakbridge/events/vidhi-gaythri-raman.png") },
];

const SUMMIT_SPEAKERS = [
    { name: "Justice Manmohan", role: "Judge, Supreme Court of India", photo: ASSET("/api/files/oakbridge/events/summit-justice-manmohan.png") },
    { name: "Dr. Shardul S. Shroff", role: "Executive Chairman, SAM & Co", photo: ASSET("/api/files/oakbridge/events/summit-shardul-shroff.png") },
    { name: "Dr Manoj Kumar", role: "Addl. Secretary, Ministry of Law & Justice", photo: ASSET("/api/files/oakbridge/events/summit-manoj-kumar.jpg") },
    { name: "Shailesh Haribhakti", role: "Board Chairperson, leading Indian companies", photo: ASSET("/api/files/oakbridge/events/summit-shailesh-haribhakti.png") },
    { name: "L Badri Narayanan", role: "Executive Partner, Lakshmikumaran Sridharan", photo: ASSET("/api/files/oakbridge/events/summit-badri-narayanan.png") },
];

const EXPERIENCE = [
    { icon: Mic, title: "Keynote Speeches", text: "Sharp insights from thought leaders shaping the future of law, policy and innovation." },
    { icon: Users, title: "Panel Discussions", text: "Engaging debates and diverse perspectives on the issues that matter most." },
    { icon: BookOpen, title: "Book & Author Sessions", text: "Curated discussions and exclusive interactions with the authors behind landmark works." },
    { icon: Award, title: "Awards & Recognition", text: "Celebrating excellence and achievement across legal practice, scholarship and innovation." },
    { icon: Brain, title: "AI & Legal Tech", text: "Hands-on showcases of emerging tools redefining how the legal profession works." },
    { icon: Music, title: "Music & Performance", text: "Live performances by talented musicians — because culture lives at the intersection of law and the arts." },
    { icon: Smile, title: "Stand-up Comedy", text: "Endless laughter with the country's leading comedians." },
    { icon: ShoppingBag, title: "Bazaar (Book Market)", text: "Discover and acquire unique books and literary treasures from leading publishers." },
];

const WHO_ATTENDS = [
    "Managing Partners & Senior Partners of top law firms",
    "General Counsels & Chief Legal Officers",
    "CTOs / CIOs of leading firms and corporates",
    "AI, Legal Tech & innovation founders",
    "Judges, Regulators, Policymakers & Academia",
    "Authors, Scholars and Legal Journalists",
];

function FlagshipCard({ ev, i }) {
    return (
        <article
            data-testid={`flagship-event-${ev.id}`}
            className="group relative grid grid-cols-1 lg:grid-cols-12 gap-0 border border-[#E5E7EB] bg-white overflow-hidden fade-up"
            style={{ animationDelay: `${i * 120}ms` }}
        >
            <div className="lg:col-span-5 relative min-h-[280px] lg:min-h-[480px] bg-[#002B5C] overflow-hidden">
                <img
                    src={ev.image}
                    alt={ev.title}
                    className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute top-5 left-5 right-5 flex items-start justify-between pointer-events-none">
                    <span className="overline !text-white/85 !text-[10px] tracking-widest bg-[#002B5C]/80 px-2 py-1 backdrop-blur-sm">
                        {ev.eyebrow}
                    </span>
                </div>
            </div>

            <div className="lg:col-span-7 p-8 md:p-12 lg:p-14 relative flex flex-col">
                <span
                    aria-hidden="true"
                    className="absolute top-0 left-0 h-[3px] w-12 bg-[#CC0033] transition-all duration-500 ease-out group-hover:w-full"
                />
                <div className="overline !text-[#CC0033]">Flagship Event</div>
                <h3 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-[1.05]">
                    {ev.title}
                </h3>
                <p className="mt-3 text-sm md:text-base text-[#002B5C] font-medium">
                    {ev.subtitle}
                </p>
                <p className="mt-5 font-serif italic text-lg text-[#CC0033]">
                    "{ev.tagline}"
                </p>
                <p className="mt-5 text-sm md:text-base text-[#4B5563] leading-relaxed">
                    {ev.description}
                </p>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-y-4 gap-x-6 border-t border-[#E5E7EB] pt-6">
                    <div className="flex gap-3">
                        <Calendar size={16} strokeWidth={1.5} className="text-[#CC0033] mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="overline !text-[10px]">Dates</div>
                            <div className="text-sm text-[#002B5C] mt-1">{ev.date}</div>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <MapPin size={16} strokeWidth={1.5} className="text-[#CC0033] mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="overline !text-[10px]">Venue</div>
                            <div className="text-sm text-[#002B5C] mt-1">{ev.venue}</div>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <Sparkles size={16} strokeWidth={1.5} className="text-[#CC0033] mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="overline !text-[10px]">Format</div>
                            <div className="text-sm text-[#002B5C] mt-1">{ev.time}</div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                    {ev.chips.map((c) => (
                        <span
                            key={c}
                            className="text-[11px] font-mono uppercase tracking-widest border border-[#E5E7EB] px-3 py-1 text-[#4B5563]"
                        >
                            {c}
                        </span>
                    ))}
                </div>

                <a
                    href={ev.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`flagship-cta-${ev.id}`}
                    className="mt-8 inline-flex items-center gap-2 bg-[#002B5C] text-white px-7 py-4 text-sm font-medium hover:bg-[#CC0033] transition-colors self-start"
                >
                    {ev.cta}
                    <ArrowUpRight size={16} strokeWidth={1.5} />
                </a>
            </div>
        </article>
    );
}

function SpeakerCard({ s }) {
    return (
        <div className="group">
            <div className="aspect-square overflow-hidden bg-[#F5F7FA] border border-[#E5E7EB]">
                <img
                    src={s.photo}
                    alt={s.name}
                    loading="lazy"
                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                />
            </div>
            <div className="mt-3 font-serif text-base text-[#002B5C] leading-tight">{s.name}</div>
            <div className="text-xs text-[#4B5563] mt-1 leading-snug">{s.role}</div>
        </div>
    );
}

export default function Events() {
    const [site, setSite] = useState({});
    const [vidhiSpeakers, setVidhiSpeakers] = useState(VIDHI_SPEAKERS);
    const [summitSpeakers, setSummitSpeakers] = useState(SUMMIT_SPEAKERS);
    const [flagship, setFlagship] = useState([]);
    const [settings, setSettings] = useState({});
    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
        fetchCollection("events_vidhi_speakers")
            .then((d) => {
                if (d?.items?.length)
                    setVidhiSpeakers(d.items.map((x) => ({ ...x, photo: mediaUrl(x.photo) })));
            })
            .catch(() => {});
        fetchCollection("events_summit_speakers")
            .then((d) => {
                if (d?.items?.length)
                    setSummitSpeakers(d.items.map((x) => ({ ...x, photo: mediaUrl(x.photo) })));
            })
            .catch(() => {});
        fetchCollection("events_flagship")
            .then((d) => setFlagship(d?.items || []))
            .catch(() => {});
    }, []);
    const resolveImg = (e) =>
        mediaUrl(
            (e.id === "vidhi-utsav" && site.events_vidhi_banner) ||
                (e.id === "law-ai-tech-summit" && site.events_summit_banner) ||
                e.image,
        ) || e.image;
    const flagshipEvents = (flagship.length ? flagship : FLAGSHIP_EVENTS).map((e) => ({
        ...e,
        chips: Array.isArray(e.chips)
            ? e.chips
            : typeof e.chips === "string"
              ? e.chips.split(",").map((c) => c.trim()).filter(Boolean)
              : [],
        image: resolveImg(e),
    }));
    const HERO_BANNERS = [
        {
            id: "vidhi-utsav",
            src: mediaUrl(site.events_vidhi_banner) || ASSET("/api/files/oakbridge/events/vidhi-banner.webp"),
            alt: "Vidhi Utsav — Legal Literature Festival",
            caption: "Vidhi Utsav · The Legal Literature Festival",
        },
        {
            id: "law-ai-tech",
            src: mediaUrl(site.events_summit_banner) || ASSET("/api/files/oakbridge/events/summit-banner.webp"),
            alt: "India Law, AI & Tech Summit",
            caption: "India Law, AI & Tech Summit · Where Law Meets Innovation",
        },
    ];
    const [heroIdx, setHeroIdx] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setHeroIdx((i) => (i + 1) % HERO_BANNERS.length);
        }, 6000);
        return () => clearInterval(timer);
    }, [HERO_BANNERS.length]);

    // Each reorderable section as a keyed element; the hero stays fixed at top.
    const sectionMap = {
        flagship: (
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28">
                <div className="max-w-3xl mb-16">
                    <div className="overline">Flagship Events</div>
                    <h2 className="font-serif text-4xl md:text-5xl mt-4 text-[#002B5C] leading-[1.05]">
                        A festival and a summit.
                        <br />
                        One mission.
                    </h2>
                    <p className="mt-6 text-[#4B5563] leading-relaxed">
                        From the country's only legal-literature festival to the
                        flagship summit at the intersection of law, AI and technology —
                        Oakbridge builds platforms that bring the profession together.
                    </p>
                </div>
                <div className="space-y-10">
                    {flagshipEvents.map((ev, i) => (
                        <FlagshipCard key={ev.id} ev={ev} i={i} />
                    ))}
                </div>
            </section>
        ),
        experiences: (
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 bg-[#F5F7FA] border-t border-b border-[#E5E7EB]">
                <div className="max-w-3xl mb-16">
                    <div className="overline">The Experience</div>
                    <h2 className="font-serif text-4xl md:text-5xl mt-4 text-[#002B5C] leading-[1.05]">
                        Experience law &amp; ideas
                        <br />
                        like never before.
                    </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {EXPERIENCE.map((e, i) => (
                        <div
                            key={e.title}
                            data-testid={`event-experience-${i}`}
                            className="group relative bg-white border border-[#E5E7EB] p-7 pt-8 overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[#002B5C] hover:shadow-[0_24px_48px_-20px_rgba(0,43,92,0.25)] fade-up"
                            style={{ animationDelay: `${i * 60}ms` }}
                        >
                            <span
                                aria-hidden="true"
                                className="absolute top-0 left-0 h-[3px] w-10 bg-[#CC0033] transition-all duration-500 ease-out group-hover:w-full"
                            />
                            <div className="w-10 h-10 bg-[#002B5C] text-white flex items-center justify-center transition-colors duration-300 group-hover:bg-[#CC0033]">
                                <e.icon size={18} strokeWidth={1.75} />
                            </div>
                            <h3 className="font-sans font-bold text-lg mt-5 text-[#002B5C] tracking-tight">
                                {e.title}
                            </h3>
                            <p className="text-sm text-[#4B5563] mt-2 leading-relaxed">
                                {e.text}
                            </p>
                        </div>
                    ))}
                </div>
            </section>
        ),
        summit_speakers: (
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 bg-[#002B5C] text-white">
                <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
                    <div>
                        <div className="overline !text-white/60">Summit Speakers</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-4 leading-[1.05]">
                            The future of law,
                            <br />
                            on one stage.
                        </h2>
                    </div>
                    <a
                        href="https://www.oakbridge.events/speakers"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="summit-speakers-all-link"
                        className="inline-flex items-center gap-1 text-sm font-medium border-b border-white/40 pb-0.5 hover:text-[#F59E0B] hover:border-[#F59E0B] transition-colors"
                    >
                        See all summit speakers <ArrowUpRight size={14} strokeWidth={1.5} />
                    </a>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 md:gap-8">
                    {summitSpeakers.map((s) => (
                        <div key={s.name}>
                            <div className="aspect-square overflow-hidden bg-white/10 border border-white/15">
                                <img
                                    src={s.photo}
                                    alt={s.name}
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <div className="mt-3 font-serif text-base leading-tight">{s.name}</div>
                            <div className="text-xs text-white/60 mt-1 leading-snug">{s.role}</div>
                        </div>
                    ))}
                </div>
            </section>
        ),
        who_attends: (
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 border-b border-[#E5E7EB]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                    <div className="lg:col-span-5">
                        <div className="overline">Who attends</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-4 text-[#002B5C] leading-[1.05]">
                            A curated gathering
                            <br />
                            of luminaries.
                        </h2>
                        <p className="mt-6 text-[#4B5563] leading-relaxed">
                            Oakbridge events are invitation-rich, deliberately small and
                            built for the people shaping legal practice and policy in
                            India and beyond.
                        </p>
                    </div>
                    <div className="lg:col-span-7">
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8">
                            {WHO_ATTENDS.map((w, i) => (
                                <li
                                    key={w}
                                    className="flex items-start gap-3 text-[#002B5C]"
                                    data-testid={`who-attends-${i}`}
                                >
                                    <span className="font-mono text-xs text-[#CC0033] mt-1.5">
                                        {String(i + 1).padStart(2, "0")}
                                    </span>
                                    <span className="text-base leading-snug">{w}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </section>
        ),
        vidhi_speakers: (
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 border-b border-[#E5E7EB]">
                <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
                    <div>
                        <div className="overline">Vidhi Utsav Speakers</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-4 text-[#002B5C] leading-[1.05]">
                            Eminent voices on stage.
                        </h2>
                    </div>
                    <a
                        href="https://www.vidhiutsav.com/speakers"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="vidhi-speakers-all-link"
                        className="inline-flex items-center gap-1 text-sm font-medium border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033] transition-colors"
                    >
                        View full speaker list <ArrowUpRight size={14} strokeWidth={1.5} />
                    </a>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 md:gap-8">
                    {vidhiSpeakers.map((s) => (
                        <SpeakerCard key={s.name} s={s} />
                    ))}
                </div>
            </section>
        ),
        cta: (
            <section className="relative px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-24 md:py-32 bg-[#F5F7FA] text-[#002B5C]">
                <div className="relative z-10 max-w-3xl">
                    <div className="overline">Get involved</div>
                    <h2 className="font-serif text-4xl md:text-6xl mt-4 leading-[1.05]">
                        Register, partner
                        <br />
                        or speak.
                    </h2>
                    <p className="mt-6 text-[#4B5563] leading-relaxed text-base md:text-lg">
                        Whether you're a delegate, a sponsor seeking a high-impact
                        platform, or a thought leader with something to say — there's a
                        place for you at Oakbridge events.
                    </p>
                    <div className="mt-10 flex flex-wrap gap-4">
                        <a
                            href="https://www.vidhiutsav.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="events-cta-vidhi"
                            className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-7 py-4 text-sm font-medium hover:bg-[#001F42] transition-colors"
                        >
                            Stay updated · Vidhi Utsav 2027
                            <ArrowUpRight size={16} strokeWidth={1.5} />
                        </a>
                        <a
                            href="https://www.oakbridge.events"
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="events-cta-summit"
                            className="inline-flex items-center gap-2 border border-[#002B5C] px-7 py-4 text-sm font-medium hover:bg-white transition-colors"
                        >
                            <Building2 size={14} strokeWidth={1.5} />
                            Explore the Law, AI & Tech Summit
                        </a>
                    </div>
                </div>
            </section>
        ),
    };

    // Admin-chosen order, with any missing/new sections appended in default order.
    const saved = Array.isArray(settings.events_section_order) ? settings.events_section_order : [];
    const eventOrder = [
        ...saved.filter((k) => sectionMap[k]),
        ...DEFAULT_EVENT_ORDER.filter((k) => !saved.includes(k)),
    ];

    return (
        <div data-testid="events-page">
            <Breadcrumbs items={[{ label: "Events" }]} />
            <Seo
                title="Events"
                description="Oakbridge Publishing events — Vidhi Utsav, the ILATS summit, book launches, panels and roundtables with scholars and policymakers."
                path="/events"
            />
            {/* HERO */}
            <section className="relative overflow-hidden border-b border-[#E5E7EB]">
                <div className="relative min-h-[420px] md:min-h-[520px] bg-[#002B5C]">
                    {HERO_BANNERS.map((b, i) => (
                        <img
                            key={b.id}
                            src={b.src}
                            alt={b.alt}
                            data-testid={`events-hero-banner-${b.id}`}
                            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[1200ms] ease-in-out ${i === heroIdx ? "opacity-100" : "opacity-0"}`}
                        />
                    ))}
                    <div className="absolute inset-0 bg-gradient-to-r from-[#002B5C]/95 via-[#002B5C]/70 to-[#002B5C]/30" />

                    {/* Banner caption + dots */}
                    <div
                        data-testid="events-hero-caption"
                        className="absolute bottom-5 right-5 md:bottom-6 md:right-8 flex items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-white/70"
                    >
                        <span className="hidden md:inline">{HERO_BANNERS[heroIdx].caption}</span>
                        <div className="flex items-center gap-2">
                            {HERO_BANNERS.map((b, i) => (
                                <button
                                    key={b.id}
                                    type="button"
                                    onClick={() => setHeroIdx(i)}
                                    data-testid={`events-hero-dot-${b.id}`}
                                    aria-label={`Show ${b.caption}`}
                                    className={`h-1 transition-all duration-500 ${i === heroIdx ? "w-10 bg-[#F59E0B]" : "w-5 bg-white/40 hover:bg-white/70"}`}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="relative px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 text-white max-w-5xl">
                        <div className="overline !text-white/70 !text-[11px] fade-up">
                            Oakbridge Events
                        </div>
                        <h1
                            className="font-serif text-5xl md:text-6xl lg:text-7xl mt-5 leading-[0.95] fade-up"
                            style={{ animationDelay: "80ms" }}
                        >
                            Two curated
                            <br />
                            <em className="text-[#F59E0B] not-italic">flagship events.</em>
                        </h1>
                        <p
                            className="mt-6 max-w-2xl text-base md:text-lg text-white/85 leading-relaxed fade-up"
                            style={{ animationDelay: "160ms" }}
                        >
                            <strong className="text-white">Vidhi Utsav</strong> — a celebration of Law &amp;
                            Literature — and the{" "}
                            <strong className="text-white">India Law, AI &amp; Tech Summit</strong>{" "}
                            on the future of legal innovation. Oakbridge curates the
                            country's most influential gatherings convening judges,
                            jurists, general counsels, scholars and technologists.
                        </p>
                        <div
                            className="mt-10 flex flex-wrap items-center gap-x-10 gap-y-4 text-xs font-mono uppercase tracking-widest text-white/60 fade-up"
                            style={{ animationDelay: "240ms" }}
                        >
                            <span><span className="text-[#F59E0B] text-base font-sans tracking-tight mr-2">02</span>Flagship festivals</span>
                            <span><span className="text-[#F59E0B] text-base font-sans tracking-tight mr-2">60+</span>Distinguished speakers</span>
                            <span><span className="text-[#F59E0B] text-base font-sans tracking-tight mr-2">2,000+</span>Delegates per year</span>
                        </div>
                    </div>
                </div>
            </section>

            {eventOrder.map((key) => (
                <React.Fragment key={key}>{sectionMap[key]}</React.Fragment>
            ))}
        </div>
    );
}
