// Central registry of hideable page sections. Keys are "page.section".
// Used by the admin visibility panel and checked by each page at render time.
export const SECTION_REGISTRY = [
    {
        page: "Homepage",
        slug: "home",
        items: [
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
    {
        page: "Book Page",
        slug: "book",
        items: [{ key: "book.desk_copy", label: "‘Request a free desk copy’ CTA" }],
    },
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
    return [
        ...savedExp.filter((k) => known.has(k)),
        ...defaultBareKeys.filter((k) => !savedExp.includes(k)),
    ];
}

// A Set of hidden section keys from the settings object.
export function hiddenSet(settings) {
    return new Set(Array.isArray(settings?.hidden_sections) ? settings.hidden_sections : []);
}
