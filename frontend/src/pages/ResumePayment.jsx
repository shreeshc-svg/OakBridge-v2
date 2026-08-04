import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import NoIndex from "../components/NoIndex";
import { api, createPaymentOrder, verifyPayment, formatINR, formatApiError } from "../lib/api";
import { loadRazorpay } from "../lib/razorpay";

/**
 * The page an emailed payment link opens.
 *
 * WHY IT EXISTS
 *
 * An order row is written before the customer reaches Razorpay, so an order
 * that was never paid for sits "pending" and nothing ever resolves it. The
 * Retry button on the failure page links to /checkout, which reads the cart in
 * THAT browser — open the mail on a phone, or clear the cart, and it lands on
 * an empty page while the original order stays pending for ever. Paying again
 * from the shop creates a second row for the same books.
 *
 * This reopens the order that already exists, on any device, with no login,
 * and settles that same row.
 *
 * WHY THERE IS NO ADDRESS ON THIS PAGE
 *
 * The link travels by email. It can be forwarded, land in a shared inbox, or
 * sit in a browser history on a borrowed laptop. Enough to recognise the order
 * and pay it is enough; the delivery address, phone and email stay out of it.
 * The token is required precisely because even this much is the customer's
 * business and nobody else's.
 */
export default function ResumePayment() {
    const { id } = useParams();
    const [params] = useSearchParams();
    const token = params.get("t") || "";

    const [state, setState] = useState({ loading: true });
    const [paying, setPaying] = useState(false);

    useEffect(() => {
        let alive = true;
        api.get(`/payments/resume/${id}`, { params: { t: token } })
            .then((r) => alive && setState({ loading: false, order: r.data }))
            .catch((e) =>
                alive &&
                setState({
                    loading: false,
                    error:
                        e?.response?.status === 404
                            ? "This payment link has expired or is no longer valid."
                            : formatApiError(e),
                }),
            );
        return () => {
            alive = false;
        };
    }, [id, token]);

    const pay = async () => {
        setPaying(true);
        try {
            const rzp = await createPaymentOrder(id);
            const options = {
                key: rzp.key_id,
                amount: rzp.amount,
                currency: rzp.currency || "INR",
                order_id: rzp.rzp_order_id,
                name: "Oakbridge Publishing",
                description: `Order ${rzp.order_number || state.order?.order_number || ""}`,
                image: "/favicon.ico",
                notes: { oakbridge_order_id: id },
                handler: async (res) => {
                    try {
                        await verifyPayment({
                            razorpay_order_id: res.razorpay_order_id,
                            razorpay_payment_id: res.razorpay_payment_id,
                            razorpay_signature: res.razorpay_signature,
                        });
                        window.location.href = `/order-confirmation/${id}`;
                    } catch (err) {
                        toast.error(formatApiError(err));
                        setPaying(false);
                    }
                },
                modal: { ondismiss: () => setPaying(false) },
                theme: { color: "#002B5C" },
            };
            // Checkout preloads this on mount; arriving straight from an email
            // means the script is not on the page yet.
            const ready = await loadRazorpay();
            if (!ready || !window.Razorpay) {
                toast.error("Payment library did not load. Please refresh and try again.");
                setPaying(false);
                return;
            }
            new window.Razorpay(options).open();
        } catch (err) {
            toast.error(formatApiError(err));
            setPaying(false);
        }
    };

    if (state.loading) {
        return (
            <div className="px-6 py-32 text-center text-[#4B5563]">
                <NoIndex title="Complete payment" />
                Loading your order…
            </div>
        );
    }

    if (state.error) {
        return (
            <div className="px-6 py-28 max-w-xl mx-auto text-center">
                <NoIndex title="Payment link expired" />
                <div className="overline">Payment link</div>
                <h1 className="font-serif text-3xl mt-3 text-[#002B5C]">
                    This link is no longer valid.
                </h1>
                <p className="mt-4 text-[#4B5563] leading-relaxed">{state.error}</p>
                <p className="mt-2 text-sm text-[#4B5563]">
                    Payment links work for seven days. You can place the order again, or write to us
                    and we will sort it out.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                    <Link to="/books" className="bg-[#002B5C] text-white px-6 py-3 text-sm font-medium">
                        Browse the bookstore
                    </Link>
                    <Link to="/contact" className="border border-[#002B5C] px-6 py-3 text-sm font-medium">
                        Contact us
                    </Link>
                </div>
            </div>
        );
    }

    const o = state.order;

    // Already settled — usually because they paid from the original tab after
    // the reminder went out. Say so plainly rather than offering to charge again.
    if (o.status === "paid") {
        return (
            <div className="px-6 py-28 max-w-xl mx-auto text-center">
                <NoIndex title="Already paid" />
                <ShieldCheck size={28} strokeWidth={1.5} className="mx-auto text-[#0F6E56]" />
                <h1 className="font-serif text-3xl mt-4 text-[#002B5C]">This order is already paid.</h1>
                <p className="mt-4 text-[#4B5563]">
                    Order {o.order_number} is settled — nothing further to do. Your receipt is in
                    your inbox.
                </p>
                <Link
                    to="/books"
                    className="inline-block mt-8 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium"
                >
                    Browse the bookstore
                </Link>
            </div>
        );
    }

    return (
        <div className="px-6 py-20 max-w-xl mx-auto" data-testid="resume-payment-page">
            <NoIndex title="Complete payment" />
            <div className="overline">Order {o.order_number}</div>
            <h1 className="font-serif text-4xl mt-3 text-[#002B5C] leading-tight">
                {o.first_name ? `${o.first_name}, your` : "Your"} order is waiting.
            </h1>
            <p className="mt-4 text-[#4B5563] leading-relaxed">
                The payment was not completed, so we have not processed this order. You can finish
                it here.
            </p>

            <div className="mt-8 border border-[#E5E7EB] bg-white">
                {(o.items || []).map((it, i) => (
                    <div
                        key={i}
                        className="flex justify-between gap-4 px-5 py-4 border-b border-[#E5E7EB] last:border-b-0"
                    >
                        <div>
                            <div className="text-[#002B5C]">
                                <span className="font-mono text-xs text-[#4B5563]">
                                    {it.quantity}×
                                </span>{" "}
                                {it.title}
                            </div>
                            {it.author && (
                                <div className="text-xs text-[#4B5563] mt-0.5">{it.author}</div>
                            )}
                        </div>
                        <div className="font-serif text-lg text-[#002B5C] whitespace-nowrap">
                            {formatINR((it.price || 0) * (it.quantity || 1))}
                        </div>
                    </div>
                ))}
                <div className="flex justify-between px-5 py-4 bg-[#F5F7FA]">
                    <span className="overline !text-[10px]">Total</span>
                    <span className="font-serif text-2xl text-[#002B5C]">{formatINR(o.total)}</span>
                </div>
            </div>

            <button
                onClick={pay}
                disabled={paying}
                data-testid="resume-pay-button"
                className="mt-8 w-full inline-flex items-center justify-center gap-2 bg-[#002B5C] text-white px-7 py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-50"
            >
                <RefreshCw size={16} strokeWidth={1.75} />
                {paying ? "Opening payment…" : `Complete payment — ${formatINR(o.total)}`}
            </button>

            <p className="mt-5 text-xs text-[#4B5563] leading-relaxed">
                Nothing has been charged yet. We have not reserved stock against an unpaid order, so
                if a title sells out before you pay we will be in touch. If you would rather not go
                ahead, you can simply ignore this.
            </p>
        </div>
    );
}
