import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { createReview, fetchReviews, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

function StarRow({ value, onChange, readOnly = false }) {
    return (
        <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((i) => {
                const filled = i <= value;
                return (
                    <button
                        key={i}
                        type="button"
                        disabled={readOnly}
                        onClick={() => onChange && onChange(i)}
                        data-testid={`review-star-${i}`}
                        className={readOnly ? "cursor-default" : "cursor-pointer"}
                        aria-label={`${i} star${i > 1 ? "s" : ""}`}
                    >
                        <Star
                            size={16}
                            strokeWidth={1.5}
                            fill={filled ? "#F59E0B" : "none"}
                            className="text-[#F59E0B]"
                        />
                    </button>
                );
            })}
        </div>
    );
}

export default function ReviewsSection({ bookId }) {
    const { isAuthenticated, user } = useAuth();
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ rating: 5, title: "", comment: "" });
    const [submitting, setSubmitting] = useState(false);

    const load = () => {
        setLoading(true);
        fetchReviews(bookId)
            .then(setReviews)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId]);

    const alreadyReviewed =
        isAuthenticated && reviews.some((r) => r.user_id === user?.id);

    const onSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await createReview(bookId, form);
            toast.success("Thanks for your review.");
            setForm({ rating: 5, title: "", comment: "" });
            setOpen(false);
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const avg = reviews.length
        ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
        : null;

    return (
        <div data-testid="reviews-section" className="border-t border-[#E5E7EB] pt-14 mt-14">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Reader Reviews</div>
                    <h2 className="font-serif text-3xl mt-2 text-[#002B5C]">
                        {reviews.length === 0
                            ? "Be the first to review"
                            : `${reviews.length} review${reviews.length === 1 ? "" : "s"}`}
                        {avg && (
                            <span className="ml-3 font-mono text-base text-[#CC0033]">
                                {avg} / 5
                            </span>
                        )}
                    </h2>
                </div>
                {isAuthenticated && !alreadyReviewed && (
                    <button
                        onClick={() => setOpen(!open)}
                        data-testid="write-review-button"
                        className="border border-[#002B5C] px-5 py-2 text-sm font-medium hover:bg-[#F5F7FA]"
                    >
                        {open ? "Cancel" : "Write a review"}
                    </button>
                )}
                {!isAuthenticated && (
                    <Link
                        to="/login"
                        data-testid="review-login-link"
                        className="text-sm border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]"
                    >
                        Sign in to write a review
                    </Link>
                )}
            </div>

            {open && (
                <form
                    onSubmit={onSubmit}
                    data-testid="review-form"
                    className="mt-6 border border-[#002B5C] bg-white p-6 space-y-4"
                >
                    <div>
                        <label className="overline !text-[10px] block mb-2">Rating</label>
                        <StarRow
                            value={form.rating}
                            onChange={(v) => setForm({ ...form, rating: v })}
                        />
                    </div>
                    <div>
                        <label className="overline !text-[10px] block mb-2">Title</label>
                        <input
                            required
                            maxLength={120}
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            data-testid="review-title"
                            className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                        />
                    </div>
                    <div>
                        <label className="overline !text-[10px] block mb-2">
                            Your review
                        </label>
                        <textarea
                            required
                            rows={4}
                            value={form.comment}
                            onChange={(e) => setForm({ ...form, comment: e.target.value })}
                            data-testid="review-comment"
                            className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C] resize-none"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={submitting}
                        data-testid="review-submit"
                        className="bg-[#002B5C] text-[#FFFFFF] px-6 py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60"
                    >
                        {submitting ? "Submitting…" : "Publish Review"}
                    </button>
                </form>
            )}

            <div className="mt-8 space-y-6">
                {loading && (
                    <p className="font-mono text-xs text-[#4B5563]">Loading reviews…</p>
                )}
                {!loading && reviews.length === 0 && (
                    <p className="text-sm text-[#4B5563]">
                        No reviews yet. Reviews from verified readers will appear here.
                    </p>
                )}
                {reviews.map((r) => (
                    <article
                        key={r.id}
                        data-testid={`review-${r.id}`}
                        className="border-b border-[#E5E7EB] pb-6"
                    >
                        <div className="flex items-center justify-between">
                            <StarRow value={r.rating} readOnly />
                            <span className="font-mono text-xs text-[#4B5563]">
                                {new Date(r.created_at).toLocaleDateString("en-IN")}
                            </span>
                        </div>
                        <h3 className="font-serif text-xl text-[#002B5C] mt-3">
                            {r.title}
                        </h3>
                        <p className="text-sm text-[#4B5563] mt-2 leading-relaxed">
                            {r.comment}
                        </p>
                        <p className="mt-3 text-xs font-mono text-[#4B5563]">
                            — {r.user_name}
                        </p>
                    </article>
                ))}
            </div>
        </div>
    );
}
