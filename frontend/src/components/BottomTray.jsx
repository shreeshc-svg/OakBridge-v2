import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, BookOpen, ShoppingBag, User, LogIn } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";

// Mobile-only bottom navigation tray. Hidden on md+ (desktop uses the header).
export default function BottomTray() {
    const loc = useLocation();
    const { count, setIsOpen } = useCart();
    const { isAuthenticated } = useAuth();

    const isActive = (p) =>
        p === "/" ? loc.pathname === "/" : loc.pathname.startsWith(p);

    const base =
        "flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-[10px] font-mono uppercase tracking-wide transition-colors";

    const Icon = ({ icon: I, badge }) => (
        <span className="relative">
            <I size={20} strokeWidth={1.75} />
            {badge > 0 && (
                <span className="absolute -top-1.5 -right-2 bg-[#CC0033] text-white text-[9px] font-mono min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full">
                    {badge}
                </span>
            )}
        </span>
    );

    return (
        <nav
            data-testid="bottom-tray"
            className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#E5E7EB] flex items-stretch shadow-[0_-2px_10px_rgba(0,0,0,0.05)] pb-[env(safe-area-inset-bottom)]"
        >
            <Link
                to="/"
                data-testid="tray-home"
                className={`${base} ${isActive("/") ? "text-[#002B5C]" : "text-[#4B5563]"}`}
            >
                <Icon icon={Home} />
                Home
            </Link>
            <Link
                to="/books"
                data-testid="tray-books"
                className={`${base} ${isActive("/books") ? "text-[#002B5C]" : "text-[#4B5563]"}`}
            >
                <Icon icon={BookOpen} />
                Books
            </Link>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                data-testid="tray-cart"
                className={`${base} text-[#4B5563]`}
            >
                <Icon icon={ShoppingBag} badge={count} />
                Cart
            </button>
            {isAuthenticated ? (
                <Link
                    to="/account"
                    data-testid="tray-account"
                    className={`${base} ${isActive("/account") ? "text-[#002B5C]" : "text-[#4B5563]"}`}
                >
                    <Icon icon={User} />
                    Account
                </Link>
            ) : (
                <Link
                    to="/login"
                    data-testid="tray-signin"
                    className={`${base} ${isActive("/login") ? "text-[#002B5C]" : "text-[#4B5563]"}`}
                >
                    <Icon icon={LogIn} />
                    Sign in
                </Link>
            )}
        </nav>
    );
}
