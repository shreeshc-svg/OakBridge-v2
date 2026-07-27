import React from "react";

/**
 * Marks a route as private: `noindex, follow`, plus a proper browser-tab title.
 *
 * WHY THIS EXISTS RATHER THAN <Seo noindex>
 *
 * `Seo` also emits a canonical link, an og:url and a full social card. A page we
 * are asking Google to drop should not simultaneously declare a canonical URL —
 * that is a contradictory instruction, and on a parameterised URL such as
 * /reset-password?token=… it would publish the token in the canonical tag.
 * So this component emits ONLY the robots directive and the title.
 *
 * WHY IT IS APPLIED IN App.js, NOT INSIDE EACH PAGE
 *
 * Cart, Checkout, Account, OrderConfirmation and the auth screens all have
 * several `return` branches — loading states, empty-cart states, "order not
 * found". Putting the tag inside the component means remembering every branch,
 * and the branch a crawler is most likely to hit (the un-authenticated empty
 * one) is exactly the branch that gets forgotten. Wrapping at the route covers
 * every branch by construction.
 *
 * `follow` is deliberate: these pages link back into the catalogue, and we still
 * want that link equity to flow even though the page itself stays out of the
 * index.
 *
 * robots.txt also disallows most of these paths. That is belt-and-braces, not
 * redundancy — a Disallow stops a crawl but does NOT stop indexing of a URL
 * discovered elsewhere, which is how "No information is available for this page"
 * results appear. The meta tag is what actually removes them.
 */
export default function NoIndex({ title }) {
    return (
        <>
            {title && <title>{`${title} · Oakbridge Publishing`}</title>}
            <meta name="robots" content="noindex, follow" />
        </>
    );
}
