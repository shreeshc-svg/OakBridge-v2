import React, { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import NoIndex from "../components/NoIndex";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import BookCard from "../components/BookCard";
import { fetchAuthor, fetchAuthorBooks, fetchAuthors, fetchSiteContent, fetchSettings, mediaUrl } from "../lib/api";

const AUTHORS_DEFAULTS = {
    overline: "Our Authors",
    title: "The scholars, teachers\nand storytellers\nbehind our list.",
};

function AuthorDetail({ id }) {
    const [author, setAuthor] = useState(null);
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);

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
                title={author.name}
                description={
                    (author.bio || `Books by ${author.name}, published by Oakbridge Publishing.`).slice(0, 160)
                }
                path={`/authors/${id}`}
                image={author.photo ? mediaUrl(author.photo) : undefined}
                type="profile"
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
                            <div className="overline">Selected Works</div>
                            <h2 className="font-serif text-3xl mt-2 text-[#002B5C]">
                                Books by {author.name.split(" ").slice(-1)[0]}
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

function AuthorsIndex() {
    const [authors, setAuthors] = useState([]);
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState({});

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
            />
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-16 border-b border-[#E5E7EB]">
                <div className="overline">{site.authors_overline || AUTHORS_DEFAULTS.overline}</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-3xl whitespace-pre-line">
                    {site.authors_title || AUTHORS_DEFAULTS.title}
                </h1>
            </section>

            {grouped ? (
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
