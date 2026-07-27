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
    "careers",
    "orders",
    "coupons",
    "messages",
    "desk-copies",
    "submissions",
    "waitlists",
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
    careers: "Careers",
    orders: "Orders",
    coupons: "Coupons",
    messages: "Messages",
    "desk-copies": "Desk Copies",
    submissions: "Submissions",
    waitlists: "Waitlists",
    users: "Users",
    legal: "Legal",
    settings: "Settings",
};

/** Grouping for the permission picker only — not a security boundary. */
export const SECTION_GROUPS = [
    { label: "Catalogue", sections: ["books", "authors", "inventory"] },
    {
        label: "Site content",
        sections: ["pages", "navigation", "media", "media-gallery", "careers", "page-bookstore", "page-book"],
    },
    { label: "Fulfilment", sections: ["orders", "coupons"] },
    { label: "Enquiries", sections: ["messages", "desk-copies", "submissions", "waitlists"] },
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
];

export const ROLE_PRESETS = {
    superadmin: SECTIONS,
    admin: SECTIONS,
    manager: SECTIONS.filter((s) => !["users", "legal", "settings"].includes(s)),
    editor: [
        "dashboard", "books", "authors", "pages", "navigation",
        "media", "media-gallery", "careers", "page-bookstore", "page-book",
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

export const canPath = (user, path) =>
    effectiveSections(user).includes(sectionForPath(path));
