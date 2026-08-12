import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { fetchOrder, formatINR, mediaUrl } from "../lib/api";
import { track } from "../lib/analytics";

export default function OrderConfirmation() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchOrder(id)
            .then(setOrder)
            .catch(() => setOrder(null))
            .finally(() => setLoading(false));
    }, [id]);

    /*
     * Revenue, counted once per order and only when the money actually arrived.
     *
     * Two traps this avoids. First, this page is a plain URL: a customer can
     * refresh it, bookmark it, or open it from the receipt email a week later,
     * and each visit would post another purchase. The order id is written to
     * sessionStorage so a revisit is silent — sessionStorage rather than
     * localStorage so a genuine second purchase of the same order can never be
     * suppressed by stale state on a shared machine.
     *
     * Second, an order exists before it is paid. Landing here after abandoning
     * the Razorpay popup would otherwise book revenue that never came in — the
     * same mistake the admin revenue tile used to make. Only payment_status
     * "paid" counts.
     */
    useEffect(() => {
        if (!order || order.payment_status !== "paid") return;
        const seen = `ph_purchase_${order.id}`;
        try {
            if (sessionStorage.getItem(seen)) return;
            sessionStorage.setItem(seen, "1");
        } catch {
            /* private mode: risk a duplicate rather than lose the event */
        }
        track("purchase", {
            order_number: order.order_number,
            value: order.total,
            currency: "INR",
            item_count: (order.items || []).reduce((n, i) => n + (i.quantity || 1), 0),
            coupon: order.coupon_code || null,
        });
    }, [order]);

    if (loading) {
        return (
            <div className="py-32 text-center font-mono text-xs text-[#4B5563]">
                Loading order…
            </div>
        );
    }
    if (!order) {
        return (
            <div className="py-32 text-center">
                <h1 className="font-serif text-4xl text-[#002B5C]">
                    Order not found.
                </h1>
                <Link
                    to="/books"
                    className="mt-6 inline-flex border-b border-[#002B5C] text-sm pb-0.5"
                >
                    Back to bookstore
                </Link>
            </div>
        );
    }

    return (
        <div
            data-testid="order-confirmation-page"
            className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20"
        >
            <div className="max-w-3xl mx-auto text-center">
                <CheckCircle2
                    size={56}
                    strokeWidth={1}
                    className="mx-auto text-[#16A34A]"
                />
                <div className="overline mt-8">Order Confirmed</div>
                <h1 className="font-serif text-5xl md:text-6xl mt-3 text-[#002B5C] leading-none">
                    Thank you, {order.full_name.split(" ")[0]}.
                </h1>
                <p className="mt-5 text-[#4B5563] max-w-lg mx-auto">
                    Your order has been recorded. We've sent a copy of your
                    confirmation to <strong>{order.email}</strong>.
                </p>
                <div className="mt-8 inline-flex items-center gap-3 font-mono text-sm bg-white border border-[#002B5C] px-5 py-3">
                    <span className="overline !text-[10px]">Order Number</span>
                    <span
                        data-testid="order-number"
                        className="text-[#002B5C]"
                    >
                        {order.order_number}
                    </span>
                </div>
            </div>

            <div className="mt-16 max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="border border-[#E5E7EB] p-6 bg-white">
                    <div className="overline">Ship to</div>
                    <p className="mt-3 font-serif text-lg text-[#002B5C]">
                        {order.full_name}
                    </p>
                    <p className="text-sm text-[#4B5563] mt-2 leading-relaxed">
                        {order.address_line1}
                        {order.address_line2 && (
                            <>
                                <br />
                                {order.address_line2}
                            </>
                        )}
                        <br />
                        {order.city}, {order.state} {order.pincode}
                        <br />
                        {order.phone}
                    </p>
                </div>
                <div className="border border-[#E5E7EB] p-6 bg-white">
                    <div className="overline">Order Total</div>
                    <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <dt className="text-[#4B5563]">Subtotal</dt>
                            <dd className="font-mono">
                                {formatINR(order.subtotal)}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-[#4B5563]">Shipping</dt>
                            <dd className="font-mono">
                                {order.shipping === 0
                                    ? "Free"
                                    : formatINR(order.shipping)}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-[#4B5563]">Tax</dt>
                            <dd className="font-mono">{formatINR(order.tax)}</dd>
                        </div>
                        <div className="flex justify-between pt-2 mt-2 border-t border-[#E5E7EB]">
                            <dt className="overline">Total</dt>
                            <dd className="font-serif text-2xl text-[#002B5C]">
                                {formatINR(order.total)}
                            </dd>
                        </div>
                    </dl>
                </div>
            </div>

            <div className="mt-12 max-w-3xl mx-auto">
                <div className="overline">Items</div>
                <ul className="mt-4 divide-y divide-[#E5E7EB] border border-[#E5E7EB] bg-white">
                    {order.items.map((i) => (
                        <li
                            key={i.book_id}
                            className="flex gap-4 p-4 items-center"
                        >
                            <img
                                src={mediaUrl(i.cover_image)}
                                alt={i.title}
                                className="w-14 h-20 object-cover border border-[#E5E7EB]"
                            />
                            <div className="flex-1">
                                <div className="font-serif text-lg text-[#002B5C]">
                                    {i.title}
                                </div>
                                <div className="text-xs text-[#4B5563]">
                                    {i.author} · Qty {i.quantity}
                                </div>
                            </div>
                            <div className="font-mono text-sm text-[#002B5C]">
                                {formatINR(i.price * i.quantity)}
                            </div>
                        </li>
                    ))}
                </ul>
            </div>

            <div className="mt-14 text-center">
                <Link
                    to="/books"
                    data-testid="continue-shopping-link"
                    className="inline-flex items-center gap-2 border border-[#002B5C] px-7 py-4 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                >
                    Continue shopping
                </Link>
            </div>
        </div>
    );
}
