import React from "react";

// Canonical host is www (the apex 308-redirects to it). Canonical tags and OG
// URLs must name the host we actually serve, or Google is told to prefer a URL
// that only redirects.
export const SITE = "https://www.oakbridge.in";
const DEFAULT_IMG = "https://www.oakbridge.in/og-image.jpg";

const SUFFIX = " · Oakbridge Publishing";
// Google shows roughly 60 characters of a title before cutting it. Past that,
// whatever is at the end is invisible.
const TITLE_MAX = 60;

/**
 * The title tag, with the brand appended only when it fits.
 *
 * Every title used to carry " · Oakbridge Publishing", which is 23 characters.
 * On a book called "Master Guide to NTA UGC NET | SET | JRF | PhD Paper 1
 * (Teaching and Research Aptitude), 7/e" that pushed the tag far past what
 * Google renders — so the brand was never seen anyway, and it displaced the end
 * of the book's own name.
 *
 * The BOOK TITLE IS NEVER TRUNCATED. A long title cut at 60 characters is worse
 * than a long title: the customer searching for it cannot tell whether this is
 * the edition they want. Losing the suffix costs nothing, because on this site
 * the brand is also the domain shown beside the result.
 */
export const pageTitle = (title) => {
    const t = (title || "").trim();
    if (!t) return "Oakbridge Publishing";
    return t.length + SUFFIX.length <= TITLE_MAX ? `${t}${SUFFIX}` : t;
};

/**
 * React 19 hoists <title>/<meta>/<link> to <head> automatically, so this
 * component just renders them. `jsonLd` may be an object or an array of objects.
 */
export default function Seo({ title, description, path, image, type = "website", jsonLd, noindex = false }) {
    const fullTitle = pageTitle(title);
    const url = path ? `${SITE}${path}` : SITE + "/";
    const img = image || DEFAULT_IMG;
    const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

    return (
        <>
            <title>{fullTitle}</title>
            {description && <meta name="description" content={description} />}
            {noindex && <meta name="robots" content="noindex, follow" />}
            <link rel="canonical" href={url} />
            <meta property="og:type" content={type} />
            <meta property="og:site_name" content="Oakbridge Publishing" />
            <meta property="og:title" content={fullTitle} />
            {description && <meta property="og:description" content={description} />}
            <meta property="og:url" content={url} />
            <meta property="og:image" content={img} />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={fullTitle} />
            {description && <meta name="twitter:description" content={description} />}
            <meta name="twitter:image" content={img} />
            {blocks.map((b, i) => (
                <script
                    key={i}
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(b) }}
                />
            ))}
        </>
    );
}
