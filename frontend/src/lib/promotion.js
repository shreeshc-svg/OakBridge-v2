/**
 * Festive promotion — the browser's preview of backend/promotions_core.py.
 *
 * Same rules, so the cart shows what the order will charge: hampers and live
 * pre-orders don't earn the discount (but count towards the minimum order);
 * % off is rounded to whole rupees and capped; flat off is never more than
 * the eligible books are worth. The server recomputes it at order time — this
 * is only what the customer sees beforehand.
 */
export const PROMO_KEY = "oakbridge_promo_v1";

export const eligibleSubtotal = (items) =>
    (items || []).reduce((n, i) => ((i.product_type || "book") === "hamper" || i.preorder ? n
        : n + Number(i.price || 0) * Number(i.quantity || 0)), 0);

export function promoDiscount(promo, items, subtotal) {
    if (!promo) return 0;
    const eligible = eligibleSubtotal(items);
    if (eligible <= 0 || subtotal < Number(promo.min_order || 0)) return 0;
    let d = promo.kind === "percent" ? Math.round((eligible * Number(promo.value)) / 100) : Number(promo.value);
    if (promo.kind === "percent" && Number(promo.max_discount) > 0) d = Math.min(d, Number(promo.max_discount));
    return Math.min(d, eligible);
}
