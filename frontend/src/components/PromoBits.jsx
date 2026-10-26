import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useCart } from "../context/CartContext";
import { formatINR } from "../lib/api";

/**
 * Festive promotion on the storefront (Admin → Coupons & Promotions).
 *
 *   PromoStrip      thin banner above the header on every page
 *   PromoBadge      under the price on a book page
 *   PromoCartLine   "Diwali Sale −₹120" in cart / checkout totals, or the
 *                   coupon line when the coupon saves more
 *   PromoHint       "Add ₹150 more for the Diwali Sale" below the minimum
 *
 * All read the one promotion CartContext loaded after the first render, so
 * nothing here exists in the prerendered page (an offer starts and ends
 * between builds) and none of it can disagree with the cart's totals.
 */
const DISMISS = "oakbridge_promo_strip_closed";
const endsOn = (iso) => {
    try {
        return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    } catch {
        return "";
    }
};

export function PromoStrip() {
    const { promo } = useCart();
    const [closed, setClosed] = useState(true);
    useEffect(() => {
        try { setClosed(sessionStorage.getItem(DISMISS) === promo?.id); } catch { setClosed(false); }
    }, [promo?.id]);
    if (!promo || !promo.banner || closed) return null;
    return (
        <div data-testid="promo-strip" role="region" aria-label={promo.label}
            className="promo-strip relative bg-[#002B5C] text-white text-[12px] md:text-[13px] px-10 py-2 text-center leading-snug">
            <span className="font-semibold text-[#F59E0B]">{promo.label}</span>
            <span className="mx-1.5 opacity-60">·</span>
            <span>{promo.message ? <><span className="hidden md:inline">{promo.message} — </span>{promo.offer}</> : promo.offer}</span>
            <span className="hidden sm:inline opacity-70"> · ends {endsOn(promo.ends_at)}</span>
            <button type="button" aria-label="Close" onClick={() => { setClosed(true); try { sessionStorage.setItem(DISMISS, promo.id); } catch { /* */ } }}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center opacity-70 hover:opacity-100">
                <X size={14} />
            </button>
        </div>
    );
}

export function PromoBadge({ book }) {
    const { promo } = useCart();
    if (!promo || !book || book.product_type === "hamper") return null;
    return (
        <div data-testid="promo-badge" className="mt-3 inline-flex flex-wrap items-center gap-2 border border-[#F59E0B] bg-[#FFF8EB] px-3 py-1.5 text-sm text-[#002B5C]">
            <span className="font-semibold text-[#B45309]">{promo.label}</span>
            <span>{promo.offer} — taken off at checkout</span>
        </div>
    );
}

export function PromoCartLine({ coupon, onRemoveCoupon, className = "" }) {
    const { promo, discount, discountSource, couponOff } = useCart();
    if (!(discount > 0)) return null;
    const isPromo = discountSource === "promo";
    return (
        <>
            <div data-testid={isPromo ? "promo-discount-line" : "checkout-discount-line"} className={`flex justify-between text-[#CC0033] ${className}`}>
                <dt className="flex items-center gap-2">
                    {isPromo ? <span><b>{promo.label}</b></span> : <span>{coupon?.code}</span>}
                    {!isPromo && onRemoveCoupon && (
                        <button type="button" onClick={onRemoveCoupon} data-testid="checkout-coupon-remove" className="text-[#4B5563] hover:text-[#CC0033]" aria-label="Remove coupon">
                            <X size={12} strokeWidth={1.5} />
                        </button>
                    )}
                </dt>
                <dd className="font-mono">−{formatINR(discount)}</dd>
            </div>
            {isPromo && coupon && couponOff > 0 && (
                <p className="text-[11px] text-[#4B5563]" data-testid="promo-beats-coupon">
                    The {promo.label} saves you more than {coupon.code}, so it's applied instead (offers don't combine).
                </p>
            )}
        </>
    );
}

export function PromoHint({ className = "" }) {
    const { promo, promoShort, discountSource } = useCart();
    if (!promo || !(promoShort > 0) || discountSource === "promo") return null;
    return (
        <p data-testid="promo-hint" className={`text-xs text-[#B45309] ${className}`}>
            Add {formatINR(promoShort)} more for the <b>{promo.label}</b>: {promo.offer}.
        </p>
    );
}
