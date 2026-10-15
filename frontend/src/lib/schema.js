import { SITE } from "../components/Seo";

/**
 * JSON-LD builders.
 *
 * One place so every page describes itself the same way, and so the rules about
 * what may be claimed live next to the code that claims it.
 *
 * THE RULE THAT MATTERS: structured data is a statement to Google about facts
 * on the page. Anything asserted here that a visitor cannot see, or that is not
 * true, is a spam-policy problem rather than a missed opportunity — which is
 * why there is no aggregateRating builder below. See the note at the bottom.
 */

/** Trim to a boundary rather than mid-word, and never mid-sentence if avoidable. */
export const metaDescription = (text, max = 160) => {
    const clean = String(text || "")
        .replace(/\s+/g, " ")
        .trim();
    if (clean.length <= max) return clean;

    const cut = clean.slice(0, max);
    // Prefer ending on a sentence; fall back to the last whole word. A hard
    // slice leaves "…of the Compan" in the search result, which is the line
    // that has to earn the click.
    const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    // Half, not more: a complete sentence filling 80 of the 160 characters
    // reads better in a result than a 160-character fragment trailing an
    // ellipsis. Below half it is throwing away too much of the snippet — "Vol
    // 1." is a full stop, not a description — so the word boundary wins there.
    if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
    const word = cut.lastIndexOf(" ");
    return (word > 0 ? cut.slice(0, word) : cut).replace(/[,;:—-]+$/, "") + "…";
};

/**
 * A trail. Pass [{ name, path }] — the last item is the current page and, per
 * Google's guidance, carries no URL of its own.
 */
export const breadcrumbLd = (trail) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: step.name,
        ...(step.path && i < trail.length - 1 ? { item: `${SITE}${step.path}` } : {}),
    })),
});

/**
 * An author.
 *
 * `image` and `description` are only included when they exist: an empty string
 * in JSON-LD is a claim that the field is blank, which is worse than not
 * claiming it. Same for the list of works.
 */
export const personLd = (author, books = []) => {
    const works = books
        .filter((b) => b && b.title && b.id)
        .map((b) => ({
            "@type": "Book",
            name: b.title,
            url: `${SITE}/books/${b.id}`,
            ...(b.isbn ? { isbn: b.isbn } : {}),
        }));
    return {
        "@context": "https://schema.org",
        "@type": "Person",
        // Stable identity for this person across the site. The Book schema on
        // every PDP they appear on emits the same @id, which is what lets
        // Google treat the author of those books and the subject of this page
        // as one entity rather than as a recurring string. Both sides must use
        // this exact shape -- test-structured-data.mjs holds them together.
        "@id": `${SITE}/authors/${author.id}#person`,
        name: author.name,
        url: `${SITE}/authors/${author.id}`,
        ...(author.bio ? { description: metaDescription(author.bio, 300) } : {}),
        ...(author.photoUrl ? { image: author.photoUrl } : {}),
        ...(works.length ? { workExample: works } : {}),
        // Names the relationship the page is actually about: these people write
        // for Oakbridge, they are not employed by it.
        affiliation: { "@type": "Organization", name: "Oakbridge Publishing", url: `${SITE}/` },
    };
};

/**
 * The books on a listing page, in the order they are shown.
 *
 * Positions are the rendered order on purpose — an ItemList that disagrees with
 * the page it describes is a statement that does not match what is there.
 * Capped, because a list of 200 URLs in the head of every listing page is
 * payload nobody reads: Google takes the shape from the first entries.
 */
export const itemListLd = (books, { name, path, max = 24 } = {}) => ({
    "@context": "https://schema.org",
    "@type": "ItemList",
    ...(name ? { name } : {}),
    ...(path ? { url: `${SITE}${path}` } : {}),
    numberOfItems: books.length,
    itemListElement: books.slice(0, max).map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE}/books/${b.id}`,
        name: b.title,
    })),
});

/* ----------------------------------------------------------- book pages --- */

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export const ordinal = (n) => {
    const v = Math.abs(Number(n)) % 100;
    const suf = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[v % 10] || "th");
    return `${n}${suf}`;
};

/**
 * "6" -> "6th edition". The catalogue stores the edition as a bare number, and
 * the search snippet used to read "A P Bhardwaj · 6 edition." Anything that is
 * already words ("Second", "2nd ed.", "Revised edition") is left as typed.
 */
export const editionLabel = (edition) => {
    const e = String(edition ?? "").trim();
    if (!e) return "";
    if (/^\d+$/.test(e)) return `${ordinal(e)} edition`;
    return /\bed(ition|n)?\b\.?/i.test(e) ? e : `${e} edition`;
};

/**
 * The page title for a book: its full name, then "by <author>".
 *
 * Search Console shows the queries that grow are author + book ("ap bhardwaj
 * english book"), and the title tag carried only the book. The book's own name
 * still comes first and is never cut (see Seo.pageTitle); the author is added
 * after it. A long author list ("A, B & C") becomes "A et al." so the title
 * stays readable. Hampers have no author; a title that already names its
 * author is left alone.
 */
export const bookSeoTitle = (book) => {
    const title = String(book?.title || "").trim();
    const author = String(book?.author || "").replace(/\s+/g, " ").trim();
    if (!title || !author || book?.product_type === "hamper") return title;
    if (title.toLowerCase().includes(author.toLowerCase())) return title;
    const first = author.split(/\s*(?:,|&|\band\b)\s*/i)[0].trim();
    const who = author.length <= 40 ? author : `${first} et al.`;
    return `${title} by ${who}`;
};

/** schema.org bookFormat from the stored binding; undefined = do not claim one. */
export const bookFormatUrl = (binding) => {
    const b = String(binding || "").toLowerCase();
    if (/hard/.test(b)) return "https://schema.org/Hardcover";
    if (/paper|soft/.test(b)) return "https://schema.org/Paperback";
    if (/e-?book|digital|pdf/.test(b)) return "https://schema.org/EBook";
    return undefined;
};

/**
 * aggregateRating from REAL reviews only: review_count and rating_avg are
 * computed by the server from purchase-verified reviews (extensions.
 * refresh_review_stats) and shown on the same page. `book.rating` — the 4.5
 * every title was created with — is never read here. No reviews, no claim.
 */
export const ratingLd = (book) => {
    const n = Number(book?.review_count || 0);
    const avg = Number(book?.rating_avg);
    if (!(n >= 1) || !(avg >= 1 && avg <= 5)) return {};
    return {
        aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(avg.toFixed(1)),
            reviewCount: n,
            bestRating: 5,
            worstRating: 1,
        },
    };
};

/*
 * ABSENT AS A DEFAULT: aggregateRating.
 *
 * `rating` defaults to 4.5 on the Book model, so most titles carry a number
 * nobody gave them. Marking that up would be publishing review counts and
 * scores that no reader produced — fabricated review content under Google's
 * spam policies, and a manual action risks the rankings of the whole domain,
 * not just the pages carrying it.
 *
 * Since 15 Oct 2026 the condition is met for books that HAVE reviews: they are
 * purchase-verified, shown on the page, counted by the server, and the 4.5
 * default is no longer displayed or read (ratingLd above). Books without a
 * review still claim nothing.
 */
