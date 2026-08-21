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

/*
 * DELIBERATELY ABSENT: aggregateRating.
 *
 * `rating` defaults to 4.5 on the Book model, so most titles carry a number
 * nobody gave them. Marking that up would be publishing review counts and
 * scores that no reader produced — fabricated review content under Google's
 * spam policies, and a manual action risks the rankings of the whole domain,
 * not just the pages carrying it.
 *
 * If real reviews are ever collected AND shown on the page AND the 4.5 default
 * is removed, this becomes a legitimate and valuable addition. Not before.
 */
