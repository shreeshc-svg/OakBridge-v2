// Central registry of hideable page sections. Keys are "page.section".
// Used by the admin visibility panel and checked by each page at render time.
export const SECTION_REGISTRY = [
    {
        page: "Homepage",
        items: [
            { key: "home.businesses", label: "Our Businesses" },
            { key: "home.imprints", label: "Imprints (Five Imprints)" },
            { key: "home.hot_off_press", label: "Hot Off the Press" },
            { key: "home.bestsellers", label: "Bestsellers" },
            { key: "home.solutions", label: "Solutions" },
            { key: "home.testimonials", label: "Testimonials" },
            { key: "home.manifesto", label: "Manifesto quote" },
        ],
    },
    {
        page: "Events",
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
        items: [
            { key: "careers.roles", label: "Open roles list" },
            { key: "careers.form", label: "Application form" },
        ],
    },
    {
        page: "Author Submissions",
        items: [{ key: "submissions.guidelines", label: "‘What we look for’ sidebar" }],
    },
    {
        page: "Contact",
        items: [
            { key: "contact.form", label: "Contact form" },
            { key: "contact.details", label: "Address & direct lines" },
        ],
    },
    {
        page: "Media & Gallery",
        items: [{ key: "media.gallery", label: "Gallery grid" }],
    },
];

// A Set of hidden section keys from the settings object.
export function hiddenSet(settings) {
    return new Set(Array.isArray(settings?.hidden_sections) ? settings.hidden_sections : []);
}
