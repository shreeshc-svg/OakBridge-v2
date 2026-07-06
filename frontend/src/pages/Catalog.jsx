import React, { useEffect, useMemo, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import BookCard from "../components/BookCard";
import { fetchBooks, fetchCategories, fetchSiteContent, mediaUrl } from "../lib/api";

const SORTS = [
    { v: "featured", label: "Featured" },
    { v: "price_asc", label: "Price — Low to High" },
    { v: "price_desc", label: "Price — High to Low" },
    { v: "title", label: "Title A-Z" },
];

export default function Catalog() {
    const [sp, setSp] = useSearchParams();
    const [books, setBooks] = useState([]);
    const [cats, setCats] = useState([]);
    const [site, setSite] = useState({});
    const [loading, setLoading] = useState(true);
    const [showFilters, setShowFilters] = useState(false);

    const category = sp.get("category") || "";
    const search = sp.get("search") || "";
    const sort = sp.get("sort") || "featured";
    const bestseller = sp.get("bestseller") === "true";
    const new_release = sp.get("new_release") === "true";

    useEffect(() => {
        fetchCategories().then(setCats).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);

    useEffect(() => {
        setLoading(true);
        const params = { sort };
        if (category) params.category = category;
        if (search) params.search = search;
        if (bestseller) params.bestseller = true;
        if (new_release) params.new_release = true;
        fetchBooks(params)
            .then(setBooks)
            .finally(() => setLoading(false));
    }, [category, search, sort, bestseller, new_release]);

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
        if (bestseller) arr.push({ k: "bestseller", v: "", label: "Bestsellers" });
        if (new_release) arr.push({ k: "new_release", v: "", label: "New Releases" });
        if (search) arr.push({ k: "search", v: "", label: `"${search}"` });
        return arr;
    }, [category, bestseller, new_release, search, activeCat]);

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

                    <div className="relative px-6 md:px-12 lg:px-16 py-16 md:py-24 lg:py-28 text-white max-w-5xl">
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
                                    {loading ? "—" : books.length}
                                </span>
                                titles
                            </span>
                            <span>5 imprints</span>
                            <span>Free delivery over ₹999</span>
                        </div>
                    </div>
                </div>
            </section>

            <div className="px-6 md:px-12 lg:px-16 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
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

                        <div>
                            <div className="overline">Collections</div>
                            <div className="mt-4 space-y-3">
                                <label className="flex items-center gap-2 text-sm text-[#4B5563] cursor-pointer">
                                    <input
                                        type="checkbox"
                                        data-testid="filter-bestseller"
                                        checked={bestseller}
                                        onChange={(e) =>
                                            update("bestseller", e.target.checked ? "true" : "")
                                        }
                                        className="accent-[#002B5C]"
                                    />
                                    Bestsellers only
                                </label>
                                <label className="flex items-center gap-2 text-sm text-[#4B5563] cursor-pointer">
                                    <input
                                        type="checkbox"
                                        data-testid="filter-new-release"
                                        checked={new_release}
                                        onChange={(e) =>
                                            update("new_release", e.target.checked ? "true" : "")
                                        }
                                        className="accent-[#002B5C]"
                                    />
                                    New releases
                                </label>
                            </div>
                        </div>

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
                                : `${books.length} title${books.length === 1 ? "" : "s"}`}
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
                                {SORTS.map((s) => (
                                    <option key={s.v} value={s.v}>
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
                </section>
            </div>
        </div>
    );
}
