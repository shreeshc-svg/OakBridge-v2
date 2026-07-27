import React, { useEffect, useState } from "react";
import { Tablet, ArrowUpRight } from "lucide-react";
import { fetchSiteContent } from "../lib/api";

/**
 * Link out to the Oakbridge e-book platform.
 *
 * Entirely admin-driven: the CTA renders nowhere until `ebook_url` is set in
 * Admin -> Pages, so the site never ships a dead link, and the destination can
 * change later without a deploy. Label and blurb are editable too.
 *
 * variant:
 *   "banner" — full-width band under the homepage hero
 *   "bar"    — slim strip above the Bookstore listing
 *   "inline" — compact button beside a book's format on the PDP
 */
export default function EbookCta({ variant = "inline", site: siteProp, className = "" }) {
    const [site, setSite] = useState(siteProp || null);

    useEffect(() => {
        if (siteProp) {
            setSite(siteProp);
            return;
        }
        fetchSiteContent()
            .then(setSite)
            .catch(() => setSite({}));
    }, [siteProp]);

    const url = (site?.ebook_url || "").trim();
    if (!url) return null;

    const label = site?.ebook_cta_label || "Interested in e-books?";
    const action = site?.ebook_cta_action || "Explore the e-book library";
    const blurb =
        site?.ebook_cta_blurb ||
        "Read Oakbridge titles on any device — searchable, annotatable and always with you.";

    const external = /^https?:\/\//i.test(url);
    const linkProps = external
        ? { href: url, target: "_blank", rel: "noopener noreferrer" }
        : { href: url };

    if (variant === "banner") {
        return (
            <section
                data-testid="ebook-cta-banner"
                className={`px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-10 md:py-12 bg-[#002B5C] text-white ${className}`}
            >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-start gap-4 max-w-2xl">
                        <Tablet size={22} strokeWidth={1.5} className="text-[#F59E0B] flex-shrink-0 mt-1" />
                        <div>
                            <div className="overline !text-[10px] !text-[#F59E0B]">Oakbridge e-books</div>
                            <h2 className="font-serif text-2xl md:text-3xl mt-1.5 leading-tight">{label}</h2>
                            <p className="text-sm text-white/70 mt-2">{blurb}</p>
                        </div>
                    </div>
                    <a
                        {...linkProps}
                        data-testid="ebook-cta-banner-link"
                        className="inline-flex items-center gap-2 bg-white text-[#002B5C] px-6 py-3 text-sm font-medium hover:bg-[#F59E0B] hover:text-[#002B5C] transition-colors flex-shrink-0 self-start md:self-auto"
                    >
                        {action}
                        <ArrowUpRight size={16} strokeWidth={1.5} />
                    </a>
                </div>
            </section>
        );
    }

    if (variant === "bar") {
        return (
            <a
                {...linkProps}
                data-testid="ebook-cta-bar"
                className={`group flex items-center justify-between gap-4 border border-[#002B5C]/15 bg-[#F5F7FA] px-4 py-3 hover:border-[#002B5C] transition-colors ${className}`}
            >
                <span className="flex items-center gap-3 min-w-0">
                    <Tablet size={16} strokeWidth={1.5} className="text-[#CC0033] flex-shrink-0" />
                    <span className="text-sm text-[#002B5C] truncate">
                        {label}{" "}
                        <span className="text-[#4B5563] hidden sm:inline">— {action.toLowerCase()}</span>
                    </span>
                </span>
                <ArrowUpRight
                    size={15}
                    strokeWidth={1.5}
                    className="text-[#4B5563] group-hover:text-[#CC0033] flex-shrink-0"
                />
            </a>
        );
    }

    return (
        <a
            {...linkProps}
            data-testid="ebook-cta-inline"
            className={`group inline-flex items-center gap-2 border border-[#002B5C]/25 px-3.5 py-2 hover:border-[#002B5C] hover:bg-[#F5F7FA] transition-colors ${className}`}
        >
            <Tablet size={14} strokeWidth={1.5} className="text-[#CC0033]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#002B5C]">
                {label}
            </span>
            <ArrowUpRight
                size={13}
                strokeWidth={1.5}
                className="text-[#4B5563] group-hover:text-[#CC0033]"
            />
        </a>
    );
}
