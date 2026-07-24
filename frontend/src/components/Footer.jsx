import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeNewsletter, fetchSiteContent, fetchCollection } from "../lib/api";
import { toast } from "sonner";

const DEFAULT_COLUMNS = [
    {
        title: "Shop",
        links: [
            { to: "/books?category=law", label: "Law" },
            { to: "/books?category=tax", label: "Taxation" },
            { to: "/books?category=business", label: "Business & Management" },
            { to: "/books?category=academic", label: "Academic" },
            { to: "/books?category=general-reference", label: "General & Reference" },
        ],
    },
    {
        title: "Verticals",
        links: [
            { to: "/what-we-do", label: "Publishing" },
            { to: "/what-we-do#events", label: "Events" },
            { to: "/digital-solutions", label: "Digital Solutions" },
            { to: "/academy", label: "Training & Certification" },
            { to: "/submissions", label: "Author Submissions" },
        ],
    },
    {
        title: "Solutions",
        links: [
            { to: "/solutions/higher-ed", label: "For Colleges" },
            { to: "/solutions/educators", label: "For Educators" },
            { to: "/submissions", label: "Author Submissions" },
            { to: "/contact", label: "Contact Sales" },
        ],
    },
    {
        title: "Company",
        links: [
            { to: "/about", label: "Our Story" },
            { to: "/authors", label: "Authors" },
            { to: "/contact", label: "Contact" },
            { to: "/careers", label: "Careers" },
            { to: "/about#press", label: "Press" },
        ],
    },
];

const DEFAULT_LEGAL = [
    { to: "/privacy", label: "Privacy" },
    { to: "/terms", label: "Terms" },
    { to: "/shipping-policy", label: "Shipping" },
    { to: "/cookie-policy", label: "Cookies" },
    { to: "/contact", label: "Contact" },
];

const DEFAULTS = {
    est: "Est. 2017 · New Delhi",
    tagline: "Books that teach.\nIdeas that travel.",
    blurb: "Oakbridge Publishing crafts scholarly and educational titles for classrooms, libraries and curious readers across India and beyond.",
    news_placeholder: "your@email.com",
    news_button: "Subscribe",
    news_success: "Welcome to the Oakbridge reading list.",
    copyright: "Oakbridge Publishing Pvt. Ltd. — ISBN Registrar 978-81-XXXX.",
};

export default function Footer() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [site, setSite] = useState({});
    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [legal, setLegal] = useState(DEFAULT_LEGAL);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchCollection("site_footer_columns")
            .then((d) => {
                const items = (d?.items || []).filter((c) => c && c.title);
                if (items.length) setColumns(items);
            })
            .catch(() => {});
        fetchCollection("site_footer_legal")
            .then((d) => {
                const items = (d?.items || []).filter((l) => l && l.label && l.to);
                if (items.length) setLegal(items);
            })
            .catch(() => {});
    }, []);

    const c = {
        est: site.footer_est || DEFAULTS.est,
        tagline: site.footer_tagline || DEFAULTS.tagline,
        blurb: site.footer_blurb || DEFAULTS.blurb,
        news_placeholder: site.footer_news_placeholder || DEFAULTS.news_placeholder,
        news_button: site.footer_news_button || DEFAULTS.news_button,
        news_success: site.footer_news_success || DEFAULTS.news_success,
        copyright: site.footer_copyright || DEFAULTS.copyright,
    };

    const handleSubscribe = async (e) => {
        e.preventDefault();
        if (!email) return;
        setLoading(true);
        try {
            await subscribeNewsletter(email);
            toast.success(c.news_success);
            setEmail("");
        } catch (err) {
            toast.error("Could not subscribe. Try again in a moment.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <footer
            data-testid="site-footer"
            className="bg-[#002B5C] text-[#FFFFFF]"
        >
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-10">
                {/* Top grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-10 border-b border-white/10 pb-16">
                    <div className="md:col-span-4">
                        <img
                            src="/logo.jpg"
                            alt="Oakbridge Publishing"
                            className="h-28 w-auto mb-6"
                        />
                        <div className="overline !text-white/50">{c.est}</div>
                        <h3 className="font-serif text-4xl md:text-5xl mt-4 leading-none whitespace-pre-line">
                            {c.tagline}
                        </h3>
                        <p className="mt-6 text-white/70 text-sm max-w-md leading-relaxed whitespace-pre-line">
                            {c.blurb}
                        </p>
                        <form
                            onSubmit={handleSubscribe}
                            data-testid="newsletter-form"
                            className="mt-8 flex border border-white/20"
                        >
                            <input
                                data-testid="newsletter-email-input"
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={c.news_placeholder}
                                className="bg-transparent text-sm px-4 py-3 w-full outline-none placeholder:text-white/40"
                            />
                            <button
                                type="submit"
                                disabled={loading}
                                data-testid="newsletter-submit-button"
                                className="px-5 text-sm font-medium bg-[#F59E0B] text-[#002B5C] hover:bg-[#F59E0B] transition-colors disabled:opacity-50"
                            >
                                {loading ? "…" : c.news_button}
                            </button>
                        </form>
                    </div>

                    <div className="md:col-span-8 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
                        {columns.map((col) => (
                            <div key={col.title}>
                                <div className="overline !text-white/50">
                                    {col.title}
                                </div>
                                <ul className="mt-5 space-y-3">
                                    {(col.links || []).map((l) => (
                                        <li key={l.label}>
                                            <Link
                                                to={l.to}
                                                data-testid={`footer-link-${l.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                                className="text-sm text-white/80 hover:text-[#F59E0B] transition-colors"
                                            >
                                                {l.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bottom bar — extra right padding on desktop reserves the corner
                    where the floating chat + back-to-top widgets sit, so the legal
                    links (esp. "Contact") never render underneath them. */}
                <div className="pt-10 md:pr-20 2xl:pr-0 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs text-white/50 font-mono">
                    <div>
                        © {new Date().getFullYear()} {c.copyright}
                    </div>
                    <div className="flex gap-6 flex-wrap">
                        {legal.map((l) => (
                            <Link key={l.to + l.label} to={l.to} className="hover:text-white">
                                {l.label}
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </footer>
    );
}
