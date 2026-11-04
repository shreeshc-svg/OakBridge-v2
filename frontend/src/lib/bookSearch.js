/**
 * Find a book by whatever the warehouse team has in hand (Nov 2026):
 * part of the title, the author, an ISBN (13 or 10 digits, with or without
 * hyphens, or just the last few digits on a sticker), the edition, the
 * category — in any order, and forgiving one slip of the thumb per word
 * ("constituton", "lagal").
 *
 * Pure: books in, ranked books out. Used by the warehouse phone screens
 * (WarehouseApp.jsx BookPicker, "One book in or out", "Check stock").
 * Tested by frontend/scripts/test-book-search.mjs.
 */

export const fold = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
export const isbnDigits = (s) => String(s || "").replace(/[^0-9Xx]/g, "").toUpperCase();

/** ISBN-13 (978…) -> ISBN-10, so an old sticker / Amazon code still finds the book. */
export const isbn13to10 = (s) => {
    const d = isbnDigits(s);
    if (d.length !== 13 || !d.startsWith("978")) return "";
    const core9 = d.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += (10 - i) * Number(core9[i]);
    const c = (11 - (sum % 11)) % 11;
    return core9 + (c === 10 ? "X" : String(c));
};

// Small, bounded edit distance: is `a` within `max` edits of `b`?
const near = (a, b, max) => {
    if (Math.abs(a.length - b.length) > max) return false;
    const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
        let diag = prev[0];
        prev[0] = i;
        let rowMin = prev[0];
        for (let j = 1; j <= b.length; j += 1) {
            const tmp = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = tmp;
            rowMin = Math.min(rowMin, prev[j]);
        }
        if (rowMin > max) return false;
    }
    return prev[b.length] <= max;
};

const typoBudget = (w) => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);

/** Everything a person might type about this book, folded once. */
const index = (b) => {
    const isbn = isbnDigits(b.isbn);
    const text = fold([b.title, b.author, b.edition && `${b.edition} edition ${b.edition}e`, b.category, b.binding,
        b.publication_year].filter(Boolean).join(" "));
    return { text, tokens: text.split(" ").filter(Boolean), isbns: [isbn, isbn13to10(isbn)].filter(Boolean),
        title: fold(b.title) };
};

/**
 * Ranked matches for query `q`.
 *   ISBN: 3+ digits anywhere in the ISBN-13 or ISBN-10 (exact ISBN first).
 *   Words: every typed word must appear (substring) in title / author /
 *          edition / category; if nothing matches that way, each word may be
 *          one or two letters off a word of the book (typo fallback).
 *   Ranking: exact ISBN, title starts with the query, all words in the title,
 *            then the rest — alphabetical within each.
 */
export function searchBooks(books, q, limit = 12) {
    const raw = String(q || "").trim();
    if (!raw) return [];
    const digits = isbnDigits(raw);
    const words = fold(raw).split(" ").filter(Boolean);
    const onlyDigits = /^[\d\s-xX]+$/.test(raw) && digits.length >= 3;
    const qTitle = fold(raw);
    const scored = [];
    const loose = [];
    for (const b of books || []) {
        const ix = index(b);
        let score = -1;
        if (onlyDigits) {
            if (ix.isbns.some((i) => i === digits)) score = 0;
            else if (ix.isbns.some((i) => i.includes(digits))) score = 1;
        }
        if (score < 0 && words.length && words.every((w) => ix.text.includes(w))) {
            score = ix.title.startsWith(qTitle) ? 2 : words.every((w) => ix.title.includes(w)) ? 3 : 4;
        }
        if (score >= 0) scored.push([score, b]);
        else if (!onlyDigits && words.length && words.every((w) => ix.text.includes(w)
            || ix.tokens.some((t) => near(w, t.slice(0, w.length), typoBudget(w)) || near(w, t, typoBudget(w))))) {
            loose.push([5, b]);
        }
    }
    const pool = scored.length ? scored : loose;   // typo matches only when nothing matched exactly
    return pool
        .sort((x, y) => x[0] - y[0] || String(x[1].title || "").localeCompare(String(y[1].title || "")))
        .slice(0, limit)
        .map(([, b]) => b);
}
