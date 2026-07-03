import React, { useState } from "react";
import { Link } from "react-router-dom";
import { subscribeNewsletter } from "../lib/api";
import { toast } from "sonner";

const columns = [
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
            { to: "/solutions/schools", label: "For Schools" },
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
            { to: "/about#careers", label: "Careers" },
            { to: "/about#press", label: "Press" },
        ],
    },
];

export default function Footer() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubscribe = async (e) => {
        e.preventDefault();
        if (!email) return;
        setLoading(true);
        try {
            await subscribeNewsletter(email);
            toast.success("Welcome to the Oakbridge reading list.");
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
            <div className="px-6 md:px-12 lg:px-16 pt-20 pb-10">
                {/* Top grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-10 border-b border-white/10 pb-16">
                    <div className="md:col-span-4">
                        <img
                            src="/logo-white.svg"
                            alt="Oakbridge Publishing"
                            className="h-14 w-auto mb-6"
                        />
                        <div className="overline !text-white/50">
                            Est. 2017 · New Delhi
                        </div>
                        <h3 className="font-serif text-4xl md:text-5xl mt-4 leading-none">
                            Books that teach.
                            <br />
                            Ideas that travel.
                        </h3>
                        <p className="mt-6 text-white/70 text-sm max-w-md leading-relaxed">
                            Oakbridge Publishing crafts scholarly and
                            educational titles for classrooms, libraries and
                            curious readers across India and beyond.
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
                                placeholder="your@email.com"
                                className="bg-transparent text-sm px-4 py-3 w-full outline-none placeholder:text-white/40"
                            />
                            <button
                                type="submit"
                                disabled={loading}
                                data-testid="newsletter-submit-button"
                                className="px-5 text-sm font-medium bg-[#F59E0B] text-[#002B5C] hover:bg-[#F59E0B] transition-colors disabled:opacity-50"
                            >
                                {loading ? "…" : "Subscribe"}
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
                                    {col.links.map((l) => (
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

                {/* Bottom bar */}
                <div className="pt-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs text-white/50 font-mono">
                    <div>
                        © {new Date().getFullYear()} Oakbridge Publishing Pvt.
                        Ltd. — ISBN Registrar 978-81-XXXX.
                    </div>
                    <div className="flex gap-6">
                        <Link to="/about#legal" className="hover:text-white">
                            Privacy
                        </Link>
                        <Link to="/about#legal" className="hover:text-white">
                            Terms
                        </Link>
                        <Link to="/contact" className="hover:text-white">
                            Contact
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
