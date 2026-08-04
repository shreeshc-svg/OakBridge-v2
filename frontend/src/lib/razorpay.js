/**
 * Loading the Razorpay Checkout script.
 *
 * Shared rather than copied: Checkout and the emailed payment link both open
 * the same popup, and two copies of a loader would be two places for the script
 * URL to drift. Resolves false rather than throwing, so a caller can say "the
 * payment library did not load" instead of showing a stack trace to someone
 * trying to buy a book.
 *
 * Safe to call repeatedly — it returns immediately once the script is present.
 */
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export function loadRazorpay() {
    return new Promise((resolve) => {
        if (window.Razorpay) {
            resolve(true);
            return;
        }
        const script = document.createElement("script");
        script.src = RAZORPAY_SCRIPT;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}
