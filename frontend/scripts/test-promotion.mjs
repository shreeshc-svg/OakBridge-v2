/**
 * The cart's festive-offer preview (lib/promotion.js) must agree with the
 * server (backend/promotions_core.py) — same cases as test_promotions.py.
 *
 *     node frontend/scripts/test-promotion.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const { promoDiscount, eligibleSubtotal } = await import(pathToFileURL(join(SRC, "lib", "promotion.js")).href);
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };

const d = { kind: "percent", value: 10, max_discount: 500, min_order: 999 };
const items = [{ price: 600, quantity: 2 }, { price: 649, quantity: 1, product_type: "hamper" },
    { price: 476, quantity: 1, preorder: true }, { price: 1756, quantity: 1, product_type: "pack" }];
check(eligibleSubtotal(items) === 2956, "hampers and pre-orders excluded, packs included");
check(promoDiscount(d, items, 4081) === 296, "10% of eligible, whole rupees");
check(promoDiscount(d, [{ price: 9000, quantity: 1 }], 9000) === 500, "capped");
check(promoDiscount(d, [{ price: 800, quantity: 1 }], 800) === 0, "below minimum: nothing");
check(promoDiscount({ ...d, kind: "flat", value: 150, max_discount: 0 }, [{ price: 100, quantity: 1 }], 1200) === 100, "flat never more than eligible");
check(promoDiscount(null, items, 4081) === 0, "no promotion");

console.log("-- storefront wiring --");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ctx = strip(readFileSync(join(SRC, "context", "CartContext.jsx"), "utf8"));
check(/promoOff >= couponOff \? "promo" : "coupon"/.test(ctx), "better of coupon / promotion, tie to the promotion (as the server)");
check(/if \(isPrerender\(\)\) return;\s*try \{\s*const c = JSON\.parse\(localStorage\.getItem\(PROMO_KEY\)/.test(ctx), "never baked into the prerender");
const layout = readFileSync(join(SRC, "components", "Layout.jsx"), "utf8");
check(/<PromoStrip \/>\s*<Header \/>/.test(layout), "banner strip above the header on every page");
const co = readFileSync(join(SRC, "pages", "Checkout.jsx"), "utf8");
check(co.includes("<PromoCartLine coupon={coupon} onRemoveCoupon={clearCoupon} />"), "checkout shows the occasion's line");
check(readFileSync(join(SRC, "pages", "BookDetail.jsx"), "utf8").includes("<PromoBadge book={book} />"), "book page badge");
check(readFileSync(join(SRC, "lib", "adminNav.js"), "utf8").includes('label: "Coupons & Promotions"'), "admin menu renamed");

console.log();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log("all checks passed");
