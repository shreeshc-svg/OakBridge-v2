import React, { useState } from "react";
import { Lock } from "lucide-react";
import { useHydrated } from "../lib/boot";
import { isPrerender } from "../lib/runtime";

/*
 * "How can I pay?" in the footer (Nov 2026), modelled on the payments strip
 * in a competitor's footer: shoppers look for the card they hold and a
 * "secure" sign before they trust a checkout they haven't used.
 *
 * ONLY what our Razorpay checkout actually offers. Checkout.jsx opens the
 * standard Razorpay Checkout with no method filter, so the customer sees
 * every method enabled on the Razorpay account: UPI, cards (Visa,
 * Mastercard, RuPay are on by default), net banking and wallets — the same
 * list Checkout.jsx already promises. American Express and Diners need a
 * separate activation on Razorpay, so they are NOT listed until that is
 * confirmed in Razorpay Dashboard -> Account & Settings -> Payment methods.
 * Add them here only then — a badge for a card we can't take is worse than
 * no badge.
 *
 * Logos: the official acceptance marks go in public/payments/<file> (Razorpay
 * and the card networks publish them for merchants). Until a file is there,
 * or if it fails to load, the badge shows the method's name instead, so the
 * strip is never a row of broken images. No third-party "secure" seal is
 * shown: we don't hold one, and a seal we don't hold is a false claim.
 */
export const PAYMENT_METHODS = [
    { key: "upi", label: "UPI", file: "upi.svg" },
    { key: "visa", label: "Visa", file: "visa.svg" },
    { key: "mastercard", label: "Mastercard", file: "mastercard.svg" },
    { key: "rupay", label: "RuPay", file: "rupay.svg" },
    { key: "netbanking", label: "Net banking", file: null },
    { key: "wallets", label: "Wallets", file: null },
];

/*
 * Text on the prerender and on the hydrating render; the logo is tried only
 * after that. The prerender used to try the <img>, see it fail (no file yet)
 * and bake the text fallback into the page, while the browser's first render
 * drew the <img> — a hydration mismatch (React #418, seen live 27 Nov 2026)
 * that made React throw away and redraw every page.
 */
function Badge({ m }) {
    const hydrated = useHydrated();
    const [failed, setFailed] = useState(false);
    const img = Boolean(m.file) && hydrated && !isPrerender() && !failed;
    return (
        <li className="h-8 min-w-[56px] px-2.5 bg-white rounded-[3px] flex items-center justify-center" title={m.label} data-testid={`pay-${m.key}`}>
            {img ? (
                <img src={`/payments/${m.file}`} alt={m.label} className="h-5 w-auto" loading="lazy" onError={() => setFailed(true)} />
            ) : (
                <span className="text-[11px] font-semibold text-[#002B5C] whitespace-nowrap">{m.label}</span>
            )}
        </li>
    );
}

export default function PaymentMethods() {
    return (
        <div className="pt-10 flex flex-col md:flex-row md:items-center gap-4 md:gap-8" data-testid="footer-payments">
            <div className="overline !text-white/50 shrink-0">We accept</div>
            <ul className="flex flex-wrap gap-2" aria-label="Payment methods we accept">
                {PAYMENT_METHODS.map((m) => <Badge key={m.key} m={m} />)}
            </ul>
            <p className="text-xs text-white/60 flex items-center gap-2 md:ml-auto max-w-sm">
                <Lock size={14} strokeWidth={1.5} className="shrink-0 text-[#F59E0B]" aria-hidden="true" />
                <span>Secure checkout by Razorpay. Your card and bank details go to Razorpay, never to us.</span>
            </p>
        </div>
    );
}
