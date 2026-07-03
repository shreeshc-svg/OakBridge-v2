import React, { useEffect, useState } from "react";
import Seo from "../components/Seo";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import BookCard from "../components/BookCard";
import { fetchAuthor, fetchAuthorBooks, fetchAuthors } from "../lib/api";

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
            <div className="px-6 md:px-12 lg:px-16 pt-10">
                <Link
                    to="/authors"
                    className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#4B5563] hover:text-[#002B5C]"
                >
                    <ArrowLeft size={12} strokeWidth={1.5} /> All authors
                </Link>
            </div>
            <section className="px-6 md:px-12 lg:px-16 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12">
                <div className="lg:col-span-4">
                    <div className="sticky top-24">
                        <div className="aspect-[3/4] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                            <img
                                src={author.photo}
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

function AuthorsIndex() {
    const [authors, setAuthors] = useState([]);
    useEffect(() => {
        fetchAuthors().then(setAuthors);
    }, []);

    return (
        <div data-testid="authors-index">
            <Seo
                title="Authors"
                description="Meet the scholars, practitioners and subject-matter experts who write for Oakbridge Publishing."
                path="/authors"
            />
            <section className="px-6 md:px-12 lg:px-16 pt-20 pb-16 border-b border-[#E5E7EB]">
                <div className="overline">Our Authors</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-3xl">
                    The scholars, teachers
                    <br />
                    and storytellers
                    <br />
                    behind our list.
                </h1>
            </section>
            <section className="px-6 md:px-12 lg:px-16 py-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {authors.map((a, idx) => (
                    <Link
                        key={a.id}
                        to={`/authors/${a.id}`}
                        data-testid={`author-tile-${a.id}`}
                        className="group block"
                    >
                        <div className="relative aspect-[3/4] bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                            <img
                                src={a.photo}
                                alt={a.name}
                                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <div className="absolute top-4 left-4 font-mono text-[10px] text-white/90 uppercase tracking-widest bg-[#002B5C]/70 px-2 py-1">
                                {String(idx + 1).padStart(2, "0")}
                            </div>
                        </div>
                        <div className="mt-4">
                            <div className="overline !text-[10px]">
                                {a.specialty}
                            </div>
                            <h3 className="font-serif text-2xl mt-2 text-[#002B5C] group-hover:text-[#CC0033] transition-colors">
                                {a.name}
                            </h3>
                            <p className="text-xs text-[#4B5563] mt-1">
                                {a.affiliation}
                            </p>
                            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium border-b border-[#002B5C] pb-0.5">
                                Read more <ArrowUpRight size={12} strokeWidth={1.5} />
                            </span>
                        </div>
                    </Link>
                ))}
            </section>
        </div>
    );
}

export default function Authors() {
    const { id } = useParams();
    if (id) return <AuthorDetail id={id} />;
    return <AuthorsIndex />;
}
