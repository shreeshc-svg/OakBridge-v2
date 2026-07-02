import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Cpu } from "lucide-react";
import { toast } from "sonner";
import { subscribeNewsletter } from "../lib/api";

/**
 * Reusable "Coming Soon" hero / waitlist template.
 * Pass page-specific copy + features as props.
 */
export default function ComingSoon({
    pageTestId = "coming-soon-page",
    eyebrow = "Oakbridge",
    headline = "Coming soon.",
    headlineAccent = "",
    body = "",
    waitlistSource = "general-waitlist",
    emailPlaceholder = "you@firm.com",
    submitLabel = "Get early access",
    stats = [],
    featuresKicker = "What's coming",
    featuresHeadline = "",
    features = [],
}) {
    const [email, setEmail] = useState("");
    const [busy, setBusy] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!email) return;
        setBusy(true);
        try {
            await subscribeNewsletter(email, waitlistSource);
            setSubmitted(true);
            toast.success("You're on the waitlist. We'll be in touch.");
        } catch (err) {
            toast.error("Could not subscribe. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div data-testid={pageTestId}>
            {/* HERO */}
            <section className="relative overflow-hidden border-b border-[#E5E7EB] bg-[#002B5C] text-white">
                <div
                    aria-hidden="true"
                    className="absolute inset-0 opacity-[0.08]"
                    style={{
                        backgroundImage:
                            "radial-gradient(circle at 20% 20%, #F59E0B 0, transparent 35%), radial-gradient(circle at 80% 70%, #CC0033 0, transparent 35%)",
                    }}
                />
                <div className="relative px-6 md:px-12 lg:px-16 py-24 md:py-36 max-w-5xl">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span
                            data-testid="coming-soon-pill"
                            className="inline-flex items-center gap-2 bg-[#F59E0B] text-[#002B5C] font-mono uppercase tracking-widest text-xs px-3 py-1.5"
                        >
                            <span className="w-1.5 h-1.5 bg-[#002B5C] rounded-full animate-pulse" />
                            Coming Soon
                        </span>
                        <div className="overline !text-white/60 !text-[11px]">
                            {eyebrow}
                        </div>
                    </div>

                    <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl mt-8 leading-[0.95] fade-up">
                        {headline}
                        {headlineAccent && (
                            <>
                                {" "}
                                <em className="text-[#F59E0B] not-italic">
                                    {headlineAccent}
                                </em>
                            </>
                        )}
                    </h1>

                    {body && (
                        <p
                            className="mt-8 max-w-2xl text-base md:text-lg text-white/80 leading-relaxed fade-up"
                            style={{ animationDelay: "100ms" }}
                        >
                            {body}
                        </p>
                    )}

                    {/* Waitlist form */}
                    {!submitted ? (
                        <form
                            onSubmit={onSubmit}
                            data-testid="waitlist-form"
                            className="mt-10 flex flex-col sm:flex-row gap-3 max-w-xl fade-up"
                            style={{ animationDelay: "200ms" }}
                        >
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={emailPlaceholder}
                                data-testid="waitlist-email-input"
                                className="flex-1 bg-white/10 border border-white/30 focus:border-[#F59E0B] outline-none px-5 py-4 text-sm text-white placeholder:text-white/50 transition-colors"
                            />
                            <button
                                type="submit"
                                disabled={busy}
                                data-testid="waitlist-submit"
                                className="inline-flex items-center justify-center gap-2 bg-[#F59E0B] text-[#002B5C] px-7 py-4 text-sm font-medium hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {busy ? "Submitting…" : submitLabel}
                                <ArrowUpRight size={16} strokeWidth={1.5} />
                            </button>
                        </form>
                    ) : (
                        <div
                            data-testid="waitlist-thanks"
                            className="mt-10 inline-flex items-center gap-3 border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-5 py-4"
                        >
                            <span className="w-2 h-2 bg-[#F59E0B] rounded-full" />
                            <span className="text-sm">
                                You're on the waitlist. We'll be in touch when early
                                access opens up.
                            </span>
                        </div>
                    )}

                    {stats.length > 0 && (
                        <div
                            className="mt-12 flex flex-wrap items-center gap-x-10 gap-y-4 text-xs font-mono uppercase tracking-widest text-white/60 fade-up"
                            style={{ animationDelay: "260ms" }}
                        >
                            {stats.map((s) => (
                                <span key={s.label}>
                                    <span className="text-[#F59E0B] text-base font-sans tracking-tight mr-2">
                                        {s.value}
                                    </span>
                                    {s.label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </section>

            {/* WHAT'S COMING */}
            {features.length > 0 && (
                <section className="px-6 md:px-12 lg:px-16 py-20 md:py-28">
                    <div className="max-w-3xl mb-16">
                        <div className="overline">{featuresKicker}</div>
                        {featuresHeadline && (
                            <h2 className="font-serif text-4xl md:text-5xl mt-4 text-[#002B5C] leading-[1.05]">
                                {featuresHeadline}
                            </h2>
                        )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        {features.map((f, i) => (
                            <div
                                key={f.title}
                                data-testid={`coming-soon-feature-${i}`}
                                className="group relative bg-white border border-[#E5E7EB] p-8 pt-9 overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[#002B5C] hover:shadow-[0_24px_48px_-20px_rgba(0,43,92,0.25)] fade-up"
                                style={{ animationDelay: `${i * 80}ms` }}
                            >
                                <span
                                    aria-hidden="true"
                                    className="absolute top-0 left-0 h-[3px] w-12 bg-[#F59E0B] transition-all duration-500 ease-out group-hover:w-full"
                                />
                                <div className="w-11 h-11 bg-[#002B5C] text-white flex items-center justify-center transition-colors duration-300 group-hover:bg-[#CC0033]">
                                    <f.icon size={20} strokeWidth={1.75} />
                                </div>
                                <h3 className="font-sans font-bold text-2xl text-[#002B5C] mt-7 tracking-tight leading-tight">
                                    {f.title}
                                </h3>
                                <p className="text-sm text-[#4B5563] mt-3 leading-relaxed">
                                    {f.text}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* CTA STRIP */}
            <section className="px-6 md:px-12 lg:px-16 py-16 bg-[#F5F7FA] border-t border-[#E5E7EB]">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 max-w-6xl">
                    <div>
                        <div className="flex items-center gap-2">
                            <Cpu size={16} strokeWidth={1.5} className="text-[#CC0033]" />
                            <div className="overline">In the meantime</div>
                        </div>
                        <p className="mt-3 font-serif text-2xl text-[#002B5C] leading-snug max-w-xl">
                            Explore the catalogue, our events programme and partner
                            with our institutional team.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Link
                            to="/books"
                            data-testid="coming-soon-cta-books"
                            className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                        >
                            Browse the Bookstore
                            <ArrowUpRight size={14} strokeWidth={1.5} />
                        </Link>
                        <Link
                            to="/events"
                            data-testid="coming-soon-cta-events"
                            className="inline-flex items-center gap-2 border border-[#002B5C] px-6 py-3 text-sm font-medium hover:bg-white transition-colors"
                        >
                            Upcoming events
                            <ArrowUpRight size={14} strokeWidth={1.5} />
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}
