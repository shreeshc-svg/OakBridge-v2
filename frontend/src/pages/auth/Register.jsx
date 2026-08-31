import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { formatApiError } from "../../lib/api";
import CareersNudge from "../../components/CareersNudge";
import { toast } from "sonner";
import { useFormShield, HoneypotField } from "../../lib/formShield";

export default function Register() {
    const { website, setWebsite, shield } = useFormShield();
    const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const { register } = useAuth();
    const nav = useNavigate();
    const loc = useLocation();
    const from = loc.state?.from?.pathname || "/account";

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const user = await register({ ...form, ...shield() });
            toast.success(`Welcome to Oakbridge, ${user.name.split(" ")[0]}.`);
            nav(from, { replace: true });
        } catch (err) {
            setError(formatApiError(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            data-testid="register-page"
            className="min-h-page grid grid-cols-1 md:grid-cols-2"
        >
            <div className="flex items-center justify-center px-6 md:px-16 py-16 md:order-1 order-2">
                <div className="w-full max-w-sm">
                    <div className="overline">Create Account</div>
                    <h1 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight">
                        Join the library.
                    </h1>
                    <p className="text-sm text-[#4B5563] mt-4">
                        One account for orders, reviews and stock
                        requests.
                    </p>

                    <form onSubmit={onSubmit} className="mt-10 space-y-5">
                        <HoneypotField value={website} onChange={setWebsite} />
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Full Name
                            </label>
                            <input
                                type="text"
                                required
                                value={form.name}
                                onChange={(e) =>
                                    setForm({ ...form, name: e.target.value })
                                }
                                data-testid="register-name"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Email
                            </label>
                            <input
                                type="email"
                                required
                                value={form.email}
                                onChange={(e) =>
                                    setForm({ ...form, email: e.target.value })
                                }
                                data-testid="register-email"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Phone
                            </label>
                            <input
                                type="tel"
                                required
                                minLength={6}
                                value={form.phone}
                                onChange={(e) =>
                                    setForm({ ...form, phone: e.target.value })
                                }
                                data-testid="register-phone"
                                placeholder="+91 98765 43210"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Password (min 6 chars)
                            </label>
                            <input
                                type="password"
                                required
                                minLength={6}
                                value={form.password}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        password: e.target.value,
                                    })
                                }
                                data-testid="register-password"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>

                        {error && (
                            <div
                                data-testid="register-error"
                                className="text-sm text-[#CC0033] border-l-2 border-[#CC0033] pl-3"
                            >
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            data-testid="register-submit"
                            className="w-full bg-[#002B5C] text-[#FFFFFF] py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-60"
                        >
                            {loading ? "Creating account…" : "Create Account"}
                        </button>
                    </form>

                    <p className="text-sm text-[#4B5563] mt-6">
                        Already a member?{" "}
                        <Link
                            to="/login"
                            state={{ from: loc.state?.from }}
                            data-testid="register-to-login-link"
                            className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] pb-0.5"
                        >
                            Sign in
                        </Link>
                    </p>

                    <CareersNudge />
                </div>
            </div>
            <div className="hidden md:block relative bg-[#002B5C] overflow-hidden md:order-2 order-1">
                <img
                    src="https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=1400&q=80"
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-50"
                />
                <div className="absolute inset-0 bg-gradient-to-bl from-[#002B5C]/90 via-[#002B5C]/50 to-transparent" />
                <div className="absolute bottom-12 left-12 right-12 text-[#FFFFFF]">
                    <div className="overline !text-white/50">
                        Member Benefits
                    </div>
                    <ul className="font-serif text-2xl mt-6 space-y-3 leading-snug">
                        <li>— Order history and reorder with one click</li>
                        <li>— Write reviews, shape the catalogue</li>
                        <li>— Early access to new releases</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
