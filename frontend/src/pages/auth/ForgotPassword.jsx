import React, { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword, formatApiError } from "../../lib/api";

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            await forgotPassword(email);
            setSent(true);
        } catch (err) {
            setError(formatApiError(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            data-testid="forgot-password-page"
            className="min-h-page flex items-center justify-center px-6 py-16"
        >
            <div className="w-full max-w-sm">
                <div className="overline">Reset Password</div>
                <h1 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight">
                    Forgot your password?
                </h1>

                {sent ? (
                    <div data-testid="forgot-sent" className="mt-8">
                        <p className="text-sm text-[#4B5563] leading-relaxed">
                            If that email is registered with us, a reset link is on its
                            way. It expires in 30 minutes — check your inbox (and spam).
                        </p>
                        <Link
                            to="/login"
                            className="inline-block mt-8 text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] pb-0.5 text-sm"
                        >
                            Back to sign in
                        </Link>
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-[#4B5563] mt-4">
                            Enter your account email and we'll send you a link to set a
                            new password.
                        </p>
                        <form onSubmit={onSubmit} className="mt-10 space-y-5">
                            <div>
                                <label className="overline !text-[10px] block mb-2">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    data-testid="forgot-email"
                                    className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                />
                            </div>

                            {error && (
                                <div
                                    data-testid="forgot-error"
                                    className="text-sm text-[#CC0033] border-l-2 border-[#CC0033] pl-3"
                                >
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                data-testid="forgot-submit"
                                className="w-full bg-[#002B5C] text-[#FFFFFF] py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-60"
                            >
                                {loading ? "Sending…" : "Send reset link"}
                            </button>
                        </form>
                        <p className="text-sm text-[#4B5563] mt-6">
                            Remembered it?{" "}
                            <Link
                                to="/login"
                                className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] pb-0.5"
                            >
                                Sign in
                            </Link>
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
