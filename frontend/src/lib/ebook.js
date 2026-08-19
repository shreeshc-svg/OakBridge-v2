/**
 * One place that decides what a title's eBook edition costs and whether it can
 * be shown.
 *
 * The tile and the product page ask the same three questions and must never
 * answer them differently — a price on the listing that disappears on the page
 * it links to reads as a bug to the customer and as a pricing error to us. So
 * the questions live here rather than being re-implemented either side.
 */

/** Strip the price of anything that isn't a positive number. */
const positive = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * What the eReader charges, GST included.
 *
 * Prices are stored ex-GST — one rate, set in Admin → E-Books, is applied at
 * display time. Storing the gross figure per title would mean re-uploading
 * every row the day the rate changes, and quietly leaving behind the ones
 * nobody remembered.
 *
 * Rounded to whole rupees to match every other price on the site.
 */
export const ebookGrossPrice = (book, site) => {
    const base = positive(book?.ebook_price);
    if (base === null) return null;
    const pct = Number(site?.ebook_gst_percent);
    const rate = Number.isFinite(pct) && pct >= 0 ? pct : 0;
    /*
     * Multiply before dividing. `base * (1 + rate/100)` computes the rate as a
     * float first, and at ₹100 with 0.5% that lands on 100.49999999999999 —
     * which rounds DOWN to ₹100 and prices the title a rupee under what the
     * eReader charges. Scaling by whole percent keeps the arithmetic exact
     * until the single division at the end.
     */
    return Math.round((base * (100 + rate)) / 100);
};

/**
 * Everything a card or a product page needs to render the eBook edition.
 *
 * `price` is non-null only when the title is also linked, because a price with
 * nowhere to buy it is an advertisement for something the customer cannot get.
 * The gates are read in one place so "hide all eBook buttons" really does hide
 * everything, prices included.
 *
 * @param placement "plp" for listings and tiles, "pdp" for the product page.
 */
export const ebookEdition = (book, site, placement = "plp") => {
    const isOn = (v, fallback = "on") => String(v ?? fallback).toLowerCase() !== "off";

    const url = (book?.ebook_url || "").trim();
    const featureOn = isOn(site?.ebook_enabled);
    const markOn = isOn(placement === "pdp" ? site?.ebook_pdp_enabled : site?.ebook_plp_enabled);
    const priceOn = isOn(
        placement === "pdp" ? site?.ebook_price_pdp_enabled : site?.ebook_price_plp_enabled,
        "off",
    );

    const linked = featureOn && markOn && Boolean(url);
    const gross = ebookGrossPrice(book, site);

    return {
        url,
        /** The eBook mark/CTA may be shown for this title. */
        linked,
        /** The price pair is switched on for this placement — reserve the row. */
        pricingOn: featureOn && priceOn,
        /** The price to print, or null if there is nothing showable. */
        price: featureOn && priceOn && linked ? gross : null,
    };
};
