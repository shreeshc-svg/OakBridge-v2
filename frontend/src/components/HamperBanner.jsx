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
     * Height is capped rather than left to the file's own aspect ratio. A
     * full-width photograph at 1600px wide is around 500px tall, which is most
     * of a laptop screen and pushes everything under it below the fold. Cropped
     * from the centre with object-cover, never squashed — a squashed banner
     * looks like a mistake, a cropped one looks deliberate.
     *
     * Only applied from `md` up: on a phone the mobile crop should run at its
     * natural ratio, and a 320px cap on a 390px-wide screen would cut it to a
     * letterbox.
     */
    const cap = Number(banner.max_height) || 0;
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
                className={
                    cap
                        ? "w-full block object-cover object-center h-auto md:h-[var(--banner-cap)]"
                        : "w-full h-auto block"
                }
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
