import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import BookCard from "../components/BookCard";
import { fetchBooks, fetchCategories, fetchSiteContent, fetchSettings, mediaUrl } from "../lib/api";

// How many books to pull per infinite-scroll page.
const PAGE_SIZE = 24;

// Fallbacks used until settings load (mirror backend SETTINGS_DEFAULTS).
const DEFAULT_SORTS = [
    { value: "featured", label: "Featured" },
    { value: "new_arrivals", label: "New Arrivals" },
    { value: "price_asc", label: "Price — Low to High" },
    { value: "price_desc", label: "Price — High to Low" },
    { value: "title", label: "Title A–Z" },
];
const DEFAULT_FILTERS = [
    { key: "bestseller", label: "Bestsellers", enabled: true },
    { key: "new_release", label: "New Releases", enabled: true },
];

export default function Catalog() {
    const [sp, setSp] = useSearchParams();
    const [books, setBooks] = useState([]);
    const [cats, setCats] = useState([]);
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);       // initial page load
    const [loadingMore, setLoadingMore] = useState(false); // subsequent pages
    const [hasMore, setHasMore] = useState(true);
    const [showFilters, setShowFilters] = useState(false);

    const skipRef = useRef(0);       // how many we've loaded so far
    const busyRef = useRef(false);   // guards against overlapping fetches
    const sentinelRef = useRef(null);

    const category = sp.get("category") || "";
    const search = sp.get("search") || "";
    const sort = sp.get("sort") || "featured";

    // Admin-editable sort menu + filter toggles (fall back to defaults until loaded).
    const sortOptions =
        Array.isArray(settings?.plp_sort_options) && settings.plp_sort_options.length
            ? settings.plp_sort_options
            : DEFAULT_SORTS;
    const enabledFilters = (
        Array.isArray(settings?.plp_filters) ? settings.plp_filters : DEFAULT_FILTERS
    ).filter((f) => f && f.key && f.enabled !== false);

    // First landing on the bookstore defaults to the Professional category
    // (fresh mount, no category/search already in the URL). Users can still
    // switch to "All Categories" afterwards without it snapping back.
    const didDefaultCat = useRef(false);
    useEffect(() => {
        if (didDefaultCat.current) return;
        didDefaultCat.current = true;
        if (!sp.get("category") && !sp.get("search")) {
            const next = new URLSearchParams(sp);
            next.set("category", "professional");
            setSp(next, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        fetchCategories().then(setCats).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
    }, []);

    // Build the query params (category / search / active collection filters).
    const buildParams = useCallback(() => {
        const params = { sort };
        if (category) params.category = category;
        if (search) params.search = search;
        enabledFilters.forEach((f) => {
            if (sp.get(f.key) === "true") params[f.key] = true;
        });
        return params;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sort, category, search, sp, settings]);

    // Reset + load the first page whenever filters / sort / settings change.
    useEffect(() => {
        let cancelled = false;
        busyRef.current = true;
        setLoading(true);
        setBooks([]);
        setHasMore(true);
        skipRef.current = 0;
        fetchBooks({ ...buildParams(), skip: 0, limit: PAGE_SIZE })
            .then((data) => {
                if (cancelled) return;
                setBooks(data);
                skipRef.current = data.length;
                setHasMore(data.length === PAGE_SIZE);
            })
            .catch(() => {
                if (!cancelled) setHasMore(false);
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                    busyRef.current = false;
                }
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sp, settings]);

    // Load the next page (called by the IntersectionObserver sentinel).
    const loadMore = useCallback(() => {
        if (busyRef.current || !hasMore) return;
        busyRef.current = true;
        setLoadingMore(true);
        fetchBooks({ ...buildParams(), skip: skipRef.current, limit: PAGE_SIZE })
            .then((data) => {
                setBooks((prev) => [...prev, ...data]);
                skipRef.current += data.length;
                setHasMore(data.length === PAGE_SIZE);
            })
            .catch(() => setHasMore(false))
            .finally(() => {
                setLoadingMore(false);
                busyRef.current = false;
            });
    }, [buildParams, hasMore]);

    // Observe the sentinel; fetch the next page as it nears the viewport.
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const obs = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMore();
            },
            { rootMargin: "800px 0px" }
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, [loadMore]);

    const activeCat = cats.find((c) => c.id === category);

    const update = (key, value) => {
        const next = new URLSearchParams(sp);
        if (!value) next.delete(key);
        else next.set(key, value);
        setSp(next, { replace: true });
    };

    const clearFilters = () => {
        setSp(new URLSearchParams(), { replace: true });
    };

    const activeFilters = useMemo(() => {
        const arr = [];
        if (category) arr.push({ k: "category", v: category, label: activeCat?.name || category });
        enabledFilters.forEach((f) => {
            if (sp.get(f.key) === "true") arr.push({ k: f.key, v: "", label: f.label });
        });
        if (search) arr.push({ k: "search", v: "", label: `"${search}"` });
        return arr;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [category, search, activeCat, sp, settings]);

    const countLabel = loading
        ? "—"
        : `${books.length}${hasMore ? "+" : ""}`;

    return (
        <div data-testid="catalog-page">
            <Breadcrumbs
                items={
                    activeCat
                        ? [{ label: "Bookstore", to: "/books" }, { label: activeCat.name }]
                        : search
                          ? [{ label: "Bookstore", to: "/books" }, { label: `Search: "${search}"` }]
                          : [{ label: "Bookstore" }]
                }
            />
            <Seo
                title={activeCat ? activeCat.name : search ? `Search: ${search}` : "Bookstore"}
                description={activeCat ? activeCat.description : "Browse Oakbridge Publishing's full catalogue — law, tax, business, academic, reference, children's and test-prep titles."}
                path={category ? `/books?category=${category}` : "/books"}
            />
            {/* ============ HERO BANNER ============ */}
            <section
                data-testid="catalog-hero"
                className="relative overflow-hidden border-b border-[#E5E7EB]"
            >
                <div className="relative min-h-[320px] md:min-h-[400px]">
                    <img
                        src={mediaUrl(site.plp_banner) || "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=2000&q=85"}
                        alt="A vibrant wall of books"
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#002B5C]/95 via-[#002B5C]/70 to-[#002B5C]/35" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#002B5C]/30 to-transparent" />

                    <div className="relative px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16 md:py-24 lg:py-28 text-white max-w-5xl">
                        <div className="overline !text-white/70 !text-[11px] fade-up">
                            {activeCat
                                ? "Imprint"
                                : search
                                  ? "Search Results"
                                  : "The Bookstore"}
                        </div>
                        <h1
                            data-testid="catalog-hero-title"
                            className="font-serif text-5xl md:text-6xl lg:text-7xl mt-5 leading-[0.95] fade-up"
                            style={{ animationDelay: "80ms" }}
                        >
                            {activeCat ? (
                                <>
                                    The{" "}
                                    <em className="text-[#F59E0B] not-italic">
                                        {activeCat.name}
                                    </em>{" "}
                                    list
                                </>
                            ) : search ? (
                                <>
                                    Results for{" "}
                                    <em className="text-[#F59E0B] not-italic">
                                        "{search}"
                                    </em>
                                </>
                            ) : (
                                <>
                                    A library for the
                                    <br />
                                    <em className="text-[#F59E0B] not-italic">
                                        intellectually
                                    </em>{" "}
                                    curious.
                                </>
                            )}
                        </h1>
                        <p
                            className="mt-6 max-w-xl text-sm md:text-base text-white/80 leading-relaxed fade-up"
                            style={{ animationDelay: "160ms" }}
                        >
                            {activeCat?.description ||
                                "Browse authoritative reference titles, legal commentaries, curated thematic works and scholarly editions from Oakbridge Publishing — all in one place."}
                        </p>
                        <div
                            className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs font-mono uppercase tracking-widest text-white/60 fade-up"
                            style={{ animationDelay: "220ms" }}
                        >
                            <span>
                                <span className="text-[#F59E0B] text-base font-sans tracking-tight mr-2">
                                    {countLabel}
                                </span>
                                titles
                            </span>
                            <span>5 imprints</span>
                            <span>Free delivery over ₹999</span>
                        </div>
                    </div>
                </div>
            </section>

            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* ============ FILTERS SIDEBAR ============ */}
                <aside
                    className={`lg:col-span-3 ${showFilters ? "block" : "hidden"} lg:block`}
                    data-testid="catalog-filters"
                >
                    <div className="sticky top-24 space-y-8">
                        <div>
                            <div className="flex items-center justify-between">
                                <div className="overline">Search</div>
                                {search && (
                                    <button
                                        onClick={() => update("search", "")}
                                        className="text-xs text-[#4B5563] hover:text-[#CC0033]"
                                    >
                                        clear
                                    </button>
                                )}
                            </div>
                            <div className="mt-3 flex items-center border border-[#E5E7EB] bg-white h-10 px-3">
                                <Search size={14} strokeWidth={1.5} className="text-[#4B5563]" />
                                <input
                                    data-testid="filter-search-input"
                                    defaultValue={search}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                            update("search", e.currentTarget.value);
                                    }}
                                    placeholder="Title, author, ISBN"
                                    className="bg-transparent text-sm px-2 w-full outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <div className="overline">Category</div>
                            <ul className="mt-4 space-y-2">
                                <li>
                                    <button
                                        onClick={() => update("category", "")}
                                        data-testid="filter-category-all"
                                        className={`text-sm w-full text-left py-1 ${!category ? "text-[#002B5C] font-semibold" : "text-[#4B5563] hover:text-[#002B5C]"}`}
                                    >
                                        All Categories
                                    </button>
                                </li>
                                {cats.map((c) => (
                                    <li key={c.id}>
                                        <button
                                            onClick={() => update("category", c.id)}
                                            data-testid={`filter-category-${c.id}`}
                                            className={`text-sm w-full text-left py-1 flex justify-between ${category === c.id ? "text-[#002B5C] font-semibold" : "text-[#4B5563] hover:text-[#002B5C]"}`}
                                        >
                                            <span>{c.name}</span>
                                            <span className="font-mono text-xs text-[#4B5563]/70">
                                                {c.book_count}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {enabledFilters.length > 0 && (
                            <div>
                                <div className="overline">Collections</div>
                                <div className="mt-4 space-y-3">
                                    {enabledFilters.map((f) => (
                                        <label
                                            key={f.key}
                                            className="flex items-center gap-2 text-sm text-[#4B5563] cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                data-testid={`filter-${f.key}`}
                                                checked={sp.get(f.key) === "true"}
                                                onChange={(e) =>
                                                    update(f.key, e.target.checked ? "true" : "")
                                                }
                                                className="accent-[#002B5C]"
                                            />
                                            {f.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeFilters.length > 0 && (
                            <button
                                onClick={clearFilters}
                                data-testid="filter-clear-all"
                                className="text-xs font-mono uppercase tracking-widest text-[#CC0033] hover:underline"
                            >
                                Clear all filters
                            </button>
                        )}
                    </div>
                </aside>

                {/* ============ GRID ============ */}
                <section className="lg:col-span-9">
                    <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-4 mb-8">
                        <div
                            data-testid="catalog-count"
                            className="font-mono text-xs text-[#4B5563]"
                        >
                            {loading
                                ? "Loading…"
                                : `${books.length}${hasMore ? "+" : ""} title${books.length === 1 ? "" : "s"}`}
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowFilters((s) => !s)}
                                data-testid="toggle-filters-mobile"
                                className="lg:hidden inline-flex items-center gap-2 text-sm border border-[#E5E7EB] px-3 py-1.5"
                            >
                                <SlidersHorizontal size={14} strokeWidth={1.5} />
                                Filters
                            </button>
                            <select
                                value={sort}
                                onChange={(e) => update("sort", e.target.value)}
                                data-testid="catalog-sort"
                                className="bg-white border border-[#E5E7EB] text-sm px-3 py-1.5 outline-none focus:border-[#002B5C]"
                            >
                                {sortOptions.map((s) => (
                                    <option key={s.value} value={s.value}>
                                        Sort: {s.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {activeFilters.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-8">
                            {activeFilters.map((f) => (
                                <button
                                    key={f.k}
                                    onClick={() => update(f.k, "")}
                                    className="inline-flex items-center gap-2 bg-[#F5F7FA] border border-[#E5E7EB] text-xs px-3 py-1.5 hover:bg-[#e9e2d1]"
                                >
                                    {f.label}
                                    <X size={12} strokeWidth={1.5} />
                                </button>
                            ))}
                        </div>
                    )}

                    {!loading && books.length === 0 && (
                        <div
                            data-testid="catalog-empty"
                            className="text-center py-20 border border-dashed border-[#E5E7EB]"
                        >
                            <h3 className="font-serif text-3xl text-[#002B5C]">
                                No titles found.
                            </h3>
                            <p className="text-sm text-[#4B5563] mt-2">
                                Try adjusting your filters.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-10">
                        {books.map((b, i) => (
                            <BookCard key={b.id} book={b} index={i} />
                        ))}
                    </div>

                    {/* ============ INFINITE-SCROLL SENTINEL ============ */}
                    <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

                    {loadingMore && (
                        <div
                            data-testid="catalog-loading-more"
                            className="flex items-center justify-center gap-3 py-10 text-[#4B5563]"
                        >
                            <span className="inline-block h-4 w-4 border-2 border-[#002B5C] border-t-transparent rounded-full animate-spin" />
                            <span className="font-mono text-xs uppercase tracking-widest">
                                Loading more titles…
                            </span>
                        </div>
                    )}

                    {!loading && !hasMore && books.length > 0 && (
                        <div
                            data-testid="catalog-end"
                            className="text-center py-10 font-mono text-xs uppercase tracking-widest text-[#4B5563]/70"
                        >
                            — You've reached the end —
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
