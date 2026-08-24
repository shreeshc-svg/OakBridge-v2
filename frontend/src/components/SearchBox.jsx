import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Clock, BookOpen, User } from "lucide-react";
import { fetchSuggestIndex, fetchAuthors } from "../lib/api";
import { fuzzySearch } from "../lib/fuzzy";

/**
 * Search box with autocomplete and recent searches.
 *
 * The whole catalogue (a couple of hundred titles) is fetched once and cached in
 * module scope, so matching happens in the browser — suggestions are instant and
 * there is no request per keystroke.
 *
 * Recent searches live in localStorage only. Nothing about an individual is sent
 * to the server; the separate search log records the query and result count alone.
 */

const RECENT_KEY = "oakbridge_recent_searches";
const MAX_RECENT = 5;
const MAX_SUGGESTIONS = 7;

// module-level cache — one fetch per page load, shared by every SearchBox
let indexCache = null;
let indexPromise = null;
export function loadIndex() {
    if (indexCache) return Promise.resolve(indexCache);
    if (!indexPromise) {
        indexPromise = fetchSuggestIndex()
            .then((d) => {
                indexCache = d?.books || [];
                return indexCache;
            })
            .catch(() => []);
    }
    return indexPromise;
}

/**
 * Authors, shaped like the book index so the same matcher works on both.
 *
 * Kept SEPARATE from loadIndex() on purpose. The Bookstore's own search box
 * shares that index, and folding authors into it would make the bookstore
 * suggest people and then try to open them as books — /books/<authorId>, a
 * "Book not found." for every click. Only the header merges the two.
 *
 * `kind` is what tells a suggestion where it leads.
 */
let authorCache = null;
let authorPromise = null;
function loadAuthorIndex() {
    if (authorCache) return Promise.resolve(authorCache);
    if (!authorPromise) {
        authorPromise = fetchAuthors()
            .then((list) => {
                authorCache = (Array.isArray(list) ? list : []).map((a) => ({
                    kind: "author",
                    id: a.id,
                    t: a.name || "",
                    a: [a.specialty, a.affiliation].filter(Boolean).join(" · "),
                }));
                return authorCache;
            })
            .catch(() => []);
    }
    return authorPromise;
}

export function readRecent() {
    try {
        const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        return Array.isArray(v) ? v.slice(0, MAX_RECENT) : [];
    } catch {
        return [];
    }
}

export function pushRecent(q) {
    const term = (q || "").trim();
    if (!term) return;
    try {
        const next = [term, ...readRecent().filter((x) => x.toLowerCase() !== term.toLowerCase())];
        localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, MAX_RECENT)));
    } catch {
        /* storage unavailable (private mode) — recent searches simply don't persist */
    }
}

/**
 * Fold a string for comparison: case, curly apostrophes, and ALL punctuation —
 * so "978-93-9576-4544" matches "9789395764544" and "e-commerce" matches
 * "e commerce". Mirrors the tolerance the backend applies server-side.
 */
const norm = (s) =>
    (s || "").toLowerCase().replace(/['']/g, "'").replace(/[^0-9a-z]+/g, "");

/** Titles/authors matching `q`, prefix hits first. Shared by the header and the Bookstore. */
export function suggestFrom(books, q, max = MAX_SUGGESTIONS) {
    const term = norm(q);
    if (term.length < 2) return [];
    const starts = [];
    const contains = [];
    for (const b of books) {
        const t = norm(b.t);
        const a = norm(b.a);
        if (t.startsWith(term) || a.startsWith(term)) starts.push(b);
        else if (t.includes(term) || a.includes(term)) contains.push(b);
        if (starts.length >= max) break;
    }
    const exact = [...starts, ...contains];
    if (exact.length) return exact.slice(0, max);
    // Nothing matched literally — offer the closest titles rather than an empty
    // dropdown, so a typo still leads somewhere.
    return fuzzySearch(books, q, max);
}

