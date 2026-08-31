import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Link, useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X, Clock, BookOpen } from "lucide-react";
import BookCard from "../components/BookCard";
import { fetchBooks, fetchBooksWithMeta, fetchCategories, fetchSiteContent, fetchSettings, mediaUrl, logSearch, fetchSuggestIndex } from "../lib/api";
import EbookCta from "../components/EbookCta";
import CategoryRow from "../components/CategoryRow";
import { catalogueTotalFrom } from "../lib/catalogue";
import { loadIndex, suggestFrom, readRecent, pushRecent } from "../components/SearchBox";
import { fuzzySearch, didYouMean as didYouMeanTerm } from "../lib/fuzzy";
import { responsiveImage } from "../lib/img";
import { itemListLd, breadcrumbLd } from "../lib/schema";

// Renders admin copy where *text* becomes the accent colour and \n a line break.
function renderRich(text, color = "#CC0033") {
    return String(text || "")
        .split(/(\*[^*]+\*)/g)
        .map((p, i) =>
            p.length > 2 && p.startsWith("*") && p.endsWith("*") ? (
                <em key={i} className="not-italic" style={{ color }}>{p.slice(1, -1)}</em>
            ) : (
                <React.Fragment key={i}>{p}</React.Fragment>
            ),
        );
}

// How many books to pull per infinite-scroll page.
const PAGE_SIZE = 24;

/**
 * Bookstore search — the same capabilities as the header search, plus live results.
 *
 * Typing filters the listing after a short pause (no request per keystroke) and
 * writes the term to the URL, so any search is shareable and bookmarkable. The
 * suggestion index, matching rules and recent-search store are imported from
 * SearchBox rather than reimplemented, so both boxes stay identical in behaviour
 * and share one cached index fetch.
 */
