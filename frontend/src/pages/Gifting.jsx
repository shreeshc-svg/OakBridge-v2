import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { breadcrumbLd, metaDescription } from "../lib/schema";
import { listHampers, fetchSiteContent, formatINR, mediaUrl } from "../lib/api";

/**
 * The gifting landing page.
 *
 * Heading, lede and the empty-shelf line are all admin-editable through
 * site content, because this page exists to be re-pointed at whatever festival
 * is next and the copy will change more often than the code.
 *
 * It renders nothing at all when there are no hampers rather than an empty
 * grid, so switching the last one off retires the page cleanly instead of
 * leaving a headline over white space.
 */
export default function Gifting() {
    const [hampers, setHampers] = useState(null);
    const [page, setPage] = useState({});

    useEffect(() => {
        let live = true;
        listHampers()
            .then((d) => live && setHampers(Array.isArray(d) ? d : []))
            .catch(() => live && setHampers([]));
        fetchSiteContent()
            .then((c) => live && setPage(c?.gifting_page || {}))
            .catch(() => {});
        return () => {
            live = false;
        };
    }, []);

    const eyebrow = page.eyebrow || "Oakbridge Gifting";
    const heading = page.heading || "Books, boxed and ready to give.";
    const lede =
        page.lede ||
        "Hampers put together by our editors — a couple of titles worth keeping, and the small things that make them feel given rather than ordered.";
    const empty = page.empty || "No hampers are on sale just now. Do come back.";

    return (
        <div data-testid="gifting-page">
            <Seo
                title={`${heading} — Oakbridge Gifting`}
                description={metaDescription(lede)}
                path="/gifting"
                jsonLd={breadcrumbLd([{ name: "Gifting" }])}
            />
            <Breadcrumbs items={[{ label: "Gifting" }]} />

            <div className="max-w-6xl mx-auto px-7 pb-20">
                <div className="overline">{eyebrow}</div>
                <h1 className="font-serif text-4xl md:text-5xl leading-tight mt-3 text-[#002B5C] max-w-3xl">
                    {heading}
                </h1>
                <p className="mt-5 text-[#4B5563] leading-relaxed max-w-2xl">{lede}</p>

                {hampers === null ? (
                    <p className="mt-14 text-sm text-[#4B5563]">Loading…</p>
                ) : hampers.length === 0 ? (
                    <p data-testid="gifting-empty" className="mt-14 text-sm text-[#4B5563]">
                        {empty}
                    </p>
                ) : (
                    <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
                        {hampers.map((h) => {
                            // Same precedence as the product page: an explicit
                            // list price wins, the contents sum is the fallback.
                            // A card that disagrees with the page it links to is
                            // a pricing error as far as the customer is concerned.
                            const price = Number(h.price || 0);
                            const listed = Number(h.original_price || 0);
                            const full = listed > price ? listed : Number(h.contents_value || 0);
                            const saves = full > price ? Math.round((1 - price / full) * 100) : 0;
                            const oos = Number(h.stock ?? 0) <= 0;
                            return (
                                <Link
                                    key={h.id}
                                    to={`/books/${h.id}`}
                                    data-testid={`gifting-card-${h.id}`}
                                    className="group block"
                                >
                                    <div className="bg-[#F5F7FA] border border-[#E5E7EB] aspect-[4/3] overflow-hidden flex items-center justify-center">
                                        {h.cover_image ? (
                                            <img
                                                src={mediaUrl(h.cover_image)}
                                                alt={h.title}
                                                loading="lazy"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <span className="text-[10px] font-mono uppercase tracking-widest text-[#9CA3AF]">
                                                Photograph to come
                                            </span>
                                        )}
                                    </div>
                                    {h.occasion && (
                                        <div className="overline !text-[10px] mt-4">{h.occasion}</div>
                                    )}
                                    <h2 className="font-serif text-xl mt-1.5 text-[#002B5C] group-hover:text-[#CC0033] transition-colors">
                                        {h.title}
                                    </h2>
                                    {h.subtitle && (
                                        <p className="text-sm text-[#4B5563] mt-1 leading-relaxed line-clamp-2">
                                            {h.subtitle}
                                        </p>
                                    )}
                                    <div className="flex items-baseline gap-2.5 mt-3">
                                        <span className="font-serif text-lg text-[#002B5C]">
                                            {formatINR(price)}
                                        </span>
                                        {saves > 0 && (
                                            <>
                                                <span className="text-xs text-[#4B5563] line-through">
                                                    {formatINR(full)}
                                                </span>
                                                <span className="text-xs text-[#CC0033] font-semibold">
                                                    {saves}% off
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    {oos && (
                                        <div className="text-xs text-[#4B5563] mt-1.5">Sold out</div>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
