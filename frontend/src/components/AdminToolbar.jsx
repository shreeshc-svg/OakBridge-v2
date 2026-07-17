import React from "react";
import { Search, X } from "lucide-react";

/**
 * Reusable search + filter + sort bar for admin list pages.
 * All controls are optional — pass only what a page needs.
 *
 * Props:
 *  query, onQuery, placeholder            → text search box
 *  filter, onFilter, filterOptions        → left <select> (e.g. status). [{value,label}]
 *  sort, onSort, sortOptions              → right <select>. [{value,label}]
 *  count, total                           → "X / Y shown" hint
 */
export default function AdminToolbar({
    query = "",
    onQuery,
    placeholder = "Search…",
    filter,
    onFilter,
    filterOptions,
    sort,
    onSort,
    sortOptions,
    count,
    total,
}) {
    return (
        <div className="mt-6 flex flex-wrap items-center gap-3" data-testid="admin-toolbar">
            {onQuery && (
                <div className="relative flex-1 min-w-[220px]">
                    <Search
                        size={14}
                        strokeWidth={1.5}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563] pointer-events-none"
                    />
                    <input
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        placeholder={placeholder}
                        data-testid="admin-toolbar-search"
                        className="w-full border border-[#E5E7EB] bg-white pl-9 pr-8 py-2 text-sm outline-none focus:border-[#002B5C]"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => onQuery("")}
                            aria-label="Clear search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#4B5563] hover:text-[#CC0033]"
                        >
                            <X size={14} strokeWidth={1.5} />
                        </button>
                    )}
                </div>
            )}

            {filterOptions && onFilter && (
                <select
                    value={filter}
                    onChange={(e) => onFilter(e.target.value)}
                    data-testid="admin-toolbar-filter"
                    className="border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                >
                    {filterOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            )}

            {sortOptions && onSort && (
                <select
                    value={sort}
                    onChange={(e) => onSort(e.target.value)}
                    data-testid="admin-toolbar-sort"
                    className="border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                    aria-label="Sort by"
                >
                    {sortOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            )}

            {typeof count === "number" && (
                <span className="text-xs font-mono text-[#4B5563] whitespace-nowrap">
                    {count}
                    {typeof total === "number" && total !== count ? ` / ${total}` : ""} shown
                </span>
            )}
        </div>
    );
}
