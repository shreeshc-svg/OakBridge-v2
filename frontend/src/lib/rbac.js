/**
 * Admin section permissions — mirrors backend/rbac.py.
 *
 * The backend is the real gate; this copy lets the UI hide what a user cannot
 * open instead of showing sections that 403 on click.
 *
 * Keep SECTIONS / ROLE_PRESETS in sync with backend/rbac.py.
 */

export const SECTIONS = [
    "dashboard",
    "books",
    "inventory",
    "authors",
    "page-bookstore",
    "page-book",
    "pages",
    "navigation",
    "media",
    "media-gallery",
    "ebooks",
    "careers",
    "orders",
    "coupons",
    "messages",
    "desk-copies",
    "submissions",
    "waitlists",
    "spam",
    "users",
    "legal",
    "settings",
];

export const SECTION_LABELS = {
    dashboard: "Dashboard",
    books: "Books",
    inventory: "Inventory",
    authors: "Authors",
    "page-bookstore": "Bookstore Page",
    "page-book": "Book Page",
    pages: "Pages",
    navigation: "Navigation",
    media: "Media Library",
    "media-gallery": "Media & Gallery",
    ebooks: "E-Books",
    careers: "Careers",
    orders: "Orders",
    coupons: "Coupons",
    messages: "Messages",
    "desk-copies": "Desk Copies",
    submissions: "Submissions",
    waitlists: "Waitlists",
    spam: "Spam",
    users: "Users",
    legal: "Legal",
    settings: "Settings",
};

/** Grouping for the permission picker only — not a security boundary. */
export const SECTION_GROUPS = [
    { label: "Catalogue", sections: ["books", "authors", "inventory"] },
    {
        label: "Site content",
        sections: ["pages", "navigation", "media", "media-gallery", "careers", "page-bookstore", "page-book", "ebooks"],
    },
    { label: "Fulfilment", sections: ["orders", "coupons"] },
    { label: "Enquiries", sections: ["messages", "desk-copies", "submissions", "waitlists", "spam"] },
    { label: "Governance", sections: ["users", "legal", "settings"] },
];

/**
 * These six write through shared endpoints (site-content / collections /
 * settings), so unticking one hides it but cannot fully isolate it from the
 * others. Surfaced in the UI rather than quietly overpromising.
 */
export const SHARED_CONTENT_SECTIONS = [
    "pages",
    "navigation",
    "media-gallery",
    "careers",
    "page-bookstore",
    "page-book",
    "ebooks",
];

export const ROLE_PRESETS = {
    superadmin: SECTIONS,
    admin: SECTIONS,
    manager: SECTIONS.filter((s) => !["users", "legal", "settings"].includes(s)),
    editor: [
        "dashboard", "books", "authors", "pages", "navigation",
        "media", "media-gallery", "careers", "page-bookstore", "page-book", "ebooks",
    ],
    fulfilment: [
        "dashboard", "inventory", "orders", "coupons",
        "messages", "desk-copies", "submissions", "waitlists",
    ],
};

export const ROLE_LABELS = {
    superadmin: "Superadmin — full access, manages users",
    admin: "Admin (legacy) — same as superadmin",
    manager: "Manager — everything except users, legal and settings",
    editor: "Editor — site content, media and catalogue",
    fulfilment: "Fulfilment — orders, stock and enquiries",
    customer: "Customer — no admin access",
};

export const ADMIN_ROLES = Object.keys(ROLE_PRESETS);

export const isSuperadmin = (role) => role === "superadmin" || role === "admin";

/** Sidebar path -> section key. "/admin" is the dashboard. */
export const sectionForPath = (path) => {
    if (!path || path === "/admin" || path === "/admin/") return "dashboard";
    return path.replace(/^\/admin\//, "").split("/")[0];
};

/** A user's sections: explicit list if set, else the role preset. */
export const effectiveSections = (user) => {
    if (!user) return [];
    if (isSuperadmin(user.role)) return SECTIONS;
    if (Array.isArray(user.sections)) return user.sections.filter((s) => SECTIONS.includes(s));
    return ROLE_PRESETS[user.role] || [];
};

/*
 * The superadmin short-circuit mirrors backend can_path, and its absence is
 * what actually hid the Spam page.
 *
 * "spam" was missing from SECTIONS in both files. On the backend that was
 * invisible, because can_path answers True for a superadmin before it ever
 * looks a section up. Here the same user fell through to a membership test
 * against a list that did not contain the key — so the link was filtered out
 * of the sidebar for everyone, including the account that owns the site, while
 * the reorder screen (which applies no permissions) went on listing it.
 *
 * Matching the backend means an unmapped section can no longer make a page
 * vanish for the person able to fix it. The sanity gate catches the mapping
 * itself.
 */
export const canPath = (user, path) => {
    if (isSuperadmin(user?.role)) return true;
    return effectiveSections(user).includes(sectionForPath(path));
};
