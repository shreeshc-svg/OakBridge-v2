import React, { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Search, ArrowRight, ArrowUpRight } from "lucide-react";
import NoIndex from "../components/NoIndex";
import BookCard from "../components/BookCard";
import { fetchBestsellers } from "../lib/api";

/**
 * Catch-all page for unknown URLs.
 *
 * The app had no `path="*"` route, so any unmatched URL rendered a BLANK page
 * with an HTTP 200. That matters well beyond typos: the previous oakbridge.in
 * had ~255 indexed URLs, and every one of those still in Google's index now
 * lands here. A blank 200 is read by crawlers as a soft 404 and gives visitors
 * nothing to click, so this page always offers a route back into the catalogue.
 *
 * WHY IT ASKS RATHER THAN APOLOGISES
 *
 * Someone reaching this page had an intention — a title, an author, a topic —
 * and the old version answered it with a list of five sections and a sincere
 * apology. Neither helps them find the book. A search field costs nothing and
 * is the only control on the page that can actually resolve what they came for,
 * so it leads; the apology is one line and gets out of the way.
 *
 * `noindex` keeps these URLs out of the index while Google re-crawls; known old
 * paths should additionally get real 301s in vercel.json.
 */
const SUGGESTIONS = [
    { to: "/books", label: "Bookstore", note: "Law, tax, academic and general titles" },
    { to: "/authors", label: "Authors", note: "The scholars and practitioners who write for us" },
    { to: "/events", label: "Events", note: "Vidhi Utsav, summits and book launches" },
    { to: "/what-we-do", label: "What We Do", note: "Publishing, events and digital solutions" },
    { to: "/contact", label: "Contact us", note: "Tell us what you were after and we'll find it" },
];

export default function NotFound() {
    const nav = useNavigate();
    const loc = useLocation();
    const [q, setQ] = useState("");
    const [picks, setPicks] = useState([]);

    useEffect(() => {
        // Best-effort: if this fails the page is still perfectly useful.
        fetchBestsellers(4).then(setPicks).catch(() => {});
    }, []);

    const submit = (e) => {
        e.preventDefault();
        const t = q.trim();
        if (t) nav(`/books?search=${encodeURIComponent(t)}`);
    };

    return (
        <div data-testid="not-found-page" className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16 md:py-24">
            {/* NoIndex, not Seo: the old version set canonical to "/404", telling
                Google that every dead URL — of which the previous site left us
                hundreds — was a duplicate of one page that isn't a real route.
                A 404 should claim no canonical at all.

                KEEP THE TITLE STRING. scripts/prerender.js treats "Page not
                found" in rendered HTML as proof that a real route fell through
                to this component, and fails the build rather than shipping a
                book page that says the book does not exist. Reword this and
                that guard silently stops working. */}
            <NoIndex title="Page not found" />

            <div className="max-w-3xl">
                <div className="overline !text-[10px]">Error 404</div>
                <h1 className="font-serif text-4xl md:text-5xl text-[#002B5C] mt-4 leading-tight">
                    Sorry — we couldn't find that one.
                </h1>
                <p className="text-[#4B5563] mt-5 max-w-xl leading-relaxed">
                    It's most likely our doing, not yours. We rebuilt this website recently and a
                    few older links didn't survive the move. Nothing has been lost — whatever you
                    were after is almost certainly still here, just at a new address.
                </p>

                {/* The one control that can actually answer why they came. */}
                <form onSubmit={submit} className="mt-9 max-w-xl" data-testid="not-found-search">
                    <label
                        htmlFor="nf-search"
                        className="block font-serif text-xl text-[#002B5C]"
                    >
                        Were you looking for something in particular?
                    </label>
                    <div className="mt-3 flex border border-[#002B5C]">
                        <span className="flex items-center pl-3 text-[#4B5563]">
                            <Search size={16} strokeWidth={1.5} />
                        </span>
                        <input
                            id="nf-search"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="A title, an author, or an ISBN"
                            data-testid="not-found-search-input"
                            /* 16px on phones: below that, iOS Safari zooms the
                               page the moment this is focused and does not zoom
                               back out. md: restores the site's normal 14px. */
                            className="flex-1 min-w-0 px-3 py-3 text-base md:text-sm outline-none"
                        />
                        <button
                            type="submit"
                            className="bg-[#002B5C] text-white px-6 text-sm font-medium hover:bg-[#001F42] transition-colors"
                        >
                            Search
                        </button>
                    </div>
                    <p className="text-xs text-[#4B5563] mt-3 leading-relaxed">
                        If a title doesn't come up, try fewer words or a different spelling — a
                        small mismatch is usually all it takes. We search titles, authors and
                        ISBNs, and we'll suggest the closest thing we have.
                    </p>
                </form>
            </div>

            {/* Something to leave with, rather than a dead end. */}
            {picks.length > 0 && (
                <div className="mt-16" data-testid="not-found-picks">
                    <div className="overline !text-[10px]">While you're here</div>
                    <h2 className="font-serif text-2xl md:text-3xl text-[#002B5C] mt-2">
                        What everyone else is reading.
                    </h2>
                    <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
                        {picks.slice(0, 4).map((b, i) => (
                            <BookCard key={b.id} book={b} index={i} />
                        ))}
                    </div>
                    <Link
                        to="/books"
                        className="inline-flex items-center gap-1.5 mt-8 text-sm font-medium text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033] transition-colors"
                    >
                        Browse all 530+ titles <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>
            )}

            <div className="max-w-3xl mt-16">
                <div className="overline !text-[10px]">Or start somewhere else</div>
                <div className="mt-4 border-t border-[#E5E7EB]">
                    {SUGGESTIONS.map((s) => (
                        <Link
                            key={s.to}
                            to={s.to}
                            className="group flex items-center justify-between gap-6 border-b border-[#E5E7EB] py-4 hover:bg-[#F5F7FA] transition-colors"
                        >
                            <span>
                                <span className="block font-serif text-lg text-[#002B5C]">{s.label}</span>
                                <span className="block text-xs text-[#4B5563] mt-0.5">{s.note}</span>
                            </span>
                            <ArrowRight
                                size={16}
                                strokeWidth={1.5}
                                className="flex-shrink-0 text-[#4B5563] group-hover:text-[#CC0033] transition-colors"
                            />
                        </Link>
                    ))}
                </div>

                <p className="text-sm text-[#4B5563] mt-8 leading-relaxed">
                    Still stuck? Do write to us at{" "}
                    <a href="mailto:info@oakbridge.in" className="text-[#002B5C] underline">
                        info@oakbridge.in
                    </a>{" "}
                    with what you were looking for. Someone here will know where it went, and
                    we're always glad to be asked.
                </p>
                {/* The address they tried, quoted back. Someone who mistyped can
                    see it, and someone reporting a broken link can copy it. */}
                <p className="font-mono text-[11px] text-[#9CA3AF] mt-6 break-all">
                    Requested: {loc.pathname}
                </p>
            </div>
        </div>
    );
}
