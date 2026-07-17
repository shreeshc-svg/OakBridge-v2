import React, { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ShoppingBag, Search, Menu, X, User, LogOut } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import CartSheet from "./CartSheet";
import { fetchCollection } from "../lib/api";

const DEFAULT_NAV = [
    { to: "/what-we-do", label: "What We Do" },
    { to: "/books", label: "Bookstore" },
    { to: "/events", label: "Events" },
    { to: "/academy", label: "Academy" },
    { to: "/digital-solutions", label: "Digital Solutions" },
    { to: "/authors", label: "Authors" },
    { to: "/about", label: "About" },
];

export default function Header() {
    const { count, setIsOpen } = useCart();
    const { isAuthenticated, isAdmin, user, logout } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const [q, setQ] = useState("");
    const [navItems, setNavItems] = useState(DEFAULT_NAV);
    const nav = useNavigate();

    useEffect(() => {
        fetchCollection("site_nav")
            .then((d) => {
                const items = (d?.items || []).filter(
                    (n) => n && n.to && n.label && !n.hidden,
                );
                if (items.length) setNavItems(items);
            })
            .catch(() => {});
    }, []);

    const onSearch = (e) => {
        e.preventDefault();
        if (q.trim()) {
            nav(`/books?search=${encodeURIComponent(q.trim())}`);
            setMobileOpen(false);
        }
    };

    return (
        <>
            <header
                data-testid="site-header"
                className="sticky top-0 z-40 border-b border-[#002B5C]/10 bg-[#FFFFFF]/85 backdrop-blur-xl"
            >
                <div className="flex items-center justify-between gap-4 px-6 md:px-12 lg:px-16 h-20">
                    <Link
                        to="/"
                        data-testid="brand-logo"
                        className="flex items-center flex-shrink-0"
                    >
                        <img
                            src="/logo.jpg"
                            alt="Oakbridge Publishing"
                            className="h-16 w-auto"
                        />
                    </Link>

                    <nav className="hidden xl:flex items-center gap-5">
                        {navItems.map((n) => (
                            <NavLink
                                key={n.to}
                                to={n.to}
                                data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                                className={({ isActive }) =>
                                    `text-sm font-medium transition-colors ${isActive ? "text-[#002B5C]" : "text-[#4B5563] hover:text-[#002B5C]"}`
                                }
                            >
                                {n.label}
                            </NavLink>
                        ))}
                    </nav>

                    <div className="flex items-center gap-2 flex-shrink-0">
                        <form
                            onSubmit={onSearch}
                            className="hidden md:flex items-center border border-[#E5E7EB] bg-white px-3 h-9 w-44 xl:w-52"
                        >
                            <Search
                                size={16}
                                strokeWidth={1.5}
                                className="text-[#4B5563]"
                            />
                            <input
                                data-testid="header-search-input"
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="Search titles, authors, ISBN"
                                className="bg-transparent text-sm px-2 w-full outline-none placeholder:text-[#4B5563]/60"
                            />
                        </form>
                        <button
                            onClick={() => setIsOpen(true)}
                            data-testid="open-cart-button"
                            className="relative p-2 hover:bg-[#F5F7FA] transition-colors"
                            aria-label="Open cart"
                        >
                            <ShoppingBag size={18} strokeWidth={1.5} />
                            {count > 0 && (
                                <span
                                    data-testid="cart-count-badge"
                                    className="absolute -top-0.5 -right-0.5 bg-[#CC0033] text-white text-[10px] font-mono min-w-[16px] h-[16px] px-1 flex items-center justify-center"
                                >
                                    {count}
                                </span>
                            )}
                        </button>

                        {/* Account */}
                        {isAuthenticated ? (
                            <div className="relative hidden md:block">
                                <button
                                    onClick={() => setAccountOpen((o) => !o)}
                                    onBlur={() => setTimeout(() => setAccountOpen(false), 150)}
                                    data-testid="header-account-button"
                                    className="p-2 hover:bg-[#F5F7FA] transition-colors"
                                    aria-label="Account"
                                >
                                    <User size={18} strokeWidth={1.5} />
                                </button>
                                {accountOpen && (
                                    <div className="absolute right-0 mt-1 w-56 bg-white border border-[#002B5C] shadow-xl z-50">
                                        <div className="px-4 py-3 border-b border-[#E5E7EB]">
                                            <div className="font-serif text-base text-[#002B5C] leading-tight">
                                                {user.name}
                                            </div>
                                            <div className="text-xs text-[#4B5563]">
                                                {user.email}
                                            </div>
                                        </div>
                                        <Link
                                            to="/account"
                                            data-testid="header-my-account-link"
                                            className="block px-4 py-2 text-sm hover:bg-[#F5F7FA]"
                                        >
                                            My Orders
                                        </Link>
                                        {isAdmin && (
                                            <Link
                                                to="/admin"
                                                data-testid="header-admin-link"
                                                className="block px-4 py-2 text-sm hover:bg-[#F5F7FA] text-[#CC0033]"
                                            >
                                                Admin Dashboard
                                            </Link>
                                        )}
                                        <button
                                            onClick={() => {
                                                logout();
                                                nav("/");
                                            }}
                                            data-testid="header-logout"
                                            className="w-full text-left px-4 py-2 text-sm hover:bg-[#F5F7FA] inline-flex items-center gap-2 border-t border-[#E5E7EB]"
                                        >
                                            <LogOut size={12} strokeWidth={1.5} /> Sign out
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Link
                                to="/login"
                                data-testid="header-login-link"
                                className="hidden md:inline-block p-2 text-sm font-medium hover:text-[#CC0033]"
                            >
                                Sign in
                            </Link>
                        )}

                        <button
                            onClick={() => setMobileOpen(!mobileOpen)}
                            data-testid="mobile-menu-toggle"
                            className="xl:hidden p-2 hover:bg-[#F5F7FA]"
                            aria-label="Menu"
                        >
                            {mobileOpen ? (
                                <X size={18} strokeWidth={1.5} />
                            ) : (
                                <Menu size={18} strokeWidth={1.5} />
                            )}
                        </button>
                    </div>
                </div>

                {mobileOpen && (
                    <div className="lg:hidden border-t border-[#002B5C]/10 bg-[#FFFFFF]">
                        <nav className="flex flex-col px-6 py-4 gap-3">
                            {navItems.map((n) => (
                                <NavLink
                                    key={n.to}
                                    to={n.to}
                                    onClick={() => setMobileOpen(false)}
                                    data-testid={`mobile-nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                                    className="text-base font-medium text-[#002B5C] py-1.5"
                                >
                                    {n.label}
                                </NavLink>
                            ))}
                            {isAuthenticated ? (
                                <>
                                    <NavLink
                                        to="/account"
                                        onClick={() => setMobileOpen(false)}
                                        className="text-base font-medium text-[#002B5C] py-1.5"
                                    >
                                        My Account
                                    </NavLink>
                                    {isAdmin && (
                                        <NavLink
                                            to="/admin"
                                            onClick={() => setMobileOpen(false)}
                                            className="text-base font-medium text-[#CC0033] py-1.5"
                                        >
                                            Admin
                                        </NavLink>
                                    )}
                                </>
                            ) : (
                                <NavLink
                                    to="/login"
                                    onClick={() => setMobileOpen(false)}
                                    className="text-base font-medium text-[#002B5C] py-1.5"
                                >
                                    Sign in
                                </NavLink>
                            )}
                            <form
                                onSubmit={onSearch}
                                className="flex border border-[#E5E7EB] bg-white px-3 h-10 mt-2"
                            >
                                <Search
                                    size={16}
                                    strokeWidth={1.5}
                                    className="self-center text-[#4B5563]"
                                />
                                <input
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Search books"
                                    className="bg-transparent text-sm px-2 w-full outline-none"
                                />
                            </form>
                        </nav>
                    </div>
                )}
            </header>
            <CartSheet />
        </>
    );
}
