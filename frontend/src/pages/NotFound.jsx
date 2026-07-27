import React from "react";
import { Link } from "react-router-dom";
import { Search, ArrowRight } from "lucide-react";
import NoIndex from "../components/NoIndex";

/**
 * Catch-all page for unknown URLs.
 *
 * The app had no `path="*"` route, so any unmatched URL rendered a BLANK page
 * with an HTTP 200. That matters well beyond typos: the previous oakbridge.in
 * had ~255 indexed URLs, and every one of those still in Google's index now
 * lands here. A blank 200 is read by crawlers as a soft 404 and gives visitors
 * nothing to click, so this page always offers a route back into the catalogue.
 *
 * `noindex` keeps these URLs out of the index while Google re-crawls; known old
 * paths should additionally get real 301s in vercel.json.
 */
const SUGGESTIONS = [
    { to: "/books", label: "Bookstore", note: "Law, tax, academic and general titles" },
    { to: "/what-we-do", label: "What We Do", note: "Our publishing, events and digital businesses" },
    { to: "/events", label: "Events", note: "Summits, Vidhi Utsav and more" },
    { to: "/authors", label: "Authors", note: "Browse our list of authors" },
    { to: "/contact", label: "Contact Us", note: "Talk to the Oakbridge team" },
];

export default function NotFound() {
    return (
        <div data-testid="not-found-page" className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28">
            {/* NoIndex, not Seo: the old version set canonical to "/404", telling
                Google that every dead URL — of which the previous site left us
                hundreds — was a duplicate of one page that isn't a real route.
                A 404 should claim no canonical at all. */}
            <NoIndex title="Page not found" />

            <div className="max-w-3xl">
                <div className="overline !text-[10px]">Error 404</div>
                <h1 className="font-serif text-4xl md:text-5xl text-[#002B5C] mt-4 leading-tight">
                    We couldn't find that page.
                </h1>
                <p className="text-[#4B5563] mt-5 max-w-xl">
                    The link may be out of date — our website was rebuilt recently, so some older
                    addresses have moved. Everything is still here, just in a new place.
                </p>

                <Link
                    to="/books"
                    data-testid="not-found-primary-cta"
                    className="inline-flex items-center gap-2 mt-8 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                >
                    <Search size={16} strokeWidth={1.5} />
                    Browse the bookstore
                </Link>

                <div className="mt-14 border-t border-[#E5E7EB]">
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
            </div>
        </div>
    );
}
