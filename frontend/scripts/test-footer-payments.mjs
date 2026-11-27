/*
 * Footer "We accept" strip (Nov 2026): lists only what our Razorpay checkout
 * offers, falls back to text when a logo file is missing, and claims no seal
 * we don't hold. Run: node scripts/test-footer-payments.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed++; };
const pm = readFileSync(join(SRC, "components/PaymentMethods.jsx"), "utf8");
const code = pm.replace(/\/\*[\s\S]*?\*\//g, "");
const keys = [...code.matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
check(JSON.stringify(keys) === JSON.stringify(["upi", "visa", "mastercard", "rupay", "netbanking", "wallets"]), "UPI, Visa, Mastercard, RuPay, net banking, wallets");
check(!/amex|american express|diners|globalsign|norton|mcafee/i.test(code), "no Amex/Diners until enabled on Razorpay; no third-party seal");
check(/onError=\{\(\) => setImg\(false\)\}/.test(code), "a missing logo falls back to the name, never a broken image");
const co = readFileSync(join(SRC, "pages/Checkout.jsx"), "utf8");
check(!/\bmethod: \{/.test(co) && /UPI, cards, net-banking and wallets/.test(co), "checkout has no method filter and promises the same list");
const ft = readFileSync(join(SRC, "components/Footer.jsx"), "utf8");
check(/<PaymentMethods \/>[\s\S]*Bottom bar/.test(ft), "shown in the footer, above the copyright bar");
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
