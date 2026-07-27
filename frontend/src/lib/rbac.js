/**
 * Admin permission areas — mirrors backend/rbac.py.
 *
 * The backend is the real gate (it resolves the area from the request path and
 * 403s). This copy exists only so the UI can hide what a user cannot use, rather
 * than showing sections that fail on click.
 *
 * Keep ROLE_AREAS and SECTION_AREA in sync with backend/rbac.py.
 */

export const ROLE_AREAS = {
    superadmin: ["dashboard", "catalogue", "content", "fulfilment", "enquiries", "governance"],
    // Legacy role, identical to superadmin so existing logins keep full access.
    admin: ["dashboard", "catalogue", "content", "fulfilment", "enquiries", "governance"],
    manager: ["dashboard", "catalogue", "content", "fulfilment", "enquiries"],
    fulfilment: ["dashboard", "fulfilment", "enquiries"],
    editor: ["dashboard", "content", "catalogue"],
};

export const ROLE_LABELS = {
    superadmin: "Superadmin — full access, manages users",
    admin: "Admin (legacy) — same as superadmin",
    manager: "Manager — everything except users, legal and settings",
    editor: "Editor — site content, media and catalogue",
    fulfilment: "Fulfilment — orders, stock and enquiries",
    customer: "Customer — no admin access",
};

/** Admin sidebar path -> permission area. */
export const SECTION_AREA = {
    "/admin": "dashboard",
    "/admin/books": "catalogue",
    "/admin/inventory": "fulfilment",
    "/admin/authors": "catalogue",
    "/admin/page-bookstore": "catalogue",
    "/admin/page-book": "catalogue",
    "/admin/pages": "content",
    "/admin/navigation": "content",
    "/admin/media": "content",
    "/admin/media-gallery": "content",
    "/admin/careers": "content",
    "/admin/orders": "fulfilment",
    "/admin/coupons": "fulfilment",
    "/admin/messages": "enquiries",
    "/admin/desk-copies": "enquiries",
    "/admin/submissions": "enquiries",
    "/admin/waitlists": "enquiries",
    "/admin/users": "governance",
    "/admin/legal": "governance",
    "/admin/settings": "governance",
};

export const areasFor = (role) => ROLE_AREAS[role] || [];

export const canArea = (role, area) => areasFor(role).includes(area);

/** Can this role open this admin path? Unknown paths fail closed (superadmin only). */
export const canPath = (role, path) =>
    canArea(role, SECTION_AREA[path] || "governance");

export const isSuperadmin = (role) => role === "superadmin" || role === "admin";
