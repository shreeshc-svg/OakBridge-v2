import React from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { LogOut, ExternalLink, Menu, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Toaster } from "../../components/ui/sonner";
import { fetchSettings } from "../../lib/api";
import { canPath, sectionForPath, SECTION_LABELS } from "../../lib/rbac";
import NoIndex from "../../components/NoIndex";
import { applyNavOrder } from "../../lib/adminNav";

export default function AdminLayout() {
    const { user, logout } = useAuth();
    const nav = useNavigate();
    const loc = useLocation();
    const [navOpen, setNavOpen] = React.useState(false);
    const [navOrder, setNavOrder] = React.useState([]);

    React.useEffect(() => {
        fetchSettings()
            .then((s) => setNavOrder(Array.isArray(s.admin_nav_order) ? s.admin_nav_order : []))
            .catch(() => {});
    }, []);

    // One source of truth with the reorder screen (lib/adminNav), then drop
    // anything this role cannot open so staff never see a 403 waiting to happen.
    const orderedLinks = React.useMemo(
        () => applyNavOrder(navOrder).filter((l) => canPath(user, l.to)),
        [navOrder, user],
    );

    // Typing a restricted URL directly must not render the page. The API would
    // refuse anyway, but an empty screen full of failed requests is a poor answer.
    const allowedHere = canPath(user, loc.pathname);

    React.useEffect(() => {
        window.scrollTo(0, 0);
        setNavOpen(false); // close the drawer whenever we navigate
    }, [loc.pathname]);

    // lock background scroll while the drawer is open
    React.useEffect(() => {
        if (!navOpen) return undefined;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [navOpen]);

    const current = orderedLinks.find((l) =>
        l.end ? loc.pathname === l.to : loc.pathname.startsWith(l.to),
    );

    const navList = (
        <nav className="space-y-1">
            {orderedLinks.map((l) => (
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
    );

    const footerLinks = (
        <div className="mt-10 pt-6 border-t border-white/10 space-y-3">
            <NavLink to="/" className="flex items-center gap-2 text-xs text-white/60 hover:text-white">
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
    );

    return (
        <div data-testid="admin-layout" className="min-h-screen bg-[#F5F7FA] lg:grid lg:grid-cols-[260px_1fr]">
            {/* The admin previously borrowed its tab title from the static one in
                index.html. That tag had to go (it duplicated the per-route title
                React emits), so the shell now names itself — and takes a noindex
                while it is here, which robots.txt alone cannot guarantee. The
                section name means several open admin tabs stay tellable apart. */}
            <NoIndex title={current ? `${current.label} · Admin` : "Admin"} />
            {/* Top bar — phone & tablet only */}
            <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 bg-[#002B5C] text-white px-4 h-14">
                <button
                    onClick={() => setNavOpen(true)}
                    aria-label="Open admin menu"
                    data-testid="admin-nav-toggle"
                    className="p-2 -ml-2 hover:bg-white/10"
                >
                    <Menu size={20} strokeWidth={1.5} />
                </button>
                <div className="min-w-0 text-center flex-1">
                    <div className="overline !text-white/50 !text-[9px] leading-none">Oakbridge · Admin</div>
                    <div className="font-serif text-base truncate leading-tight">{current?.label || "Admin"}</div>
                </div>
                <NavLink to="/" aria-label="View storefront" className="p-2 -mr-2 hover:bg-white/10">
                    <ExternalLink size={18} strokeWidth={1.5} />
                </NavLink>
            </div>

            {/* Slide-out drawer — phone & tablet */}
            {navOpen && (
                <div className="lg:hidden fixed inset-0 z-50 flex" data-testid="admin-nav-drawer">
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setNavOpen(false)}
                        aria-hidden="true"
                    />
                    <aside className="relative w-[86%] max-w-[300px] h-full overflow-y-auto bg-[#002B5C] text-white p-6 overscroll-contain">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="overline !text-white/50">Oakbridge · Admin</div>
                                <h2 className="font-serif text-xl mt-1 truncate">{user?.name}</h2>
                            </div>
                            <button
                                onClick={() => setNavOpen(false)}
                                aria-label="Close admin menu"
                                className="p-2 -mr-2 -mt-1 hover:bg-white/10"
                            >
                                <X size={20} strokeWidth={1.5} />
                            </button>
                        </div>
                        <div className="mt-6">{navList}</div>
                        {footerLinks}
                    </aside>
                </div>
            )}

            {/* Static sidebar — desktop */}
            <aside className="hidden lg:block bg-[#002B5C] text-[#FFFFFF] p-6 lg:min-h-full">
                <div className="overline !text-white/50">Oakbridge · Admin</div>
                <h2 className="font-serif text-2xl mt-2">{user?.name}</h2>
                <div className="mt-8">{navList}</div>
                {footerLinks}
            </aside>

            <main className="p-4 sm:p-6 md:p-8 lg:p-10 min-w-0">
                {allowedHere ? (
                    <Outlet />
                ) : (
                    <div data-testid="admin-no-access" className="max-w-lg">
                        <div className="overline !text-[10px]">Restricted</div>
                        <h1 className="font-serif text-3xl mt-2 text-[#002B5C]">
                            You don't have access to this section.
                        </h1>
                        <p className="text-sm text-[#4B5563] mt-4">
                            Your role is{" "}
                            <span className="font-mono text-[#002B5C]">{user?.role || "unknown"}</span>
                            . The{" "}
                            <span className="font-mono text-[#002B5C]">
                                {SECTION_LABELS[sectionForPath(loc.pathname)] || "requested"}
                            </span>{" "}
                            section isn't enabled for your account — ask a superadmin to add it.
                        </p>
                        <NavLink
                            to="/admin"
                            className="inline-block mt-6 text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA]"
                        >
                            Back to dashboard
                        </NavLink>
                    </div>
                )}
            </main>
            <Toaster position="bottom-right" />
        </div>
    );
}
