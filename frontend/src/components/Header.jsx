import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ShoppingBag, Menu, X, User, LogOut, Search } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import CartSheet from "./CartSheet";
import SearchBox from "./SearchBox";
import { fetchCollection } from "../lib/api";

const DEFAULT_NAV = [
    { to: "/what-we-do", label: "What We Do" },
    { to: "/books", label: "Bookstore" },
    { to: "/events", label: "Events" },
    { to: "/academy", label: "Academy" },
    { to: "/digital-solutions", label: "Digital Solutions" },
    { to: "/authors", label: "Authors" },
    { to: "/media", label: "Media" },
    { to: "/about", label: "About" },
];

export default function Header() {
    const { count, setIsOpen } = useCart();
    const { isAuthenticated, isAdmin, user, logout } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const [navItems, setNavItems] = useState(DEFAULT_NAV);
    const nav = useNavigate();
    const accountRef = useRef(null);

    /*
     * Close the account menu on an outside click rather than on the trigger's
     * blur. The old `onBlur` + setTimeout closed the menu 150ms after focus
     * left the button — so on any click slower than that, the <Link> unmounted
     * between mousedown and mouseup and the navigation never fired. Clicking
     * "Admin Dashboard" or "My Orders" appeared to do nothing, with no error.
     *
     * `mousedown` on the item still runs before this handler's own close, and
     * React Router's click handler fires on mouseup against a link that is
     * still mounted.
     */
    useEffect(() => {
        if (!accountOpen) return undefined;
        const onDown = (e) => {
            if (accountRef.current && !accountRef.current.contains(e.target)) {
                setAccountOpen(false);
            }
        };
        const onKey = (e) => e.key === "Escape" && setAccountOpen(false);
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [accountOpen]);

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


    return (
        <>
            <header
                data-testid="site-header"
                className="sticky top-0 z-40 border-b border-[#002B5C]/10 bg-[#FFFFFF]/85 backdrop-blur-xl"
            >
                <div className="flex items-center justify-between gap-4 px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 h-20">
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

                    {/* Desktop nav shows from lg (1024px). It used to be xl (1280px),
                        which meant a maximised 1280px window fell ~15px short once the
                        scrollbar was subtracted from the viewport — so the full nav
                        silently collapsed to the hamburger on common laptop screens. */}
                    <nav className="hidden lg:flex items-center gap-3 xl:gap-5">
                        {navItems.map((n) => (
                            <NavLink
                                key={n.to}
                                to={n.to}
                                data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                                className={({ isActive }) =>
                                    `text-[13px] xl:text-sm font-medium whitespace-nowrap transition-colors ${isActive ? "text-[#002B5C]" : "text-[#4B5563] hover:text-[#002B5C]"}`
                                }
                            >
                                {n.label}
                            </NavLink>
                        ))}
                    </nav>

                    <div className="flex items-center gap-2 flex-shrink-0">
                        <SearchBox className="hidden md:block w-36 lg:w-40 xl:w-52" />
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
                            <div className="relative hidden md:block" ref={accountRef}>
                                <button
                                    onClick={() => setAccountOpen((o) => !o)}
                                    data-testid="header-account-button"
                                    aria-haspopup="menu"
                                    aria-expanded={accountOpen}
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
                                            onClick={() => setAccountOpen(false)}
                                            data-testid="header-my-account-link"
                                            className="block px-4 py-2 text-sm hover:bg-[#F5F7FA]"
                                        >
                                            My Orders
                                        </Link>
                                        {isAdmin && (
                                            <Link
                                                to="/admin"
                                                onClick={() => setAccountOpen(false)}
                                                data-testid="header-admin-link"
                                                className="block px-4 py-2 text-sm hover:bg-[#F5F7FA] text-[#CC0033]"
                                            >
                                                Admin Dashboard
                                            </Link>
                                        )}
                                        <button
                                            onClick={() => {
                                                setAccountOpen(false);
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

                        {/* Phones hide the inline search box, so without this there was
                            no way to search from the header at all. */}
                        <button
                            onClick={() => {
                                setSearchOpen((o) => !o);
                                setMobileOpen(false);
                            }}
                            data-testid="mobile-search-toggle"
                            aria-label={searchOpen ? "Close search" : "Search"}
                            aria-expanded={searchOpen}
                            className="md:hidden p-2 hover:bg-[#F5F7FA]"
                        >
                            {searchOpen ? <X size={18} strokeWidth={1.5} /> : <Search size={18} strokeWidth={1.5} />}
                        </button>

                        <button
                            onClick={() => {
                                setMobileOpen(!mobileOpen);
                                setSearchOpen(false);
                            }}
                            data-testid="mobile-menu-toggle"
                            className="lg:hidden p-2 hover:bg-[#F5F7FA]"
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

                {searchOpen && (
                    <div className="md:hidden border-t border-[#002B5C]/10 bg-white px-6 py-3" data-testid="mobile-search-row">
                        <SearchBox className="w-full" autoFocus onNavigate={() => setSearchOpen(false)} />
                    </div>
                )}

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
                            <SearchBox
                                className="mt-2"
                                inputClassName="h-10"
                                placeholder="Search books"
                                onNavigate={() => setMobileOpen(false)}
                            />
                        </nav>
                    </div>
                )}
            </header>
            <CartSheet />
        </>
    );
}
