import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import ChatWidget from "./ChatWidget";
import BackToTop from "./BackToTop";
import BottomTray from "./BottomTray";
import CookieConsent from "./CookieConsent";
import { Toaster } from "./ui/sonner";

export default function Layout() {
    const loc = useLocation();
    React.useEffect(() => {
        window.scrollTo(0, 0);
    }, [loc.pathname]);
    return (
        <div className="min-h-screen flex flex-col bg-[#FFFFFF]">
            <Header />
            <main className="flex-1">
                <Outlet />
            </main>
            <Footer />
            {/* Spacer so page content clears the mobile bottom tray */}
            <div className="h-16 md:hidden" aria-hidden="true" />
            <BackToTop />
            <ChatWidget />
            <BottomTray />
            <CookieConsent />
            <Toaster position="bottom-right" />
        </div>
    );
}