export default function SearchBox({
    className = "",
    inputClassName = "",
    placeholder = "Search titles, authors, ISBN",
    onNavigate,
    autoFocus = false,
}) {
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [books, setBooks] = useState([]);
    const [authors, setAuthors] = useState([]);
    const [active, setActive] = useState(-1);
    const [recent, setRecent] = useState([]);
    const boxRef = useRef(null);
    const nav = useNavigate();

    useEffect(() => {
        loadIndex().then(setBooks);
        loadAuthorIndex().then(setAuthors);
        setRecent(readRecent());
    }, []);

    // close on outside click
    useEffect(() => {
        const onDown = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    /*
     * Authors first, then books.
     *
     * Someone typing a person's name usually wants the person — and if they
     * wanted that author's titles, the author page lists them. Capped at three
     * so a prolific author cannot push every book out of a seven-row dropdown;
     * a search for "Khandelwal" should still show his books underneath.
     */
    const suggestions = useMemo(() => {
        const a = suggestFrom(authors, q, 3);
        const b = suggestFrom(books, q, MAX_SUGGESTIONS - a.length);
        return [...a, ...b];
    }, [q, books, authors]);

    const go = useCallback(
        (term) => {
            const t = (term || "").trim();
            if (!t) return;
            pushRecent(t);
            setRecent(readRecent());
            setOpen(false);
            setActive(-1);
            nav(`/books?search=${encodeURIComponent(t)}`);
            onNavigate && onNavigate();
        },
        [nav, onNavigate],
    );

    // One handler for both kinds — an author leads to their page, a book to
    // its own. `kind` is set only by loadAuthorIndex, so anything without it
    // is a book and the previous behaviour is unchanged.
    const openResult = useCallback(
        (item) => {
            pushRecent(item.t);
            setRecent(readRecent());
            setOpen(false);
            setQ("");
            nav(item.kind === "author" ? `/authors/${item.id}` : `/books/${item.id}`);
            onNavigate && onNavigate();
        },
        [nav, onNavigate],
    );

    const showRecent = open && q.trim().length < 2 && recent.length > 0;
    const rows = showRecent ? recent : suggestions;

    const onKeyDown = (e) => {
        if (e.key === "Escape") {
            setOpen(false);
            setActive(-1);
            return;
        }
        if (!rows.length) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % rows.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
        } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            showRecent ? go(rows[active]) : openResult(rows[active]);
        }
    };

    const clearRecent = () => {
        try {
            localStorage.removeItem(RECENT_KEY);
        } catch {
            /* ignore */
        }
        setRecent([]);
    };

    return (
        <div ref={boxRef} className={`relative ${className}`} data-testid="search-box">
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    go(q);
                }}
                className={`flex items-center border border-[#E5E7EB] bg-white px-3 h-9 ${inputClassName}`}
            >
                <Search size={16} strokeWidth={1.5} className="text-[#4B5563] flex-shrink-0" />
                <input
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                        setOpen(true);
                        setActive(-1);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    aria-label="Search books and authors"
                    aria-autocomplete="list"
                    aria-expanded={open && rows.length > 0}
                    data-testid="header-search-input"
                    className="bg-transparent text-sm px-2 w-full outline-none placeholder:text-[#4B5563]/60"
                />
                {q && (
                    <button
                        type="button"
                        onClick={() => {
                            setQ("");
                            setActive(-1);
                        }}
                        aria-label="Clear search"
                        className="p-1 text-[#4B5563] hover:text-[#CC0033] flex-shrink-0"
                    >
                        <X size={14} strokeWidth={1.5} />
                    </button>
                )}
            </form>

            {open && rows.length > 0 && (
                <div
                    data-testid="search-suggestions"
                    className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#002B5C] shadow-xl z-50 max-h-[70vh] overflow-y-auto"
                >
                    {showRecent ? (
                        <>
                            <div className="flex items-center justify-between px-3 pt-2 pb-1">
                                <span className="overline !text-[9px] !text-[#4B5563]">Recent</span>
                                <button
                                    type="button"
                                    onClick={clearRecent}
                                    className="text-[10px] font-mono text-[#4B5563] hover:text-[#CC0033]"
                                >
                                    Clear
                                </button>
                            </div>
                            {rows.map((r, i) => (
                                <button
                                    key={r}
                                    type="button"
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => go(r)}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm ${i === active ? "bg-[#F5F7FA]" : ""}`}
                                >
                                    <Clock size={13} strokeWidth={1.5} className="text-[#4B5563] flex-shrink-0" />
                                    <span className="truncate text-[#002B5C]">{r}</span>
                                </button>
                            ))}
                        </>
                    ) : (
                        <>
                            {rows.map((b, i) => {
                                const isAuthor = b.kind === "author";
                                return (
                                    <button
                                        key={`${b.kind || "book"}-${b.id}`}
                                        type="button"
                                        onMouseEnter={() => setActive(i)}
                                        onClick={() => openResult(b)}
                                        data-testid={isAuthor ? "suggestion-author" : "suggestion-book"}
                                        className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left ${i === active ? "bg-[#F5F7FA]" : ""}`}
                                    >
                                        {isAuthor ? (
                                            <User size={13} strokeWidth={1.5} className="text-[#002B5C] mt-0.5 flex-shrink-0" />
                                        ) : (
                                            <BookOpen size={13} strokeWidth={1.5} className="text-[#F59E0B] mt-0.5 flex-shrink-0" />
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm text-[#002B5C] truncate">{b.t}</span>
                                            {b.a && (
                                                <span className="flex items-center gap-1 text-[11px] text-[#4B5563] truncate">
                                                    {!isAuthor && <User size={10} strokeWidth={1.5} />} {b.a}
                                                </span>
                                            )}
                                        </span>
                                        {/* Says where the row leads before you click it — otherwise
                                            an author and a book of the same name are indistinguishable. */}
                                        {isAuthor && (
                                            <span className="font-mono text-[9px] uppercase tracking-widest text-[#4B5563] border border-[#E5E7EB] px-1.5 py-0.5 mt-0.5 flex-shrink-0">
                                                Author
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                onClick={() => go(q)}
                                className="w-full border-t border-[#E5E7EB] px-3 py-2.5 text-left text-xs font-medium text-[#002B5C] hover:bg-[#F5F7FA]"
                            >
                                See all results for “{q.trim()}”
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
