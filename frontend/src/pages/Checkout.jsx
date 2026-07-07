import React, { useEffect, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Tag, X } from "lucide-react";
import { useCart } from "../context/CartContext";
import {
    createOrder,
    createPaymentOrder,
    formatApiError,
    formatINR,
    validateCoupon,
    verifyPayment,
} from "../lib/api";
import { toast } from "sonner";

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpay() {
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

const FIELDS = [
    { name: "full_name", label: "Full Name", type: "text", required: true, col: 2 },
    { name: "email", label: "Email", type: "email", required: true, col: 1 },
    { name: "phone", label: "Phone", type: "tel", required: true, col: 1 },
    { name: "address_line1", label: "Address Line 1", type: "text", required: true, col: 2 },
    { name: "address_line2", label: "Address Line 2 (optional)", type: "text", required: false, col: 2 },
    { name: "city", label: "City", type: "text", required: true, col: 1 },
    { name: "state", label: "State", type: "text", required: true, col: 1 },
    { name: "pincode", label: "Pincode", type: "text", required: true, col: 1 },
];

export default function Checkout() {
    const {
        items,
        subtotal,
        discount,
        shipping,
        tax,
        total,
        clear,
        coupon,
        setCoupon,
        clearCoupon,
    } = useCart();
    const [form, setForm] = useState({
        full_name: "",
        email: "",
        phone: "",
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        pincode: "",
        notes: "",
    });
    const [couponCode, setCouponCode] = useState("");
    const [applyingCoupon, setApplyingCoupon] = useState(false);
    const [couponMsg, setCouponMsg] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [agreed, setAgreed] = useState(false);
    const nav = useNavigate();

    const onChange = (e) =>
        setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

    const onApplyCoupon = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!couponCode.trim()) return;
        setApplyingCoupon(true);
        setCouponMsg(null);
        try {
            const res = await validateCoupon(couponCode.trim(), subtotal);
            if (res.valid) {
                setCoupon({
                    code: res.code,
                    discount: res.discount,
                    kind: res.kind,
                    value: res.value,
                });
                toast.success(res.message);
                setCouponMsg({ type: "success", text: res.message });
                setCouponCode("");
            } else {
                setCouponMsg({ type: "error", text: res.message });
            }
        } catch (err) {
            setCouponMsg({ type: "error", text: formatApiError(err) });
        } finally {
            setApplyingCoupon(false);
        }
    };

    // Preload the Razorpay script as soon as the user opens the page (so the popup is instant when they click Pay)
    useEffect(() => {
        loadRazorpay();
    }, []);

    const onSubmit = async (e) => {
        e.preventDefault();
        if (items.length === 0) {
            toast.error("Your cart is empty.");
            return;
        }
        if (!agreed) {
            toast.error("Please accept the Terms and Privacy Policy to continue.");
            return;
        }
        setSubmitting(true);
        try {
            // 1. Create the local order in the Oakbridge DB (status=pending)
            const order = await createOrder({
                ...form,
                items,
                subtotal,
                shipping,
                tax,
                total,
                coupon_code: coupon?.code || null,
                discount: discount || 0,
            });

            // 2. Create a Razorpay order tied to it
            const rzp = await createPaymentOrder(order.id);

            // 3. Make sure the Razorpay script is on the page
            const ready = await loadRazorpay();
            if (!ready || !window.Razorpay) {
                toast.error("Could not load the payment gateway. Please try again.");
                setSubmitting(false);
                return;
            }

            // 4. Open the Razorpay Checkout popup
            const checkout = new window.Razorpay({
                key: rzp.key_id,
                amount: rzp.amount,
                currency: rzp.currency,
                order_id: rzp.rzp_order_id,
                name: "Oakbridge Publishing",
                description: `Order ${rzp.order_number}`,
                image: "/favicon.ico",
                prefill: {
                    name: form.full_name,
                    email: form.email,
                    contact: form.phone,
                },
                notes: { oakbridge_order_id: order.id },
                theme: { color: "#002B5C" },
                modal: {
                    ondismiss: () => {
                        toast.info("Payment cancelled. Your order is held — try again to complete it.");
                        setSubmitting(false);
                    },
                },
                handler: async (response) => {
                    try {
                        await verifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        });
                        clear();
                        nav(`/order-confirmation/${order.id}`);
                    } catch (err) {
                        toast.error(formatApiError(err) || "Payment verification failed.");
                        setSubmitting(false);
                    }
                },
            });
            checkout.on("payment.failed", (resp) => {
                toast.error(
                    `Payment failed: ${resp?.error?.description || "please try again."}`,
                );
                setSubmitting(false);
            });
            checkout.open();
        } catch (err) {
            toast.error(formatApiError(err));
            setSubmitting(false);
        }
    };

    if (items.length === 0) {
        return (
            <div className="px-6 md:px-12 lg:px-16 py-32 text-center">
                <h1 className="font-serif text-4xl text-[#002B5C]">
                    Your cart is empty.
                </h1>
                <Link
                    to="/books"
                    className="mt-6 inline-flex border-b border-[#002B5C] text-sm pb-0.5"
                >
                    Browse books
                </Link>
            </div>
        );
    }

    return (
        <div data-testid="checkout-page" className="px-6 md:px-12 lg:px-16 py-16">
            <Breadcrumbs inset items={[{ label: "Cart", to: "/cart" }, { label: "Checkout" }]} />
            <div className="overline">Checkout</div>
            <h1 className="font-serif text-5xl md:text-6xl mt-4 text-[#002B5C] leading-none">
                Almost yours.
            </h1>
            <p className="text-sm text-[#4B5563] mt-4 max-w-lg">
                Pay securely with Razorpay — UPI, cards, net-banking and wallets supported.
                We currently process test transactions; use a Razorpay test card
                (e.g. <code className="font-mono text-xs">4111 1111 1111 1111</code>) to verify the flow.
            </p>

            <form
                onSubmit={onSubmit}
                className="mt-12 grid grid-cols-1 lg:grid-cols-12 gap-12"
            >
                <div className="lg:col-span-7 space-y-10">
                    <section>
                        <div className="overline">1 · Shipping Address</div>
                        <div className="mt-6 grid grid-cols-2 gap-5">
                            {FIELDS.map((f) => (
                                <div
                                    key={f.name}
                                    className={f.col === 2 ? "col-span-2" : "col-span-2 sm:col-span-1"}
                                >
                                    <label className="overline !text-[10px] block mb-2">
                                        {f.label}
                                    </label>
                                    <input
                                        type={f.type}
                                        name={f.name}
                                        required={f.required}
                                        value={form[f.name]}
                                        onChange={onChange}
                                        data-testid={`checkout-${f.name.replace(/_/g, "-")}`}
                                        className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <div className="overline">2 · Delivery Notes (optional)</div>
                        <textarea
                            name="notes"
                            value={form.notes}
                            onChange={onChange}
                            data-testid="checkout-notes"
                            rows={3}
                            placeholder="Any special instructions…"
                            className="mt-6 w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C] resize-none"
                        />
                    </section>

                    <section>
                        <div className="overline">3 · Payment</div>
                        <div className="mt-6 border border-[#E5E7EB] bg-white p-6 flex items-start gap-3">
                            <CheckCircle2
                                size={20}
                                strokeWidth={1.5}
                                className="text-[#F59E0B] mt-0.5"
                            />
                            <div>
                                <p className="font-serif text-lg text-[#002B5C]">
                                    Secure payment by Razorpay
                                </p>
                                <p className="text-xs text-[#4B5563] mt-1">
                                    Pay using UPI, cards, net-banking or wallets.
                                    On clicking <strong>Pay & Place Order</strong>,
                                    a secure Razorpay popup will open to complete
                                    your payment.
                                </p>
                            </div>
                        </div>
                    </section>
                </div>

                <aside className="lg:col-span-5">
                    <div className="sticky top-24 border border-[#002B5C] p-8 bg-white">
                        <div className="overline">Order Summary</div>
                        <div className="mt-5 space-y-4 max-h-80 overflow-y-auto pr-2">
                            {items.map((i) => (
                                <div
                                    key={i.book_id}
                                    className="flex gap-3 text-sm"
                                >
                                    <img
                                        src={i.cover_image}
                                        alt={i.title}
                                        className="w-12 h-16 object-cover border border-[#E5E7EB]"
                                    />
                                    <div className="flex-1">
                                        <div className="font-serif text-base text-[#002B5C] leading-tight line-clamp-2">
                                            {i.title}
                                        </div>
                                        <div className="text-xs text-[#4B5563] mt-0.5">
                                            Qty {i.quantity}
                                        </div>
                                    </div>
                                    <div className="font-mono text-xs text-[#002B5C]">
                                        {formatINR(i.price * i.quantity)}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <dl className="mt-6 pt-6 border-t border-[#E5E7EB] space-y-3 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-[#4B5563]">Subtotal</dt>
                                <dd className="font-mono text-[#002B5C]">
                                    {formatINR(subtotal)}
                                </dd>
                            </div>
                            {discount > 0 && coupon && (
                                <div
                                    data-testid="checkout-discount-line"
                                    className="flex justify-between text-[#CC0033]"
                                >
                                    <dt className="flex items-center gap-2">
                                        <Tag size={12} strokeWidth={1.5} />
                                        {coupon.code}
                                        <button
                                            type="button"
                                            onClick={clearCoupon}
                                            data-testid="checkout-coupon-remove"
                                            className="text-[#4B5563] hover:text-[#CC0033]"
                                        >
                                            <X size={12} strokeWidth={1.5} />
                                        </button>
                                    </dt>
                                    <dd className="font-mono">
                                        −{formatINR(discount)}
                                    </dd>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <dt className="text-[#4B5563]">Shipping</dt>
                                <dd className="font-mono text-[#002B5C]">
                                    {shipping === 0 ? "Free" : formatINR(shipping)}
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-[#4B5563]">Tax (5%)</dt>
                                <dd className="font-mono text-[#002B5C]">
                                    {formatINR(tax)}
                                </dd>
                            </div>
                        </dl>

                        {!coupon && (
                            <div data-testid="coupon-form" className="mt-4">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={couponCode}
                                        onChange={(e) => {
                                            setCouponCode(e.target.value);
                                            if (couponMsg) setCouponMsg(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                onApplyCoupon();
                                            }
                                        }}
                                        placeholder="Coupon code"
                                        data-testid="coupon-input"
                                        className="flex-1 border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                    <button
                                        type="button"
                                        onClick={onApplyCoupon}
                                        disabled={applyingCoupon || !couponCode.trim()}
                                        data-testid="apply-coupon-button"
                                        className="px-4 py-2 text-xs font-medium border border-[#002B5C] hover:bg-[#F5F7FA] disabled:opacity-50"
                                    >
                                        {applyingCoupon ? "…" : "Apply"}
                                    </button>
                                </div>
                                {couponMsg && (
                                    <div
                                        data-testid="coupon-message"
                                        className={`mt-2 text-xs ${couponMsg.type === "error" ? "text-[#CC0033]" : "text-green-700"}`}
                                    >
                                        {couponMsg.text}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="mt-5 pt-5 border-t border-[#E5E7EB] flex justify-between items-baseline">
                            <span className="overline">Total</span>
                            <span className="font-serif text-3xl text-[#002B5C]">
                                {formatINR(total)}
                            </span>
                        </div>
                        <label
                            htmlFor="checkout-consent"
                            className="mt-6 flex items-start gap-3 text-xs text-[#4B5563] cursor-pointer"
                        >
                            <input
                                id="checkout-consent"
                                type="checkbox"
                                checked={agreed}
                                onChange={(e) => setAgreed(e.target.checked)}
                                data-testid="checkout-consent"
                                className="mt-0.5 accent-[#002B5C] w-4 h-4 flex-shrink-0"
                            />
                            <span>
                                I agree to the{" "}
                                <Link to="/terms" target="_blank" className="text-[#002B5C] underline">
                                    Terms &amp; Conditions
                                </Link>
                                ,{" "}
                                <Link to="/privacy" target="_blank" className="text-[#002B5C] underline">
                                    Privacy Policy
                                </Link>{" "}
                                and{" "}
                                <Link to="/refund-policy" target="_blank" className="text-[#002B5C] underline">
                                    Refund Policy
                                </Link>
                                .
                            </span>
                        </label>
                        <button
                            type="submit"
                            disabled={submitting || !agreed}
                            data-testid="place-order-button"
                            className="mt-4 w-full bg-[#002B5C] text-[#FFFFFF] py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {submitting ? "Processing…" : "Pay & Place Order"}
                        </button>
                    </div>
                </aside>
            </form>
        </div>
    );
}
