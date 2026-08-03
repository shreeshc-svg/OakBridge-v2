import React from "react";

/**
 * Payment state of an order, shown wherever orders are listed.
 *
 * WHY THIS EXISTS
 *
 * Neither the dashboard nor the Orders table showed payment status, so an
 * abandoned checkout looked exactly like a completed sale: same order number,
 * same customer name, same rupee figure, same weight on the page. The revenue
 * tiles were right — they filter on payment_status — but the lists beneath them
 * were not, and reading a ₹600 unpaid order as a sale is how someone ends up
 * asking why no confirmation email arrived, or worse, packing a book for it.
 *
 * PENDING IS NOT A FAILURE, AND IS THE ONE TO LOOK AT
 *
 * "Pending" means the order record exists but no payment confirmation ever
 * reached us. Usually the customer closed Razorpay — nothing owed, nothing to
 * do. Occasionally it means they DID pay and the confirmation never arrived,
 * in which case money has been taken for a book nobody is packing. Only the
 * Razorpay dashboard can tell the two apart, which is why this reads "pending"
 * rather than anything more confident.
 */
const STATES = {
    paid: { label: "Paid", fg: "#0F6E56", bg: "#E1F5EE" },
    failed: { label: "Failed", fg: "#A32D2D", bg: "#FCEBEB" },
    refunded: { label: "Refunded", fg: "#5F5E5A", bg: "#F1EFE8" },
    pending: { label: "Pending", fg: "#854F0B", bg: "#FAEEDA" },
};

export default function PaymentBadge({ status, className = "" }) {
    const key = String(status || "pending").toLowerCase();
    const s = STATES[key] || STATES.pending;
    return (
        <span
            data-testid={`payment-status-${key}`}
            title={
                key === "pending"
                    ? "No payment confirmation received. Usually an abandoned checkout — check Razorpay if you expected this one to complete."
                    : undefined
            }
            className={`inline-block font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 whitespace-nowrap ${className}`}
            style={{ color: s.fg, backgroundColor: s.bg }}
        >
            {s.label}
        </span>
    );
}