function CatalogSearch({ value, onSearch }) {
    const [q, setQ] = useState(value || "");
    const [books, setBooks] = useState([]);
    const [recent, setRecent] = useState([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const boxRef = useRef(null);
    const dirty = useRef(false);

    useEffect(() => {
        loadIndex().then(setBooks);
        setRecent(readRecent());
    }, []);

    // Reflect external changes (chip cleared, browser Back) without clobbering typing.
    useEffect(() => {
        if (!dirty.current) setQ(value || "");
    }, [value]);

    // Debounced live search — 250ms is long enough to avoid a request per keystroke,
    // short enough to feel immediate.
    useEffect(() => {
        if (!dirty.current) return undefined;
        const t = setTimeout(() => {
            if ((q || "").trim() !== (value || "").trim()) onSearch(q.trim());
        }, 250);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q]);

    useEffect(() => {
        const onDown = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const suggestions = useMemo(() => suggestFrom(books, q), [books, q]);
    const showRecent = open && (q || "").trim().length < 2 && recent.length > 0;
    const rows = showRecent ? recent : suggestions;

    const apply = (term) => {
        const t = (term || "").trim();
        dirty.current = false;
        setQ(t);
        setOpen(false);
        setActive(-1);
        if (t) {
            pushRecent(t);
            setRecent(readRecent());
        }
        onSearch(t);
    };

    const onKeyDown = (e) => {
        if (!open || rows.length === 0) {
            if (e.key === "Enter") apply(q);
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % rows.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const row = active >= 0 ? rows[active] : null;
            apply(showRecent ? row || q : row ? row.t : q);
        } else if (e.key === "Escape") {
            setOpen(false);
            setActive(-1);
        }
    };

    return (
        <div ref={boxRef} className="relative mt-3">
            <div className="flex items-center border border-[#E5E7EB] bg-white h-10 px-3 focus-within:border-[#002B5C]">
                <Search size={14} strokeWidth={1.5} className="text-[#4B5563] flex-shrink-0" />
                <input
                    data-testid="filter-search-input"
                    value={q}
                    onChange={(e) => {
                        dirty.current = true;
                        setQ(e.target.value);
                        setOpen(true);
                        setActive(-1);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder="Title, author, ISBN"
                    aria-label="Search the bookstore"
                    className="bg-transparent text-sm px-2 w-full outline-none"
                />
                {q && (
                    <button
                        onClick={() => apply("")}
                        aria-label="Clear search"
                        data-testid="filter-search-clear"
                        className="p-1 -mr-1 text-[#4B5563] hover:text-[#CC0033] flex-shrink-0"
                    >
                        <X size={14} strokeWidth={1.5} />
                    </button>
                )}
            </div>

            {open && rows.length > 0 && (
                <div
                    data-testid="catalog-search-suggestions"
                    className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#E5E7EB] shadow-lg max-h-80 overflow-y-auto"
                >
                    {showRecent && (
                        <div className="overline !text-[9px] px-3 pt-2.5 pb-1 text-[#4B5563]">
                            Recent searches
                        </div>
                    )}
                    {rows.map((row, i) => {
                        const isRecent = showRecent;
                        const label = isRecent ? row : row.t;
                        return (
                            <button
                                key={`${label}-${i}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => apply(isRecent ? row : row.t)}
                                onMouseEnter={() => setActive(i)}
                                className={`w-full text-left px-3 py-2 flex items-start gap-2.5 ${active === i ? "bg-[#F5F7FA]" : ""}`}
                            >
                                {isRecent ? (
                                    <Clock size={13} strokeWidth={1.5} className="text-[#4B5563] mt-0.5 flex-shrink-0" />
                                ) : (
                                    <BookOpen size={13} strokeWidth={1.5} className="text-[#CC0033] mt-0.5 flex-shrink-0" />
                                )}
                                <span className="min-w-0">
                                    <span className="block text-sm text-[#002B5C] truncate">{label}</span>
                                    {!isRecent && row.a && (
                                        <span className="block text-[11px] text-[#4B5563] truncate">{row.a}</span>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

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
    /*
     * eBooks is a filter, not a category.
     *
     * A title is Law AND available as an eBook — the two are different
     * questions. Putting it in the category row would have one book in two
     * categories and stop the counts beside Law and Academic adding up, which
     * is the kind of arithmetic customers notice.
     *
     * It disappears entirely when eBooks are switched off in Admin → E-Books;
     * see EBOOK_FILTER_KEY below.
     */
    { key: "ebook", label: "Available as eBook", enabled: true },
];

/**
 * The filter above is gated on the same master switch as every other eBook
 * surface, so one toggle governs all of them rather than this screen keeping
 * its own opinion and drifting from the CTA and the product page.
 */
const EBOOK_FILTER_KEY = "ebook";
const ebooksOn = (site) => String(site?.ebook_enabled ?? "on").toLowerCase() !== "off";

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
    const subject = sp.get("subject") || "";
    const search = sp.get("search") || "";
    const sort = sp.get("sort") || "featured";

    // Admin-editable sort menu + filter toggles (fall back to defaults until loaded).
    const sortOptions =
        Array.isArray(settings?.plp_sort_options) && settings.plp_sort_options.length
            ? settings.plp_sort_options
            : DEFAULT_SORTS;
    const enabledFilters = (
        Array.isArray(settings?.plp_filters) ? settings.plp_filters : DEFAULT_FILTERS
    )
        .filter((f) => f && f.key && f.enabled !== false)
        // Dropped here rather than hidden in the markup, so the key is also
        // absent from the request params and the active-filter chips — a filter
        // that is off should leave no trace, not just no checkbox.
        .filter((f) => f.key !== EBOOK_FILTER_KEY || ebooksOn(site));

    /*
     * THE BOOKSTORE NO LONGER PRE-APPLIES A FILTER.
     *
     * /books used to quietly set category=professional on a fresh arrival. It
     * was a merchandising choice made when the categories lived in a sidebar
     * that a phone hides behind a Filters button — the default was the only way
     * most visitors ever saw a category at all. The row above the grid does
     * that job now, in the open, so the default has nothing left to buy and
     * costs a first-time visitor two-thirds of the catalogue.
     *
     * Removing it also makes /books honest: bare /books is the whole shop,
     * which is what its canonical URL, its prerendered HTML and its title have
     * always claimed. See isDefaultView below, which used to carry a special
     * case for exactly this.
     *
     * There is deliberately no effect here any more. The one that used to
     * follow this comment is what applied the default; the next effect down is
     * unrelated.
     */

    useEffect(() => {
        fetchCategories().then(setCats).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
    }, []);

    // Build the query params (category / search / active collection filters).
    const buildParams = useCallback(() => {
        const params = { sort };
        if (category) params.category = category;
        if (subject) params.subject = subject;
        if (search) params.search = search;
        enabledFilters.forEach((f) => {
            if (sp.get(f.key) === "true") params[f.key] = true;
        });
        return params;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sort, category, search, sp, settings]);

    // Catalogue index (titles + authors) used for "did you mean" when a search
    // returns nothing. Loaded lazily — only when we actually need it.
    const [indexBooks, setIndexBooks] = useState([]);

    // Reset + load the first page whenever filters / sort / settings change.
    useEffect(() => {
        let cancelled = false;
        busyRef.current = true;
        setLoading(true);
        setBooks([]);
        setHasMore(true);
        skipRef.current = 0;
        fetchBooksWithMeta({ ...buildParams(), skip: 0, limit: PAGE_SIZE })
            .then(({ items: data, correctedTo }) => {
                if (cancelled) return;
                setBooks(data);
                skipRef.current = data.length;
                setHasMore(data.length === PAGE_SIZE);
                /*
                 * Log the term AS TYPED with the count it TRULY matched.
                 *
                 * When the server corrected the spelling, the literal query
                 * matched nothing — logging data.length would file it as a
                 * successful search and erase it from the "found nothing"
                 * report. That report is the only place typo demand is visible;
                 * it is how this whole feature was found in the first place.
                 */
                if (search) logSearch(search, correctedTo ? 0 : data.length, category || null);

                /*
                 * The server fixed the spelling and told us to what. Kept
                 * separately from the client-side correction because the URL is
                 * NOT rewritten here — the visitor keeps the query they typed,
                 * and the results are already for the corrected one.
                 */
                setServerCorrection(correctedTo && data.length ? { from: search, to: correctedTo } : null);
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

    /*
     * Every title we sell, summed from the same counts the category row prints —
     * so the "All" tab can never disagree with the numbers beside it, and never
     * needs editing when the catalogue grows.
     */
    const catalogueTotal = useMemo(() => catalogueTotalFrom(cats), [cats]);

    // Bare /books gets the general all-imprint banner; every category gets its
    // own. There is no longer an exception, because there is no longer a
    // category masquerading as the landing page.
    const heroCat = activeCat;

    /*
     * Bare /books, with no category applied: the state the prerendered
     * build/books/index.html was baked in.
     *
     * This used to also count ?category=professional, because /books
     * auto-applied it and Vercel serves that same prerendered file for the
     * filtered URL — the filesystem match ignores query strings. If the baked
     * HTML said "Bookstore, canonical /books" while the hydrating app decided
     * the same URL was "Professional, canonical ?category=professional", React
     * would APPEND its versions rather than replace them and the page would
     * ship two conflicting canonicals, which Google discards outright.
     *
     * With the default gone the special case goes too: bare /books really is
     * the unfiltered shop, so the baked file and the app agree by construction
     * instead of by a matching pair of ternaries.
     */
    const isDefaultView = !activeCat;

    const update = (key, value) => {
        const next = new URLSearchParams(sp);
        if (!value) next.delete(key);
        else next.set(key, value);
        // Switching category clears any active sub-category (subject) filter.
        if (key === "category") next.delete("subject");
        /*
         * SEARCHING CLEARS THE CATEGORY. It is not a convenience, it is a bug fix.
         *
         * The bookstore no longer pre-applies a filter, so the original version
         * of this bug is gone — but the shape of it is not. A visitor who taps
         * Tax, then searches for a constitutional-law title, is asking for that
         * title, not for that title within Tax, and an empty shelf is a wrong
         * answer to the question they asked.
         *
         * The search log proved it: five terms, thirteen attempts, every one an
         * academic or exam-prep title hunted from inside Professional. Someone
         * typed the whole of "master guide to nta ugc net | set | jrf | phd
         * paper 1 (teaching and research aptitude),7/e" four times over and got
         * an empty shelf each time, for a title on the homepage.
         *
         * Typing a query is an explicit statement of intent and outranks a
         * default the visitor never asked for. Subject goes too, since it only
         * narrows further inside a category that is no longer applied.
         */
        if (key === "search" && value) {
            next.delete("category");
            next.delete("subject");
        }
        setSp(next, { replace: true });
    };

    const clearFilters = () => {
        setSp(new URLSearchParams(), { replace: true });
    };

    useEffect(() => {
        if (!loading && search && books.length === 0 && indexBooks.length === 0) {
            fetchSuggestIndex()
                .then((d) => setIndexBooks(d?.books || []))
                .catch(() => {});
        }
    }, [loading, search, books.length, indexBooks.length]);

    // Typo-tolerant suggestions. The previous version scored on substrings, so a
    // slip like "cconstitution" or "intermidiaries" matched nothing at all — the
    // search logs show those exact queries returning an empty shelf.
    const didYouMean = useMemo(
        () => (search && indexBooks.length ? fuzzySearch(indexBooks, search, 4) : []),
        [search, indexBooks],
    );

    /*
     * Auto-correct rather than dead-end. When a search finds nothing but the
     * catalogue clearly contains what was meant, re-run it with the corrected
     * spelling and say so — with a one-click way back to the literal search.
     * `triedRef` stops a correction that also finds nothing from looping.
     */
    const [correctedFrom, setCorrectedFrom] = useState(null);
    // {from, to} when the SERVER corrected the spelling. The URL still holds
    // what the visitor typed, so this is tracked separately from the
    // client-side correction above, which rewrites the URL to the fixed term.
    const [serverCorrection, setServerCorrection] = useState(null);
    const triedRef = useRef(new Set());

    useEffect(() => {
        if (loading || !search || books.length > 0 || indexBooks.length === 0) return;
        if (triedRef.current.has(search)) return;
        triedRef.current.add(search);
        const fixed = didYouMeanTerm(indexBooks, search);
        if (fixed && fixed !== search.toLowerCase().trim()) {
            triedRef.current.add(fixed);
            setCorrectedFrom(search);
            update("search", fixed);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, search, books.length, indexBooks.length]);

    // A fresh search by the user clears the "showing results for" notice.
    useEffect(() => {
        if (correctedFrom && search === correctedFrom) setCorrectedFrom(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    const activeFilters = useMemo(() => {
        const arr = [];
        if (category) arr.push({ k: "category", v: category, label: activeCat?.name || category });
        if (subject) arr.push({ k: "subject", v: "", label: subject });
        enabledFilters.forEach((f) => {
            if (sp.get(f.key) === "true") arr.push({ k: f.key, v: "", label: f.label });
        });
        if (search) arr.push({ k: "search", v: "", label: `"${search}"` });
        return arr;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [category, search, activeCat, sp, settings]);


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
            {/*
              * Bare /books IS the bookstore, and must say so.
              *
              * It once took its identity from whatever category happened to be
              * in the URL, so /books described itself as "Professional" and set
              * canonical to /books?category=professional — the main catalogue
              * URL, the one in the sitemap, telling Google it was a duplicate of
              * a filtered view of itself.
              *
              * Now that /books applies no category, the unfiltered page and the
              * unfiltered description are the same thing, and there is no
              * category id to special-case out of the canonical.
              */}
            <Seo
                title={isDefaultView ? (search ? `Search: ${search}` : "Bookstore") : activeCat.name}
                description={
                    isDefaultView
                        ? "Browse Oakbridge Publishing's full catalogue — law, tax, business, academic, reference, children's and test-prep titles."
                        : activeCat.description
                }
                /*
                 * Keyed on activeCat, NOT on the raw `category` string, and the
                 * difference is a live regression waiting to happen.
                 * ?category=professional is still published on the homepage
                 * imprint tile; `professional` is no longer a category, so
                 * `category` is truthy while activeCat is undefined. Keyed on the
                 * string, this page would title itself "Bookstore" (isDefaultView
                 * is true) but canonicalise to /books?category=professional --
                 * disagreeing with the prerendered build/books/index.html that
                 * Vercel serves for that URL, so React appends a second canonical
                 * and Google discards both. An unresolved category is not a view.
                 */
                path={activeCat ? `/books?category=${category}` : "/books"}
                /*
                 * An ItemList of what is actually rendered, in the order it is
                 * rendered, plus the trail. Books load in pages, so this
                 * describes the first screenful rather than the whole
                 * catalogue — a claim about 200 titles on a page showing 24
                 * would not match what is there.
                 */
                jsonLd={[
                    ...(books.length
                        ? [
                              itemListLd(books, {
                                  name: isDefaultView
                                      ? "Oakbridge Publishing — Bookstore"
                                      : activeCat.name,
                                  path: activeCat ? `/books?category=${category}` : "/books",
                              }),
                          ]
                        : []),
                    breadcrumbLd(
                        isDefaultView
                            ? [{ name: "Bookstore" }]
                            : [{ name: "Bookstore", path: "/books" }, { name: activeCat.name }],
                    ),
                ]}
            />
            {/* ============ HERO BANNER ============ */}
            <section
                data-testid="catalog-hero"
                className="relative overflow-hidden border-b border-[#E5E7EB]"
            >
                <div className="relative min-h-[320px] md:min-h-[400px]">
                    <img
                        {...responsiveImage(
                            mediaUrl(site.plp_banner) ||
                                "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=2000&q=85",
                            "100vw",
                            true,
                        )}
                        /* Decorative — see the note on the homepage hero. The
                           heading over it carries the meaning, and the banner
                           itself is admin-replaceable. */
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#002B5C]/95 via-[#002B5C]/70 to-[#002B5C]/35" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#002B5C]/30 to-transparent" />

                    <div className="relative px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-10 md:py-24 lg:py-28 text-white max-w-5xl">
                        <div className="overline !text-white/70 !text-[11px] fade-up">
                            {heroCat
                                ? "Imprint"
                                : search
                                  ? "Search Results"
                                  : (site.plp_hero_overline || "The Bookstore")}
                        </div>
                        <h1
                            data-testid="catalog-hero-title"
                            className="font-serif text-5xl md:text-6xl lg:text-7xl mt-5 leading-[0.95] fade-up"
                            style={{ animationDelay: "80ms" }}
                        >
                            {heroCat ? (
                                <>
                                    The{" "}
                                    <em className="text-[#F59E0B] not-italic">
                                        {heroCat.name}
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
                            ) : site.plp_hero_title ? (
                                <span className="whitespace-pre-line">{renderRich(site.plp_hero_title, "#F59E0B")}</span>
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
                            {heroCat?.description || site.plp_hero_body ||
                                "Browse authoritative reference titles, legal commentaries, curated thematic works and scholarly editions from Oakbridge Publishing — all in one place."}
                        </p>
                        {/* Editable in Admin → Pages → Bookstore. These were hardcoded
                            ("230+ titles"), which went stale the moment the catalogue
                            changed size. Clear a value to drop that stat. */}
                        {(site.plp_stat1_value || site.plp_stat2_value || site.plp_stat1_value === undefined) && (
                            <div
                                className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs font-mono uppercase tracking-widest text-white/60 fade-up"
                                style={{ animationDelay: "220ms" }}
                                data-testid="plp-hero-stats"
                            >
                                {(site.plp_stat1_value ?? "190+") && (
                                    <span>
                                        <span className="text-[#F59E0B] text-base font-sans tracking-tight mr-2">
                                            {site.plp_stat1_value ?? "190+"}
                                        </span>
                                        {site.plp_stat1_label || "titles"}
                                    </span>
                                )}
                                {(site.plp_stat2_value ?? "5") && (
                                    <span>
                                        <span className="text-[#F59E0B] text-base font-sans tracking-tight mr-2">
                                            {site.plp_stat2_value ?? "5"}
                                        </span>
                                        {site.plp_stat2_label || "imprints"}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* ============ CATEGORY ROW ============
                Full width, above the sidebar and the grid both, so it reads as
                the shop's own shelves rather than as one more filter. Same
                horizontal padding as the row below it. */}
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-6 md:pt-10">
                <CategoryRow
                    cats={cats}
                    active={category}
                    total={catalogueTotal || null}
                    onSelect={(id) => update("category", id)}
                />
            </div>

            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pb-6 md:pb-10 grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-10">
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
                            <CatalogSearch value={search} onSearch={(v) => update("search", v)} />
                        </div>

                        {/* The category list used to live here. It is a row above
                            the grid now -- see CategoryRow -- because on a phone
                            this sidebar is behind a Filters button most visitors
                            never press, which made the shop's own shelves the
                            hardest thing on the page to find. The Law/Tax
                            sub-list went with it: both are top-level categories
                            now, so there is nothing left to nest. */}

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
                    {/* E-book platform strip — above the listing so it reads as an
                        alternative format, not an advert. Hidden until configured. */}
                    <EbookCta variant="bar" site={site} className="mb-6" />

                    {/* Client-side correction: the URL was rewritten to the fixed
                        spelling, so `search` is the correction and correctedFrom
                        is what was typed. */}
                    {correctedFrom && books.length > 0 && (
                        <div
                            data-testid="catalog-autocorrect"
                            className="mb-6 border-l-2 border-[#F59E0B] bg-[#FFFBEB] pl-3 py-2.5 pr-3 text-sm text-[#002B5C]"
                        >
                            Showing results for <strong>{search}</strong>.{" "}
                            <button
                                onClick={() => update("search", correctedFrom)}
                                className="border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033]"
                            >
                                Search instead for “{correctedFrom}”
                            </button>
                        </div>
                    )}

                    {/* Server-side correction: the opposite way round. The URL
                        still holds what the visitor typed, and the results are
                        already for the corrected spelling — so there is nothing
                        to offer as "search instead", only a note that we did not
                        take them literally. */}
                    {!correctedFrom && serverCorrection && books.length > 0 && (
                        <div
                            data-testid="catalog-server-autocorrect"
                            className="mb-6 border-l-2 border-[#F59E0B] bg-[#FFFBEB] pl-3 py-2.5 pr-3 text-sm text-[#002B5C]"
                        >
                            No exact matches for <strong>“{serverCorrection.from}”</strong> — showing
                            results for <strong>“{serverCorrection.to}”</strong>.
                        </div>
                    )}

                    {/* The sidebar search is hidden below lg, which left phone users
                        with no way to search the catalogue at all. Same component,
                        surfaced above the Filters / Sort row. */}
                    <div className="lg:hidden mb-4" data-testid="catalog-search-mobile">
                        <CatalogSearch value={search} onSearch={(v) => update("search", v)} />
                    </div>

                    {/*
                      Phone: the count sits on its own line and the two controls
                      share a full-width row, so "24+ titles" can't wrap and the
                      buttons keep a 44px touch target. From sm up it collapses
                      back to a single justified row.
                    */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#E5E7EB] pb-4 mb-8">
                        <div
                            data-testid="catalog-count"
                            className="font-mono text-xs text-[#4B5563] whitespace-nowrap"
                        >
                            {loading
                                ? "Loading…"
                                : `${books.length}${hasMore ? "+" : ""} title${books.length === 1 ? "" : "s"}`}
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
                            <button
                                onClick={() => setShowFilters((s) => !s)}
                                data-testid="toggle-filters-mobile"
                                aria-expanded={showFilters}
                                className="lg:hidden inline-flex items-center justify-center gap-2 text-sm border border-[#E5E7EB] bg-white px-3 h-11 sm:h-9 min-w-0"
                            >
                                <SlidersHorizontal size={14} strokeWidth={1.5} className="flex-shrink-0" />
                                Filters
                            </button>
                            <select
                                value={sort}
                                onChange={(e) => update("sort", e.target.value)}
                                data-testid="catalog-sort"
                                aria-label="Sort books"
                                className="bg-white border border-[#E5E7EB] text-sm px-3 h-11 sm:h-9 w-full sm:w-auto min-w-0 outline-none focus:border-[#002B5C]"
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
                            className="py-14 px-6 md:px-10 border border-dashed border-[#E5E7EB] text-center"
                        >
                            <h3 className="font-serif text-3xl text-[#002B5C]">
                                {search ? <>No titles match “{search}”.</> : "No titles found."}
                            </h3>
                            <p className="text-sm text-[#4B5563] mt-2">
                                {search
                                    ? "It may be spelled differently, or we may not publish it yet."
                                    : "Try adjusting your filters."}
                            </p>

                            {didYouMean.length > 0 && (
                                <div className="mt-8">
                                    <div className="overline !text-[10px]">Did you mean</div>
                                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                                        {didYouMean.map((b) => (
                                            <Link
                                                key={b.id}
                                                to={`/books/${b.id}`}
                                                data-testid={`did-you-mean-${b.id}`}
                                                className="max-w-full inline-flex items-center gap-2 border border-[#002B5C] px-4 py-2 text-sm text-[#002B5C] hover:bg-[#F5F7FA] transition-colors"
                                            >
                                                <span className="truncate">{b.t}</span>
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {cats.length > 0 && (
                                <div className="mt-8">
                                    <div className="overline !text-[10px]">Or browse a category</div>
                                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                                        {cats.slice(0, 6).map((c) => (
                                            <Link
                                                key={c.id}
                                                to={`/books?category=${encodeURIComponent(c.slug || c.id)}`}
                                                className="border border-[#E5E7EB] px-4 py-2 text-sm text-[#4B5563] hover:border-[#002B5C] hover:text-[#002B5C] transition-colors"
                                            >
                                                {c.name}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-8 flex flex-wrap justify-center gap-3">
                                <Link
                                    to="/books"
                                    className="inline-flex items-center bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                                >
                                    Clear search &amp; browse all
                                </Link>
                                <Link
                                    to="/contact"
                                    className="inline-flex items-center border border-[#002B5C] text-[#002B5C] px-6 py-3 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                                >
                                    Ask us about a title
                                </Link>
                            </div>
                        </div>
                    )}

                    {/*
                     * A heading the grid can belong to.
                     *
                     * BookCard titles each book as an <h3>, so this page went
                     * straight from its <h1> to twenty-five <h3>s with nothing
                     * between them. Skipping a level is a small SEO smell and a
                     * real accessibility fault (WCAG 1.3.1): a screen-reader
                     * user skims by heading, and got a flat run of book titles
                     * with nothing above them saying what the list was.
                     *
                     * sr-only rather than visible, because the page already
                     * states what you are looking at through the hero and the
                     * filter bar — this is the same fact, said in the document
                     * structure, where assistive technology can reach it.
                     */}
                    <h2 className="sr-only">
                        {search
                            ? `Search results for "${search}"`
                            : activeCat
                              ? `${activeCat.name} titles`
                              : "All titles"}
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-10">
                        {books.map((b, i) => (
                            <BookCard
                                key={b.id}
                                book={b}
                                index={i}
                                /* Only while the eBook filter is on. Off it,
                                   these are ordinary cards going to ordinary
                                   product pages. */
                                toEbook={sp.get(EBOOK_FILTER_KEY) === "true" && ebooksOn(site)}
                            />
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
