import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword, formatApiError } from "../../lib/api";
import { toast } from "sonner";

export default function ResetPassword() {
    const [sp] = useSearchParams();
    const token = sp.get("token") || "";
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const nav = useNavigate();

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        if (password !== confirm) {
            setError("Passwords do not match.");
            return;
        }
        setLoading(true);
        try {
            await resetPassword(token, password);
            toast.success("Password updated — please sign in.");
            nav("/login", { replace: true });
        } catch (err) {
            setError(formatApiError(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            data-testid="reset-password-page"
            className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6 py-16"
        >
            <div className="w-full max-w-sm">
                <div className="overline">Reset Password</div>
                <h1 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight">
                    Set a new password.
                </h1>

                {!token ? (
                    <div className="mt-8">
                        <p className="text-sm text-[#CC0033] leading-relaxed">
                            This reset link is missing its token. Please request a new
                            link.
                        </p>
                        <Link
                            to="/forgot-password"
                            className="inline-block mt-8 text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] pb-0.5 text-sm"
                        >
                            Request a new link
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="mt-10 space-y-5">
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                New password (min 6 chars)
                            </label>
                            <input
                                type="password"
                                required
                                minLength={6}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                data-testid="reset-password"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Confirm new password
                            </label>
                            <input
                                type="password"
                                required
                                minLength={6}
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                data-testid="reset-confirm"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>

                        {error && (
                            <div
                                data-testid="reset-error"
                                className="text-sm text-[#CC0033] border-l-2 border-[#CC0033] pl-3"
                            >
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            data-testid="reset-submit"
                            className="w-full bg-[#002B5C] text-[#FFFFFF] py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-60"
                        >
                            {loading ? "Updating…" : "Update password"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
