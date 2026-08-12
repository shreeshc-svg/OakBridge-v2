import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import ChatWidget from "./ChatWidget";
import BackToTop from "./BackToTop";
import BottomTray from "./BottomTray";
import CookieConsent from "./CookieConsent";
import { Toaster } from "./ui/sonner";
import { trackPageview } from "../lib/analytics";

export default function Layout() {
    const loc = useLocation();
    React.useEffect(() => {
        window.scrollTo(0, 0);
    }, [loc.pathname]);

    /*
     * Pageviews are ours to send, not PostHog's to guess.
     *
     * This is a single-page app: moving from the bookstore to a book changes
     * the URL without a document load, so PostHog's automatic capture records
     * the first screen a visitor lands on and then nothing for the rest of
     * their session. Every funnel built on that would be wrong in the same
     * direction — every journey looking one page long.
     *
     * Keyed on pathname + search so /books?category=academic counts separately
     * from /books, which is the distinction the catalogue is built around.
     */
    React.useEffect(() => {
        trackPageview(loc.pathname + loc.search);
    }, [loc.pathname, loc.search]);
    return (
        <div className="min-h-screen flex flex-col bg-[#FFFFFF]">
            <Header />
            <main className="flex-1">
                <Outlet />
            </main>
            <Footer />
            {/* Spacer so page content clears the mobile bottom tray, including the
                home-indicator inset on notched phones (a flat 4rem left content hidden). */}
            <div className="h-tray md:hidden" aria-hidden="true" />
            <BackToTop />
            <ChatWidget />
            <BottomTray />
            <CookieConsent />
            <Toaster position="bottom-right" />
        </div>
    );
}
