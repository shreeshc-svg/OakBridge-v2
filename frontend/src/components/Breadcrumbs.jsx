import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * Breadcrumb trail. Always prefixes "Home". Pass the trailing items
 * (last one is the current page). Set `inset` when the parent already
 * applies the page horizontal gutter.
 *   <Breadcrumbs items={[{ label: "Bookstore", to: "/books" }, { label: "Law" }]} />
 */
export default function Breadcrumbs({ items = [], inset = false }) {
    const trail = [{ label: "Home", to: "/" }, ...items];
    return (
        <nav
            aria-label="Breadcrumb"
            data-testid="breadcrumbs"
            className={inset ? "pt-2 pb-6" : "px-6 md:px-12 lg:px-16 pt-6 pb-2"}
        >
            <ol className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-[#4B5563]">
                {trail.map((it, i) => {
                    const last = i === trail.length - 1;
                    return (
                        <li key={i} className="flex items-center gap-1.5">
                            {i > 0 && (
                                <ChevronRight
                                    size={12}
                                    strokeWidth={1.5}
                                    className="text-[#4B5563]/50"
                                />
                            )}
                            {last || !it.to ? (
                                <span
                                    aria-current="page"
                                    className="text-[#002B5C] truncate max-w-[240px]"
                                >
                                    {it.label}
                                </span>
                            ) : (
                                <Link to={it.to} className="hover:text-[#002B5C] transition-colors">
                                    {it.label}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
