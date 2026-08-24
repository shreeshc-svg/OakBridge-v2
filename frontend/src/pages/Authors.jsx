import React, { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import NoIndex from "../components/NoIndex";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import BookCard from "../components/BookCard";
import { fetchAuthor, fetchAuthorBooks, fetchAuthors, fetchSiteContent, fetchSettings, mediaUrl } from "../lib/api";
import { fold, fuzzySearch, didYouMean } from "../lib/fuzzy";
import { personLd, breadcrumbLd, metaDescription } from "../lib/schema";

const AUTHORS_DEFAULTS = {
    overline: "Our Authors",
    title: "The scholars, teachers\nand storytellers\nbehind our list.",
    worksOverline: "Selected Works",
    // Full name by default. {surname} still works for anyone who prefers the
    // shorter form — the token handling below is unchanged.
    worksTitle: "Books by {name}",
};

/**
 * Fill {surname} and {name} in an admin-written heading.
 *
 * One string has to serve 143 author pages, so the surname is a token rather
 * than typed. "Dr Justice Shalini Phansalkar Joshi" -> "Joshi", which is what
 * the hardcoded version produced.
 *
 * Taking the last word blindly is not enough, and your own author list proves
 * it three ways:
 *
 *   "Dr K K Khandelwal, IAS (R)"  -> the last word is "R"      (not Khandelwal)
 *   "Saji Narayanan C K"          -> the last word is "K"      (not Narayanan)
 *   "Sandhya P.R."                -> the last word is "P.R."   (not Sandhya)
 *
 * So trailing tokens are dropped while they are either a post-nominal (IAS,
 * ICAS, Retd.) or an initial — one or two letters once dots are removed. Never
 * the last remaining word, so a single-name author like "Daksh" survives.
 *
 * A template with no token is returned untouched, so an editor who prefers a
 * plain heading just writes one.
 */
const NAME_SUFFIXES = /^(ias|ips|irs|icas|ifs|retd|advocate|jr|sr|ii|iii|phd|llm)\.?$/i;
const IS_INITIAL = (w) => /^[a-z]{1,2}$/i.test(w.replace(/\./g, ""));
function fillAuthorTokens(template, fullName) {
    const parts = String(fullName || "")
        .replace(/[(),]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    while (
        parts.length > 1 &&
        (NAME_SUFFIXES.test(parts[parts.length - 1]) || IS_INITIAL(parts[parts.length - 1]))
    ) {
        parts.pop();
    }
    const surname = parts.length ? parts[parts.length - 1] : String(fullName || "");
    return String(template || "")
        .replace(/\{surname\}/gi, surname)
        .replace(/\{name\}/gi, String(fullName || ""));
}

function AuthorDetail({ id }) {
    const [author, setAuthor] = useState(null);
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [site, setSite] = useState({});

    useEffect(() => {
        setLoading(true);
        Promise.all([fetchAuthor(id), fetchAuthorBooks(id)])
            .then(([a, b]) => {
                setAuthor(a);
                setBooks(b);
            })
            .catch(() => setAuthor(null))
            .finally(() => setLoading(false));
    }, [id]);

    /*
     * Site content is fetched separately, and deliberately NOT awaited with the
     * author above.
     *
     * The headings below fall back to their defaults the instant this component
     * renders, so a slow or failed settings call costs nothing — the page still
     * says "Selected Works". Folding it into the Promise.all would make the
     * whole author page wait on a copy tweak, and a rejection there would take
     * the author down with it.
     */
    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);

    if (loading) {
        return (
            <div className="py-32 text-center font-mono text-xs text-[#4B5563]">
                Loading…
            </div>
        );
    }
    if (!author) {
        return (
            <div className="py-32 text-center">
                {/* Same gap as the book page: no title source, so a dead author
                    URL inherited whatever was there before, and was indexable. */}
                <NoIndex title="Author not found" />
                <h1 className="font-serif text-4xl text-[#002B5C]">
                    Author not found.
                </h1>
                <Link
                    to="/authors"
                    className="mt-6 inline-flex border-b border-[#002B5C] text-sm pb-0.5"
                >
                    Back to authors
                </Link>
            </div>
        );
    }

    return (
        <div data-testid="author-detail">
            {/* Without this the author pages were the ONLY routed pages on the
                site with no title source at all. That was survivable while
                index.html carried a static one; it is not now that the static
                title has gone, and the prerenderer waits for document.title
                before capturing — so these pages would have timed out and
                shipped the empty shell. */}
            <Seo
                /* "Name — Books" rather than the bare name: the query these
                   pages can realistically win is "<author> books", and the
                   title tag is the strongest signal of what a page answers. */
                title={`${author.name} — Books`}
                description={metaDescription(
                    author.bio ||
                        `Books by ${author.name}, published by Oakbridge Publishing.`,
                )}
                path={`/authors/${id}`}
                image={author.photo ? mediaUrl(author.photo) : undefined}
                type="profile"
                /* These pages carried no structured data at all. A Person with
                   their works is exactly what they are, and it is the thing
                   that lets Google treat the author as an entity rather than
                   as a string that happens to appear on some book pages. */
                jsonLd={[
                    personLd(
                        {
                            id,
                            name: author.name,
                            bio: author.bio,
                            photoUrl: author.photo ? mediaUrl(author.photo) : "",
                        },
                        books,
                    ),
                    breadcrumbLd([
                        { name: "Authors", path: "/authors" },
                        { name: author.name },
                    ]),
                ]}
            />
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-10">
                <Link
                    to="/authors"
                    className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#4B5563] hover:text-[#002B5C]"
                >
                    <ArrowLeft size={12} strokeWidth={1.5} /> All authors
                </Link>
            </div>
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12">
                <div className="lg:col-span-4">
                    <div className="sticky top-24">
                        <div className="aspect-square max-w-[260px] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden rounded-sm">
                            {author.photo ? (
                                <img
                                    src={mediaUrl(author.photo) || author.photo}
                                    alt={author.name}
                                    width="200"
                                    height="200"
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center font-serif text-5xl text-[#002B5C]/40">
                                    {(author.name || "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                                </div>
                            )}
                        </div>
                        <dl className="mt-6 space-y-3 text-sm">
                            <div className="flex justify-between border-b border-[#E5E7EB] pb-2">
                                <dt className="overline !text-[10px]">Specialty</dt>
                                <dd className="text-[#002B5C]">{author.specialty}</dd>
                            </div>
                            <div className="flex justify-between border-b border-[#E5E7EB] pb-2">
                                <dt className="overline !text-[10px]">Affiliation</dt>
                                <dd className="text-[#002B5C]">{author.affiliation}</dd>
                            </div>
                            <div className="flex justify-between border-b border-[#E5E7EB] pb-2">
                                <dt className="overline !text-[10px]">Titles</dt>
                                <dd className="font-mono text-[#002B5C]">
                                    {books.length}
                                </dd>
                            </div>
                        </dl>
                    </div>
                </div>
                <div className="lg:col-span-8">
                    <div className="overline">Author</div>
                    <h1 className="font-serif text-5xl md:text-6xl mt-3 text-[#002B5C] leading-none">
                        {author.name}
                    </h1>
                    <p className="mt-8 text-[#4B5563] leading-relaxed text-lg font-serif italic">
                        {author.bio}
                    </p>
                    {books.length > 0 && (
                        <div className="mt-14">
                            {/* Editable in Admin -> Pages -> Authors. {surname}
                                and {name} are filled in per author, so one
                                string covers every author page. */}
                            <div className="overline">
                                {site.authors_works_overline || AUTHORS_DEFAULTS.worksOverline}
                            </div>
                            <h2 className="font-serif text-3xl mt-2 text-[#002B5C]">
                                {fillAuthorTokens(
                                    site.authors_works_title || AUTHORS_DEFAULTS.worksTitle,
                                    author.name,
                                )}
                            </h2>
                            <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-10">
                                {books.map((b, i) => (
                                    <BookCard key={b.id} book={b} index={i} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

// Tailwind can't see class names built at runtime, so the per-row counts are
// spelled out here for the JIT compiler to pick up.
const AUTHOR_GRID_COLS = {
    3: "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
};

// Author photos from the old site are all 200x200. Displaying them full-bleed in
// a tall tile upscaled and cropped them (soft + zoomed). Instead we frame them as
// a centred square avatar capped near native size, so they stay crisp and the tile
// has breathing room around the portrait.
function initials(name) {
    return (name || "")
        .replace(/\b(Dr|Prof|Mr|Mrs|Ms|Justice|CA|CS|IAS|IPS|IRS|Adv|Maj|Gen)\b\.?/gi, "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
}

function AuthorTile({ a, idx, hideSpecialty = false }) {
    const photo = mediaUrl(a.photo) || a.photo;
    return (
        <Link
            to={`/authors/${a.id}`}
            data-testid={`author-tile-${a.id}`}
            className="group block text-center"
        >
            <div className="relative mx-auto w-full max-w-[190px]">
                <div className="aspect-square bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden rounded-sm">
                    {photo ? (
                        <img
                            src={photo}
                            alt={a.name}
                            loading="lazy"
                            width="200"
                            height="200"
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center font-serif text-3xl text-[#002B5C]/40">
                            {initials(a.name)}
                        </div>
                    )}
                </div>
                <div className="absolute top-2 left-2 font-mono text-[10px] text-white/90 uppercase tracking-widest bg-[#002B5C]/70 px-1.5 py-0.5">
                    {String(idx + 1).padStart(2, "0")}
                </div>
            </div>
            <div className="mt-4">
                {!hideSpecialty && a.specialty && <div className="overline !text-[10px]">{a.specialty}</div>}
                <h3 className="font-serif text-lg xl:text-xl mt-1.5 text-[#002B5C] group-hover:text-[#CC0033] transition-colors leading-tight">
                    {a.name}
                </h3>
                {a.affiliation && <p className="text-xs text-[#4B5563] mt-1">{a.affiliation}</p>}
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium border-b border-[#002B5C] pb-0.5">
                    Read more <ArrowUpRight size={12} strokeWidth={1.5} />
                </span>
            </div>
        </Link>
    );
}

// A horizontal author rail with arrows and optional auto-rotation. Advances one
// tile per tick, loops to the start at the end, and pauses on hover/touch.
function AuthorRail({ authors, title, startIdx = 0, autoplay, seconds, hideSpecialty = false }) {
    const railRef = useRef(null);

    const scroll = (dir) => {
        const el = railRef.current;
        if (!el) return;
        const first = el.children[0];
        const step = first ? first.getBoundingClientRect().width + 24 : el.clientWidth * 0.5;
        el.scrollBy({ left: dir * step, behavior: "smooth" });
    };

    useEffect(() => {
        const el = railRef.current;
        if (!autoplay || !el || authors.length <= 1) return undefined;
        let paused = false;
        const pause = () => { paused = true; };
        const resume = () => { paused = false; };
        el.addEventListener("mouseenter", pause);
        el.addEventListener("mouseleave", resume);
        el.addEventListener("touchstart", pause, { passive: true });
        const every = Math.max(2, Number(seconds) || 4) * 1000;
        const iv = setInterval(() => {
            if (paused) return;
            const first = el.children[0];
            const step = first ? first.getBoundingClientRect().width + 24 : el.clientWidth * 0.5;
            const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
            el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: "smooth" });
        }, every);
        return () => {
            clearInterval(iv);
            el.removeEventListener("mouseenter", pause);
            el.removeEventListener("mouseleave", resume);
            el.removeEventListener("touchstart", pause);
        };
    }, [autoplay, seconds, authors.length]);

    if (authors.length === 0) return null;

    return (
        <section className="pb-16 border-t border-[#E5E7EB] pt-10">
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 flex items-end justify-between gap-4">
                <h2 className="font-serif text-2xl md:text-3xl text-[#002B5C]">{title}</h2>
                <div className="hidden md:flex items-center gap-2">
                    <button onClick={() => scroll(-1)} aria-label="Scroll left" className="p-2 border border-[#E5E7EB] hover:border-[#002B5C] transition-colors">
                        <ChevronLeft size={16} strokeWidth={1.5} />
                    </button>
                    <button onClick={() => scroll(1)} aria-label="Scroll right" className="p-2 border border-[#E5E7EB] hover:border-[#002B5C] transition-colors">
                        <ChevronRight size={16} strokeWidth={1.5} />
                    </button>
                </div>
            </div>
            <div
                ref={railRef}
                className="mt-6 flex gap-6 xl:gap-8 overflow-x-auto snap-x scroll-smooth px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {authors.map((a, i) => (
                    <div key={a.id} className="snap-start flex-shrink-0 w-[46%] sm:w-[38%] lg:w-[30%] xl:w-[23%]">
                        <AuthorTile a={a} idx={startIdx + i} hideSpecialty={hideSpecialty} />
                    </div>
                ))}
            </div>
        </section>
    );
}

const authorGroupKey = (a) => ((a.category || a.specialty || "").trim() || "Other");

/**
 * Search across the author list.
 *
 * Runs entirely in the browser: the page already holds every author, so there
 * is no request to make and results land on the keystroke. Matching is
 * deliberately forgiving, because the names here are exactly the ones people
 * get slightly wrong — honorifics, initials, transliterated spellings.
 *
 *   case + accent      "khandelwal" finds "K K Khandelwal"
 *   punctuation        "kk khandelwal" finds "K K Khandelwal"
 *   any field          name, specialty, affiliation and bio
 *   any word order     "khandelwal kk" works too
 *   typos             "khandelwl" still finds him, via fuzzySearch
 *   did-you-mean       offers the nearest real spelling when nothing matches
 *
 * fuzzySearch/didYouMean are the same helpers the bookstore search uses. They
 * expect a {t, a} shape, so authors are mapped onto it rather than having a
 * second typo-matching implementation grow alongside the first.
 */
function useAuthorSearch(authors, query) {
    return React.useMemo(() => {
        const q = (query || "").trim();
        if (!q) return { results: authors, active: false, suggestion: null };

        const nq = fold(q);
        const words = nq.split(" ").filter(Boolean);
        const hay = (a) =>
            fold(`${a.name || ""} ${a.specialty || ""} ${a.affiliation || ""} ${a.category || ""} ${a.bio || ""}`);
        // Same text with every separator removed. This is what makes initials
        // work: the list stores "K K Khandelwal", and almost nobody types the
        // spaces — they type "KK Khandelwal". Against the spaced haystack the
        // word "kk" matches nothing at all, so that search returned zero for a
        // name we very much have. Matching either form fixes it in both
        // directions, and "khandelwal kk" too, since each word is tested
        // independently of order.
        const tight = (s) => s.replace(/[^a-z0-9]/g, "");

        /*
         * Every word must appear somewhere, in any order and any field.
         *
         * A single letter is matched as a WHOLE WORD, never as a substring.
         * Under substring matching "k" appears inside half the list — searching
         * "C K" for Saji Narayanan C K returned every author with a c or a k
         * anywhere in their name, specialty or bio. Requiring initials to be
         * real words keeps "K K Khandelwal" and "C K" precise, while words of
         * two or more characters still match loosely.
         */
        let results = authors.filter((a) => {
            const h = hay(a);
            const ht = tight(h);
            const hWords = h.split(" ").filter(Boolean);
            return words.every((w) =>
                w.length === 1 ? hWords.includes(w) : h.includes(w) || ht.includes(tight(w)),
            );
        });

        let suggestion = null;
        if (!results.length) {
            // Nothing literal — allow typos.
            const shaped = authors.map((a) => ({
                id: a.id,
                t: a.name || "",
                a: `${a.specialty || ""} ${a.affiliation || ""}`,
            }));
            const fuzzy = fuzzySearch(shaped, q, 24);
            const ids = new Set(fuzzy.map((f) => f.id));
            results = authors.filter((a) => ids.has(a.id));
            if (!results.length) suggestion = didYouMean(shaped, q);
        }

        // Exact name matches first — searching a surname should not bury the
        // person behind everyone who merely mentions them in a bio.
        const scored = results.map((a) => {
            const name = fold(a.name || "");
            const nameTight = tight(name);
            let rank = 4;
            if (name === nq || nameTight === tight(nq)) rank = 0;
            else if (name.startsWith(nq) || nameTight.startsWith(tight(nq))) rank = 1;
            else if (words.every((w) => name.includes(w))) rank = 2;
            else if (words.every((w) => nameTight.includes(tight(w)))) rank = 3;
            return { a, rank };
        });
        scored.sort((x, y) => x.rank - y.rank || (x.a.name || "").localeCompare(y.a.name || ""));

        return { results: scored.map((s) => s.a), active: true, suggestion };
    }, [authors, query]);
}

function AuthorSearch({ value, onChange, count, total, suggestion, onSuggestion }) {
    const inputRef = React.useRef(null);
    return (
        <div className="mt-8 max-w-xl">
            <div className="relative">
                <Search
                    size={16}
                    strokeWidth={1.5}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563] pointer-events-none"
                />
                <input
                    ref={inputRef}
                    type="search"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && onChange("")}
                    placeholder="Search authors by name, subject or institution"
                    aria-label="Search authors"
                    data-testid="authors-search-input"
                    className="w-full border border-[#E5E7EB] bg-white pl-10 pr-10 py-3 text-sm outline-none focus:border-[#002B5C] transition-colors"
                />
                {value && (
                    <button
                        onClick={() => {
                            onChange("");
                            inputRef.current?.focus();
                        }}
                        aria-label="Clear search"
                        data-testid="authors-search-clear"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4B5563] hover:text-[#CC0033]"
                    >
                        <X size={15} strokeWidth={1.75} />
                    </button>
                )}
            </div>

            {value.trim() && (
                <p className="mt-2 text-xs text-[#4B5563]" data-testid="authors-search-count" aria-live="polite">
                    {count > 0 ? (
                        <>
                            {count} of {total} author{total === 1 ? "" : "s"}
                        </>
                    ) : (
                        <>
                            No authors match “{value.trim()}”.
                            {suggestion && (
                                <>
                                    {" "}Did you mean{" "}
                                    <button
                                        onClick={() => onSuggestion(suggestion)}
                                        data-testid="authors-search-suggestion"
                                        className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033]"
                                    >
                                        {suggestion}
                                    </button>
                                    ?
                                </>
                            )}
                        </>
                    )}
                </p>
            )}
        </div>
    );
}

function AuthorsIndex() {
    const [authors, setAuthors] = useState([]);
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState({});
    const [query, setQuery] = useState("");
    const { results, active: searching, suggestion } = useAuthorSearch(authors, query);

    useEffect(() => {
        fetchAuthors().then(setAuthors);
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
    }, []);

    const perRow = AUTHOR_GRID_COLS[settings.authors_per_row] ? settings.authors_per_row : 4;
    const gridRows = Number.isFinite(settings.authors_grid_rows) ? Math.max(0, settings.authors_grid_rows) : 2;
    const autoplay = settings.authors_carousel_autoplay !== false;
    const seconds = Number(settings.authors_carousel_seconds) || 4;
    const grouped = settings.authors_layout === "grouped";

    // Grouped layout: one auto-rotating rail per category, in the admin's order.
    let groupSections = [];
    if (grouped) {
        const groups = {};
        authors.forEach((a) => { (groups[authorGroupKey(a)] ||= []).push(a); });
        const order = Array.isArray(settings.authors_category_order) ? settings.authors_category_order : [];
        const ordered = order.filter((k) => groups[k]);
        const rest = Object.keys(groups).filter((k) => !order.includes(k)).sort();
        groupSections = [...ordered, ...rest].map((k) => ({ title: k, items: groups[k] }));
    }

    // Grid layout: a grid then an overflow rail.
    const gridCount = gridRows === 0 ? authors.length : perRow * gridRows;
    const gridAuthors = authors.slice(0, gridCount);
    const railAuthors = authors.slice(gridCount);

    return (
        <div data-testid="authors-index">
            <Breadcrumbs items={[{ label: "Authors" }]} />
            <Seo
                title="Authors"
                description="Meet the scholars, practitioners and subject-matter experts who write for Oakbridge Publishing."
                path="/authors"
                jsonLd={breadcrumbLd([{ name: "Authors" }])}
            />
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-16 border-b border-[#E5E7EB]">
                <div className="overline">{site.authors_overline || AUTHORS_DEFAULTS.overline}</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-3xl whitespace-pre-line">
                    {site.authors_title || AUTHORS_DEFAULTS.title}
                </h1>
                <AuthorSearch
                    value={query}
                    onChange={setQuery}
                    count={results.length}
                    total={authors.length}
                    suggestion={suggestion}
                    onSuggestion={setQuery}
                />
            </section>

            {/* While searching, results replace the configured layout entirely.
                Category rails and the "More from our list" overflow carousel are
                merchandising for browsing; someone who has typed a name wants a
                single flat list of matches, not their matches scattered across
                three auto-rotating carousels. */}
            {searching ? (
                <section
                    data-testid="authors-search-results"
                    className={`px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-12 pb-20 grid gap-x-6 gap-y-10 xl:gap-x-8 ${AUTHOR_GRID_COLS[perRow]}`}
                >
                    {results.map((a, idx) => (
                        <AuthorTile key={a.id} a={a} idx={idx} />
                    ))}
                </section>
            ) : grouped ? (
                <div data-testid="authors-grouped" className="pt-4">
                    {groupSections.map((g) => (
                        <AuthorRail key={g.title} title={g.title} authors={g.items} autoplay={autoplay} seconds={seconds} hideSpecialty />
                    ))}
                </div>
            ) : (
                <>
                    <section
                        data-testid="authors-grid"
                        className={`px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-16 ${railAuthors.length ? "pb-10" : "pb-20"} grid gap-x-6 gap-y-10 xl:gap-x-8 ${AUTHOR_GRID_COLS[perRow]}`}
                    >
                        {gridAuthors.map((a, idx) => (
                            <AuthorTile key={a.id} a={a} idx={idx} />
                        ))}
                    </section>
                    {railAuthors.length > 0 && (
                        <div data-testid="authors-carousel">
                            <AuthorRail
                                title={settings.authors_carousel_title || "More from our list"}
                                authors={railAuthors}
                                startIdx={gridCount}
                                autoplay={autoplay}
                                seconds={seconds}
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default function Authors() {
    const { id } = useParams();
    if (id) return <AuthorDetail id={id} />;
    return <AuthorsIndex />;
}
