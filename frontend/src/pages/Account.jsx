import React, { useEffect, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import { Link, useNavigate } from "react-router-dom";
import { Package, LogOut, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { fetchMyOrders, formatINR, verifyOtp, resendOtp, formatApiError } from "../lib/api";
import { toast } from "sonner";

/**
 * Fulfilment states are written for the warehouse, and one of them should never
 * reach the customer in those words.
 *
 * "Bounced" is our word for a checkout somebody left — accurate internally,
 * and something between jargon and an accusation on the customer's own account
 * page. What they need to read is what is true for them: nothing was paid, and
 * the order is still there if they want it.
 */
const CUSTOMER_STATUS = { bounced: "Awaiting payment" };
const customerStatus = (s) => CUSTOMER_STATUS[String(s || "").toLowerCase()] || s;

export default function Account() {
    const { user, logout, refresh } = useAuth();
    const nav = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [otpCode, setOtpCode] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [resending, setResending] = useState(false);

    const onVerify = async () => {
        setVerifying(true);
        try {
            await verifyOtp(otpCode);
            toast.success("Account verified — thank you!");
            setOtpCode("");
            refresh();
        } catch (err) {
            toast.error(formatApiError(err) || "Verification failed.");
        } finally {
            setVerifying(false);
        }
    };
    const onResend = async () => {
        setResending(true);
        try {
            const res = await resendOtp();
            toast.success(res?.message || "A new code is on its way.");
        } catch (err) {
            toast.error("Could not resend the code. Try again.");
        } finally {
            setResending(false);
        }
    };

    useEffect(() => {
        fetchMyOrders()
            .then(setOrders)
            .catch(() => setOrders([]))
            .finally(() => setLoading(false));
    }, []);

    const onLogout = () => {
        logout();
        nav("/");
    };

    if (!user) return null;

    return (
        <div data-testid="account-page" className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16">
            <Breadcrumbs inset items={[{ label: "My Account" }]} />
            {user && user.email_verified === false && (
                <div
                    data-testid="verify-email-banner"
                    className="mb-8 border border-[#F59E0B] bg-[#F59E0B]/10 p-6"
                >
                    <div className="font-serif text-xl text-[#002B5C]">
                        Verify your account
                    </div>
                    <p className="text-sm text-[#4B5563] mt-1">
                        We sent a 6-digit verification code. Enter it below to
                        verify your account.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <input
                            value={otpCode}
                            onChange={(e) =>
                                setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                            }
                            inputMode="numeric"
                            placeholder="123456"
                            data-testid="otp-input"
                            className="w-32 border border-[#E5E7EB] bg-white px-3 py-2 text-sm tracking-[0.3em] text-center outline-none focus:border-[#002B5C]"
                        />
                        <button
                            type="button"
                            onClick={onVerify}
                            disabled={verifying || otpCode.length !== 6}
                            data-testid="otp-verify"
                            className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                        >
                            {verifying ? "Verifying…" : "Verify"}
                        </button>
                        <button
                            type="button"
                            onClick={onResend}
                            disabled={resending}
                            data-testid="otp-resend"
                            className="text-sm text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] disabled:opacity-50 pb-0.5"
                        >
                            {resending ? "Sending…" : "Resend code"}
                        </button>
                    </div>
                </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                <aside className="lg:col-span-3">
                    <div className="sticky top-24 border border-[#E5E7EB] bg-white p-6">
                        <div className="overline">Account</div>
                        <div className="mt-3 flex items-center gap-3">
                            <div className="w-12 h-12 bg-[#002B5C] text-[#FFFFFF] flex items-center justify-center">
                                <User size={20} strokeWidth={1.5} />
                            </div>
                            <div>
                                <div className="font-serif text-lg text-[#002B5C] leading-tight">
                                    {user.name}
                                </div>
                                <div className="text-xs text-[#4B5563]">
                                    {user.email}
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 space-y-3 text-sm">
                            {user.role === "admin" && (
                                <Link
                                    to="/admin"
                                    data-testid="account-admin-link"
                                    className="block border-b border-[#E5E7EB] pb-2 text-[#002B5C] hover:text-[#CC0033]"
                                >
                                    → Admin Dashboard
                                </Link>
                            )}
                            <Link
                                to="/books"
                                className="block border-b border-[#E5E7EB] pb-2 text-[#002B5C] hover:text-[#CC0033]"
                            >
                                Browse the Bookstore
                            </Link>
                            <button
                                onClick={onLogout}
                                data-testid="account-logout"
                                className="inline-flex items-center gap-2 text-[#CC0033] hover:underline text-sm"
                            >
                                <LogOut size={14} strokeWidth={1.5} /> Sign out
                            </button>
                        </div>
                    </div>
                </aside>

                <section className="lg:col-span-9">
                    <div className="overline">My Orders</div>
                    <h1 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight">
                        Your Reading Orders
                    </h1>

                    {loading && (
                        <p className="mt-8 font-mono text-xs text-[#4B5563]">
                            Loading…
                        </p>
                    )}

                    {!loading && orders.length === 0 && (
                        <div className="mt-12 border border-dashed border-[#E5E7EB] py-16 text-center">
                            <Package
                                size={32}
                                strokeWidth={1}
                                className="mx-auto text-[#4B5563]"
                            />
                            <h3 className="font-serif text-2xl mt-4 text-[#002B5C]">
                                No orders yet.
                            </h3>
                            <p className="text-sm text-[#4B5563] mt-2">
                                Orders you place will appear here.
                            </p>
                            <Link
                                to="/books"
                                className="mt-6 inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-6 py-3 text-sm"
                            >
                                Shop books
                            </Link>
                        </div>
                    )}

                    {!loading && orders.length > 0 && (
                        <div className="mt-8 space-y-4">
                            {orders.map((o) => (
                                <Link
                                    to={`/order-confirmation/${o.id}`}
                                    key={o.id}
                                    data-testid={`account-order-${o.id}`}
                                    className="block border border-[#E5E7EB] bg-white p-5 hover:border-[#002B5C] transition-colors"
                                >
                                    <div className="flex flex-wrap items-baseline justify-between gap-4">
                                        <div>
                                            <div className="font-mono text-xs text-[#4B5563]">
                                                {o.order_number}
                                            </div>
                                            <div className="font-serif text-xl text-[#002B5C] mt-1">
                                                {o.items.length} book
                                                {o.items.length === 1 ? "" : "s"}
                                                {" · "}
                                                {new Date(
                                                    o.created_at,
                                                ).toLocaleDateString("en-IN", {
                                                    day: "numeric",
                                                    month: "short",
                                                    year: "numeric",
                                                })}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs font-mono uppercase tracking-widest bg-[#F5F7FA] px-3 py-1 text-[#002B5C]">
                                                {customerStatus(o.status)}
                                            </span>
                                            <span className="font-serif text-2xl text-[#002B5C]">
                                                {formatINR(o.total)}
                                            </span>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
