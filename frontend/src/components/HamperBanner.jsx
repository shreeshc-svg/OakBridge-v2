import React from "react";
import { Link } from "react-router-dom";
import { mediaUrl } from "../lib/api";

/**
 * The gifting banner: a photograph the admin uploads, and nothing else.
 *
 * Deliberately not a composed layout with headings and buttons drawn over the
 * image. Seasonal creative arrives finished from a designer, and every text
 * layer we add on top is one more thing that collides with the artwork, wraps
 * badly at 390px, or has to be re-styled the next festival. The image IS the
 * banner; the only decisions left are where it links and what it says to a
 * screen reader.
 *
 * Two crops, because a wide hero is unreadable on a phone — a 1600px banner
 * scaled to 390px turns 40px type into 10px type. `image_mobile` is optional and
 * falls back to the desktop file rather than showing nothing.
 */
export default function HamperBanner({ banner }) {
    const image = (banner?.image || "").trim();
    if (!banner?.enabled || !image) return null;

    const mobile = (banner.image_mobile || "").trim() || image;
    // Required, not optional. A banner is often the largest clickable thing on
    // the homepage, and img-alt is a sanity check for a reason — but an empty
    // string here is the correct ARIA answer only for decoration, and this is
    // not decoration, it is the offer.
    const alt = (banner.alt || "").trim() || "Oakbridge gift hampers";
    const to = (banner.link || "/gifting").trim();

    /*
     * By default the banner shows WHOLE, at its own aspect ratio.
     *
     * An image's height follows from its width and its shape. There is no way
     * to make the strip shorter while still showing every pixel — the only
     * options are to cut the edges off or to letterbox it — so the default does
     * neither, and the strip is simply as tall as the picture is. To get a
     * shorter banner, upload a wider, shorter crop.
     *
     * A cap is available for when a very tall file would otherwise eat the fold:
     *   contain — the whole image, letterboxed inside the cap. Nothing is lost.
     *   cover   — fills the strip and crops what does not fit.
     * Only from `md` up: a cap meant for a 1600px screen turns a 390px phone
     * into a slot.
     */
    const cap = Number(banner.max_height) || 0;
    const crops = banner.fit === "cover";
    const picture = (
        <picture>
            <source media="(max-width: 767px)" srcSet={mediaUrl(mobile)} />
            <img
                src={mediaUrl(image)}
                alt={alt}
                /* eager + high priority: this sits near the top of the homepage,
                   so lazy-loading it would make it the thing that arrives last
                   and shifts the page as it lands. */
                loading="eager"
                fetchpriority="high"
                style={cap ? { "--banner-cap": `${cap}px` } : undefined}
                className={[
                    "w-full block h-auto",
                    // max-h, not h: a picture shorter than the cap is left alone
                    // rather than stretched up to meet it.
                    cap ? "md:max-h-[var(--banner-cap)]" : "",
                    cap ? (crops ? "md:object-cover" : "md:object-contain") : "",
                    cap ? "object-center" : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
            />
        </picture>
    );

    return (
        <section data-testid="hamper-banner" className="w-full">
            {/^https?:\/\//i.test(to) ? (
                <a href={to} target="_blank" rel="noopener noreferrer">{picture}</a>
            ) : (
                <Link to={to}>{picture}</Link>
            )}
        </section>
    );
}
