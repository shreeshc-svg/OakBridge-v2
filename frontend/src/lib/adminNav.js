import {
    LayoutDashboard,
    BookOpen,
    ShoppingBag,
    Mail,
    Users,
    Tag,
    PackageCheck,
    FileText,
    Inbox,
    Image,
    Settings,
    Scale,
    LayoutTemplate,
    Navigation,
    Briefcase,
    Clapperboard,
    Tablet,
} from "lucide-react";

/**
 * The admin sidebar, in default order — the single source of truth.
 *
 * AdminLayout renders it and AdminSettings reorders it. They used to keep
 * separate hardcoded copies, which silently drifted: three sections added later
 * (Bookstore Page, Book Page, E-Books) existed in the sidebar but not in the
 * reorder screen, so they could never be positioned and always sank to the
 * bottom. One list means that can't happen again.
 *
 * `to` doubles as the permission key via lib/rbac's sectionForPath.
 */
export const ADMIN_NAV = [
    { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/books", label: "Books", icon: BookOpen },
    { to: "/admin/inventory", label: "Inventory", icon: PackageCheck },
    { to: "/admin/authors", label: "Authors", icon: Users },
    { to: "/admin/orders", label: "Orders", icon: ShoppingBag },
    { to: "/admin/coupons", label: "Coupons", icon: Tag },
    { to: "/admin/pages", label: "Pages", icon: LayoutTemplate },
    { to: "/admin/page-bookstore", label: "Bookstore Page", icon: LayoutTemplate },
    { to: "/admin/page-book", label: "Book Page", icon: BookOpen },
    { to: "/admin/navigation", label: "Navigation", icon: Navigation },
    { to: "/admin/media", label: "Media Library", icon: Image },
    { to: "/admin/media-gallery", label: "Media & Gallery", icon: Clapperboard },
    { to: "/admin/ebooks", label: "E-Books", icon: Tablet },
    { to: "/admin/careers", label: "Careers", icon: Briefcase },
    { to: "/admin/messages", label: "Messages", icon: Mail },
    { to: "/admin/desk-copies", label: "Desk Copies", icon: Mail },
    { to: "/admin/submissions", label: "Submissions", icon: FileText },
    { to: "/admin/waitlists", label: "Waitlists", icon: Inbox },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/legal", label: "Legal", icon: Scale },
    { to: "/admin/settings", label: "Settings", icon: Settings },
];

/**
 * Apply a saved order, dropping entries that no longer exist and appending any
 * section added since the order was saved. Used by the sidebar and the reorder
 * editor so both always show the identical sequence.
 */
export const applyNavOrder = (savedOrder) => {
    const saved = Array.isArray(savedOrder) ? savedOrder : [];
    const byTo = Object.fromEntries(ADMIN_NAV.map((l) => [l.to, l]));
    const seen = new Set();
    const out = [];
    saved.forEach((to) => {
        if (byTo[to] && !seen.has(to)) {
            out.push(byTo[to]);
            seen.add(to);
        }
    });
    ADMIN_NAV.forEach((l) => {
        if (!seen.has(l.to)) out.push(l);
    });
    return out;
};
