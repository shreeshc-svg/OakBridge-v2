import React, { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
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
                        <div className="aspect-[3/4] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                            <img
                                src={mediaUrl(author.photo) || author.photo}
                                alt={author.name}
                                className="w-full h-full object-cover"
                            />
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

function AuthorTile({ a, idx }) {
    return (
        <Link
            to={`/authors/${a.id}`}
            data-testid={`author-tile-${a.id}`}
            className="group block"
        >
            <div className="relative aspect-[3/4] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                <img
                    src={mediaUrl(a.photo) || a.photo}
                    alt={a.name}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute top-3 left-3 font-mono text-[10px] text-white/90 uppercase tracking-widest bg-[#002B5C]/70 px-2 py-1">
                    {String(idx + 1).padStart(2, "0")}
                </div>
            </div>
            <div className="mt-3">
                <div className="overline !text-[10px]">{a.specialty}</div>
                <h3 className="font-serif text-xl xl:text-2xl mt-1.5 text-[#002B5C] group-hover:text-[#CC0033] transition-colors">
                    {a.name}
                </h3>
                <p className="text-xs text-[#4B5563] mt-1">{a.affiliation}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium border-b border-[#002B5C] pb-0.5">
                    Read more <ArrowUpRight size={12} strokeWidth={1.5} />
                </span>
            </div>
        </Link>
    );
}

function AuthorsIndex() {
    const [authors, setAuthors] = useState([]);
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState({});
    const railRef = useRef(null);

    useEffect(() => {
        fetchAuthors().then(setAuthors);
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
    }, []);

    const perRow = AUTHOR_GRID_COLS[settings.authors_per_row] ? settings.authors_per_row : 4;
    const gridRows = Number.isFinite(settings.authors_grid_rows)
        ? Math.max(0, settings.authors_grid_rows)
        : 2;
    // 0 rows means "no carousel" — show the whole list as a grid.
    const gridCount = gridRows === 0 ? authors.length : perRow * gridRows;
    const gridAuthors = authors.slice(0, gridCount);
    const railAuthors = authors.slice(gridCount);

    const scrollRail = (dir) => {
        const el = railRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
    };

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
            <section
                data-testid="authors-grid"
                className={`px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-16 ${railAuthors.length ? "pb-10" : "pb-20"} grid gap-x-6 gap-y-10 xl:gap-x-8 ${AUTHOR_GRID_COLS[perRow]}`}
            >
                {gridAuthors.map((a, idx) => (
                    <AuthorTile key={a.id} a={a} idx={idx} />
                ))}
            </section>

            {railAuthors.length > 0 && (
                <section
                    data-testid="authors-carousel"
                    className="pb-20 border-t border-[#E5E7EB] pt-10"
                >
                    <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 flex items-end justify-between gap-4">
                        <h2 className="font-serif text-2xl md:text-3xl text-[#002B5C]">
                            {settings.authors_carousel_title || "More from our list"}
                        </h2>
                        {/* Arrows are a desktop affordance; touch devices swipe. */}
                        <div className="hidden md:flex items-center gap-2">
                            <button
                                onClick={() => scrollRail(-1)}
                                aria-label="Scroll left"
                                className="p-2 border border-[#E5E7EB] hover:border-[#002B5C] transition-colors"
                            >
                                <ChevronLeft size={16} strokeWidth={1.5} />
                            </button>
                            <button
                                onClick={() => scrollRail(1)}
                                aria-label="Scroll right"
                                className="p-2 border border-[#E5E7EB] hover:border-[#002B5C] transition-colors"
                            >
                                <ChevronRight size={16} strokeWidth={1.5} />
                            </button>
                        </div>
                    </div>
                    {/*
                      Scroll padding matches the page gutters so the first and last
                      tiles line up with the grid above instead of hugging the edge.
                    */}
                    <div
                        ref={railRef}
                        className="mt-6 flex gap-6 xl:gap-8 overflow-x-auto snap-x snap-mandatory scroll-smooth px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {railAuthors.map((a, i) => (
                            <div
                                key={a.id}
                                className="snap-start flex-shrink-0 w-[46%] sm:w-[38%] lg:w-[30%] xl:w-[23%]"
                            >
                                <AuthorTile a={a} idx={gridCount + i} />
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

export default function Authors() {
    const { id } = useParams();
    if (id) return <AuthorDetail id={id} />;
    return <AuthorsIndex />;
}
