import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const KEY = "oakbridge_cookie_consent";

export default function CookieConsent() {
    const [show, setShow] = useState(false);

    useEffect(() => {
        try {
            if (!localStorage.getItem(KEY)) setShow(true);
        } catch {
            /* ignore */
        }
    }, []);

    const accept = () => {
        try {
            localStorage.setItem(KEY, "accepted");
        } catch {
            /* ignore */
        }
        setShow(false);
    };

    if (!show) return null;

    return (
        <div
            data-testid="cookie-consent"
            className="fixed z-[45] left-4 right-4 bottom-above-tray md:bottom-4 md:right-auto md:max-w-md bg-white border border-[#E5E7EB] shadow-2xl p-4"
        >
            <div className="text-sm text-[#4B5563] leading-relaxed">
                We use essential cookies and local storage to keep you signed in and
                remember your cart. We don't use tracking or advertising cookies. See our{" "}
                <Link to="/cookie-policy" className="text-[#002B5C] underline">
                    Cookie Policy
                </Link>
                .
            </div>
            <div className="mt-3 flex items-center gap-4">
                <button
                    type="button"
                    onClick={accept}
                    data-testid="cookie-accept"
                    className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42] transition-colors"
                >
                    Accept
                </button>
                <Link to="/cookie-policy" className="text-xs text-[#4B5563] underline">
                    Learn more
                </Link>
            </div>
        </div>
    );
}
