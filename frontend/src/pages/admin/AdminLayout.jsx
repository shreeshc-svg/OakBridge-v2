import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, BookOpen, ShoppingBag, Mail, Users, LogOut, ExternalLink, Tag, PackageCheck, FileText, Inbox, Image } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const LINKS = [
    { to: "/admin", end: true, label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/books", label: "Books", icon: BookOpen },
    { to: "/admin/inventory", label: "Inventory", icon: PackageCheck },
    { to: "/admin/media", label: "Media", icon: Image },
    { to: "/admin/orders", label: "Orders", icon: ShoppingBag },
    { to: "/admin/coupons", label: "Coupons", icon: Tag },
    { to: "/admin/desk-copies", label: "Desk Copies", icon: Mail },
    { to: "/admin/submissions", label: "Submissions", icon: FileText },
    { to: "/admin/waitlists", label: "Waitlists", icon: Inbox },
    { to: "/admin/users", label: "Users", icon: Users },
];

export default function AdminLayout() {
    const { user, logout } = useAuth();
    const nav = useNavigate();
    return (
        <div
            data-testid="admin-layout"
            className="min-h-[calc(100vh-4rem)] grid grid-cols-1 lg:grid-cols-[260px_1fr] bg-[#F5F7FA]"
        >
            <aside className="bg-[#002B5C] text-[#FFFFFF] p-6 lg:min-h-full">
                <div className="overline !text-white/50">Oakbridge · Admin</div>
                <h2 className="font-serif text-2xl mt-2">{user?.name}</h2>
                <nav className="mt-8 space-y-1">
                    {LINKS.map((l) => (
                        <NavLink
                            key={l.to}
                            to={l.to}
                            end={l.end}
                            data-testid={`admin-nav-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-4 py-3 text-sm border-l-2 transition-colors ${isActive ? "border-[#F59E0B] bg-white/5 text-white" : "border-transparent text-white/70 hover:text-white hover:bg-white/5"}`
                            }
                        >
                            <l.icon size={16} strokeWidth={1.5} />
                            {l.label}
                        </NavLink>
                    ))}
                </nav>
                <div className="mt-12 pt-8 border-t border-white/10 space-y-2">
                    <NavLink
                        to="/"
                        className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-white"
                    >
                        <ExternalLink size={12} strokeWidth={1.5} /> View storefront
                    </NavLink>
                    <button
                        onClick={() => {
                            logout();
                            nav("/login");
                        }}
                        data-testid="admin-logout"
                        className="flex items-center gap-2 text-xs text-white/60 hover:text-white"
                    >
                        <LogOut size={12} strokeWidth={1.5} /> Sign out
                    </button>
                </div>
            </aside>
            <main className="p-6 md:p-10">
                <Outlet />
            </main>
        </div>
    );
}
