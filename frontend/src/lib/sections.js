// Central registry of hideable page sections. Keys are "page.section".
// Used by the admin visibility panel and checked by each page at render time.
export const SECTION_REGISTRY = [
    {
        page: "Homepage",
        slug: "home",
        items: [
            { key: "home.gifting_banner", label: "Gift Hamper Banner" },
            { key: "home.businesses", label: "Our Businesses" },
            { key: "home.imprints", label: "Imprints (Five Imprints)" },
            { key: "home.hot_off_press", label: "Hot Off the Press" },
            { key: "home.solutions", label: "Solutions" },
            { key: "home.bestsellers", label: "Bestsellers" },
            { key: "home.testimonials", label: "Testimonials" },
            { key: "home.manifesto", label: "Manifesto quote" },
        ],
    },
    {
        page: "Events",
        slug: "events",
        items: [
            { key: "events.flagship", label: "Flagship Events" },
            { key: "events.experiences", label: "The Experience" },
            { key: "events.summit_speakers", label: "Summit Speakers" },
            { key: "events.who_attends", label: "Who Attends" },
            { key: "events.vidhi_speakers", label: "Vidhi Utsav Speakers" },
            { key: "events.cta", label: "Get Involved (CTA)" },
        ],
    },
    {
        page: "Careers",
        slug: "careers",
        items: [
            { key: "careers.roles", label: "Open roles list" },
            { key: "careers.form", label: "Application form" },
        ],
    },
    {
        page: "Author Submissions",
        slug: "submissions",
        items: [{ key: "submissions.guidelines", label: "‘What we look for’ sidebar" }],
    },
    {
        page: "Contact",
        slug: "contact",
        items: [
            { key: "contact.form", label: "Contact form" },
            { key: "contact.details", label: "Address & direct lines" },
        ],
    },
    {
        page: "Media & Gallery",
        slug: "media",
        items: [{ key: "media.gallery", label: "Gallery grid" }],
    },
    // "Book Page" used to live here. Its only hideable section was the desk-copy
    // CTA, and desk copies were retired in August 2026, so the whole group went
    // with it rather than leaving an empty page in the visibility panel.
    {
        page: "About",
        slug: "about",
        items: [{ key: "about.timeline", label: "Timeline (the mountain road)" }],
    },
];

// Resolve a page's section order for the storefront. `saved` is the page's
// <slug>_section_order setting (bare keys, e.g. "imprints"). Returns the ordered
// list of bare keys, appending any new/missing sections in their default order.
// The legacy single "flagship" key expands to the provided flagshipKeys.
export function resolveSectionOrder(defaultBareKeys, saved, flagshipKeys = []) {
    const expand = (k) => (k === "flagship" && flagshipKeys.length ? flagshipKeys : [k]);
    const savedExp = (Array.isArray(saved) ? saved : []).flatMap(expand);
    const known = new Set(defaultBareKeys);
    const order = savedExp.filter((k) => known.has(k));

    /*
     * A section added to the code AFTER someone saved an order for this page is
     * not in `saved`. Appending it — which is what this did — drops every new
     * section at the very bottom of the page, below the footer-adjacent blocks,
     * which is the worst position on the page and the least likely one intended.
     * The gifting banner landed there: added second in the defaults, rendered
     * last, because the stored order predated it.
     *
     * Instead, put it back where the defaults say it belongs, relative to the
     * neighbours that ARE in the saved order. The admin's arrangement of the
     * sections they know about is untouched; only the new one is placed.
     */
    for (const key of defaultBareKeys) {
        if (order.includes(key)) continue;
        const want = defaultBareKeys.indexOf(key);
        // The nearest earlier default that survived into the saved order tells us
        // who this should sit after.
        let at = 0;
        for (let i = want - 1; i >= 0; i--) {
            const idx = order.indexOf(defaultBareKeys[i]);
            if (idx !== -1) {
                at = idx + 1;
                break;
            }
        }
        order.splice(at, 0, key);
    }
    return order;
}

// A Set of hidden section keys from the settings object.
export function hiddenSet(settings) {
    return new Set(Array.isArray(settings?.hidden_sections) ? settings.hidden_sections : []);
}
