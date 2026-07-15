import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { XCircle, RefreshCw } from "lucide-react";
import { fetchOrder, formatINR } from "../lib/api";

const REASONS = [
    "Your bank declined the payment, or there were insufficient funds.",
    "Card details (number, expiry or CVV) were entered incorrectly.",
    "The bank OTP / 3-D Secure step wasn't completed or timed out.",
    "International, online or high-value transactions are disabled on the card, or a limit was reached.",
    "A UPI request expired or was declined in your payments app.",
    "The payment window was closed, or the connection dropped before it finished.",
];

export default function PaymentFailed() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchOrder(id)
            .then(setOrder)
            .catch(() => setOrder(null))
            .finally(() => setLoading(false));
    }, [id]);

    return (
        <div data-testid="payment-failed-page" className="px-6 md:px-12 lg:px-16 py-20">
            <div className="max-w-2xl mx-auto text-center">
                <XCircle size={56} strokeWidth={1} className="mx-auto text-[#CC0033]" />
                <div className="overline mt-8">Payment Unsuccessful</div>
                <h1 className="font-serif text-5xl md:text-6xl mt-3 text-[#002B5C] leading-none">
                    Payment didn't go through.
                </h1>
                <p className="mt-5 text-[#4B5563] max-w-lg mx-auto">
                    {order
                        ? "Don't worry — your order is saved and nothing extra has been charged. You can try the payment again."
                        : "Your payment couldn't be completed. Nothing has been charged for a failed attempt."}
                </p>

                {order && (
                    <div className="mt-8 inline-flex items-center gap-3 font-mono text-sm bg-white border border-[#002B5C] px-5 py-3">
                        <span className="overline !text-[10px]">Order Number</span>
                        <span data-testid="failed-order-number" className="text-[#002B5C]">
                            {order.order_number}
                        </span>
                        {!loading && order.total != null && (
                            <span className="text-[#4B5563]">· {formatINR(order.total)}</span>
                        )}
                    </div>
                )}
            </div>

            <div className="mt-14 max-w-2xl mx-auto border border-[#E5E7EB] bg-white p-6">
                <div className="overline">Why this can happen</div>
                <ul className="mt-4 space-y-2 text-sm text-[#4B5563] list-disc pl-5">
                    {REASONS.map((r) => (
                        <li key={r}>{r}</li>
                    ))}
                </ul>
                <p className="mt-5 text-xs text-[#4B5563] border-t border-[#E5E7EB] pt-4">
                    If an amount was debited for a failed payment, it is normally
                    auto-reversed by your bank within 5–7 working days. If you're
                    unsure, email us at{" "}
                    <a href="mailto:info@oakbridge.in" className="text-[#002B5C] underline">
                        info@oakbridge.in
                    </a>{" "}
                    with your order number and we'll help.
                </p>
            </div>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
                <Link
                    to="/checkout"
                    data-testid="retry-payment-link"
                    className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-7 py-4 text-sm font-medium hover:bg-[#001F42] transition-colors"
                >
                    <RefreshCw size={16} strokeWidth={1.75} />
                    Retry payment
                </Link>
                <Link
                    to="/contact"
                    className="inline-flex items-center gap-2 border border-[#002B5C] px-7 py-4 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                >
                    Contact support
                </Link>
            </div>
        </div>
    );
}
