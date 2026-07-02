import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { formatApiError } from "../../lib/api";
import { toast } from "sonner";

export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const nav = useNavigate();
    const loc = useLocation();
    const from = loc.state?.from?.pathname || "/account";

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const user = await login(email, password);
            toast.success(`Welcome back, ${user.name.split(" ")[0]}.`);
            nav(user.role === "admin" ? "/admin" : from, { replace: true });
        } catch (err) {
            setError(formatApiError(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            data-testid="login-page"
            className="min-h-[calc(100vh-4rem)] grid grid-cols-1 md:grid-cols-2"
        >
            <div className="hidden md:block relative bg-[#002B5C] overflow-hidden">
                <img
                    src="https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=80"
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-50"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-[#002B5C]/90 via-[#002B5C]/50 to-transparent" />
                <div className="absolute bottom-12 left-12 right-12 text-[#FFFFFF]">
                    <div className="overline !text-white/50">Member Library</div>
                    <p className="font-serif text-4xl mt-4 leading-tight">
                        "The reader of a thousand books is already a citizen of
                        a thousand cities."
                    </p>
                    <p className="font-mono text-xs text-white/60 mt-4">
                        — From our editorial archive
                    </p>
                </div>
            </div>
            <div className="flex items-center justify-center px-6 md:px-16 py-16">
                <div className="w-full max-w-sm">
                    <div className="overline">Sign In</div>
                    <h1 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight">
                        Welcome back.
                    </h1>
                    <p className="text-sm text-[#4B5563] mt-4">
                        Access your orders, desk copy requests and reviews.
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
                                data-testid="login-email"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Password
                            </label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                data-testid="login-password"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>

                        {error && (
                            <div
                                data-testid="login-error"
                                className="text-sm text-[#CC0033] border-l-2 border-[#CC0033] pl-3"
                            >
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            data-testid="login-submit"
                            className="w-full bg-[#002B5C] text-[#FFFFFF] py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-60"
                        >
                            {loading ? "Signing in…" : "Sign In"}
                        </button>
                    </form>

                    <p className="text-sm text-[#4B5563] mt-6">
                        New to Oakbridge?{" "}
                        <Link
                            to="/register"
                            data-testid="login-to-register-link"
                            className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] pb-0.5"
                        >
                            Create an account
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
