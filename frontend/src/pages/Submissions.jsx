import React, { useEffect, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Link } from "react-router-dom";
import { CheckCircle2, FileText } from "lucide-react";
import { submitManuscript, fetchSiteContent, fetchSettings, formatApiError } from "../lib/api";
import { hiddenSet } from "../lib/sections";
import { toast } from "sonner";

const asLines = (v, fallback) => {
    const s = (v || "").trim();
    return (s ? s.split("\n") : fallback).map((x) => x.trim()).filter(Boolean);
};

const CATEGORIES = [
    { v: "academic", l: "Academic" },
    { v: "law", l: "Law" },
    { v: "tax", l: "Tax" },
    { v: "business", l: "Business" },
    { v: "general-reference", l: "General & Reference" },
    { v: "professional", l: "Professional" },
    { v: "test-prep", l: "Test Preparation" },
    { v: "children", l: "Children's Books" },
    { v: "other", l: "Other / Unsure" },
];

export default function Submissions() {
    const [form, setForm] = useState({
        name: "",
        email: "",
        phone: "",
        affiliation: "",
        working_title: "",
        category: "academic",
        word_count: "",
        synopsis: "",
        bio: "",
    });
    const [done, setDone] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState({});

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
    }, []);

    const hidden = hiddenSet(settings);

    const onChange = (e) =>
        setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

    const onSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await submitManuscript({
                ...form,
                word_count: Number(form.word_count || 0),
            });
            setDone(true);
            toast.success("Submission received.");
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div data-testid="submissions-page">
            <Breadcrumbs items={[{ label: "Author Submissions" }]} />
            <Seo
                title="Author Submissions"
                description="Submit your manuscript to Oakbridge Publishing. We welcome scholarly and professional proposals across law, tax, business, academic and reference subjects."
                path="/submissions"
            />
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-16 border-b border-[#E5E7EB]">
                <div className="overline">{site.sub_overline || "Author Submissions"}</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-3xl whitespace-pre-line">
                    {site.sub_title || "We read every\nmanuscript."}
                </h1>
                <p className="mt-8 max-w-xl text-[#4B5563] leading-relaxed whitespace-pre-line">
                    {site.sub_body ||
                        "Oakbridge is actively commissioning across Academic, Law, Tax, Business and Reference lists. Share your book idea below and our editorial team will respond within four weeks."}
                </p>
            </section>

            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12">
                {!hidden.has("submissions.guidelines") && (
                <aside className="lg:col-span-4">
                    <div className="sticky top-24 border border-[#E5E7EB] bg-white p-6 space-y-5">
                        <div>
                            <FileText size={20} strokeWidth={1.5} className="text-[#CC0033]" />
                            <h3 className="font-serif text-xl mt-3 text-[#002B5C]">
                                {site.sub_lookfor_title || "What we look for"}
                            </h3>
                            <ul className="mt-3 text-sm text-[#4B5563] space-y-2 list-disc pl-5">
                                {asLines(site.sub_lookfor_items, [
                                    "Original, well-structured scholarship",
                                    "Clear pedagogical intent and audience",
                                    "A sample chapter or complete manuscript",
                                    "Author credentials & teaching experience",
                                ]).map((item, i) => (
                                    <li key={i}>{item}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="pt-5 border-t border-[#E5E7EB]">
                            <div className="overline">Direct email</div>
                            <a
                                href="mailto:info@oakbridge.in"
                                className="mt-2 inline-block text-sm text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]"
                            >
                                info@oakbridge.in
                            </a>
                        </div>
                    </div>
                </aside>
                )}

                <div className="lg:col-span-8">
                    {done ? (
                        <div
                            data-testid="submissions-success"
                            className="border border-[#002B5C] bg-white p-12 text-center"
                        >
                            <CheckCircle2
                                size={48}
                                strokeWidth={1}
                                className="mx-auto text-[#F59E0B]"
                            />
                            <div className="overline mt-6">Submission Received</div>
                            <h2 className="font-serif text-4xl mt-4 text-[#002B5C]">
                                Thank you.
                            </h2>
                            <p className="mt-5 text-[#4B5563] max-w-md mx-auto">
                                Our commissioning editors will review your
                                submission and respond within four weeks. You'll
                                hear from us at <strong>{form.email}</strong>.
                            </p>
                            <Link
                                to="/"
                                className="mt-8 inline-flex border border-[#002B5C] px-6 py-3 text-sm font-medium hover:bg-[#F5F7FA]"
                            >
                                Back to homepage
                            </Link>
                        </div>
                    ) : (
                        <form
                            onSubmit={onSubmit}
                            data-testid="submissions-form"
                            className="space-y-5"
                        >
                            <div className="grid grid-cols-2 gap-5">
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="overline !text-[10px] block mb-2">Your Name</label>
                                    <input
                                        type="text"
                                        name="name"
                                        required
                                        value={form.name}
                                        onChange={onChange}
                                        data-testid="sub-name"
                                        className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                </div>
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="overline !text-[10px] block mb-2">Email</label>
                                    <input
                                        type="email"
                                        name="email"
                                        required
                                        value={form.email}
                                        onChange={onChange}
                                        data-testid="sub-email"
                                        className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                </div>
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="overline !text-[10px] block mb-2">Phone (optional)</label>
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={form.phone}
                                        onChange={onChange}
                                        data-testid="sub-phone"
                                        className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                </div>
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="overline !text-[10px] block mb-2">Affiliation</label>
                                    <input
                                        type="text"
                                        name="affiliation"
                                        value={form.affiliation}
                                        onChange={onChange}
                                        data-testid="sub-affiliation"
                                        placeholder="University, firm or independent"
                                        className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="overline !text-[10px] block mb-2">Working Title</label>
                                <input
                                    type="text"
                                    name="working_title"
                                    required
                                    value={form.working_title}
                                    onChange={onChange}
                                    data-testid="sub-title"
                                    className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-5">
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="overline !text-[10px] block mb-2">Category</label>
                                    <select
                                        name="category"
                                        value={form.category}
                                        onChange={onChange}
                                        data-testid="sub-category"
                                        className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                    >
                                        {CATEGORIES.map((c) => (
                                            <option key={c.v} value={c.v}>
                                                {c.l}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-span-2 sm:col-span-1">
                                    <label className="overline !text-[10px] block mb-2">Approx. word count</label>
                                    <input
                                        type="number"
                                        name="word_count"
                                        min={0}
                                        value={form.word_count}
                                        onChange={onChange}
                                        data-testid="sub-wordcount"
                                        placeholder="e.g. 80000"
                                        className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="overline !text-[10px] block mb-2">
                                    Synopsis (min 10 characters, max 4000)
                                </label>
                                <textarea
                                    name="synopsis"
                                    required
                                    minLength={10}
                                    maxLength={4000}
                                    rows={7}
                                    value={form.synopsis}
                                    onChange={onChange}
                                    data-testid="sub-synopsis"
                                    placeholder="Describe your book — audience, structure, what makes it distinctive…"
                                    className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C] resize-none"
                                />
                            </div>

                            <div>
                                <label className="overline !text-[10px] block mb-2">Author bio (optional)</label>
                                <textarea
                                    name="bio"
                                    rows={4}
                                    value={form.bio}
                                    onChange={onChange}
                                    data-testid="sub-bio"
                                    className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C] resize-none"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submitting}
                                data-testid="sub-submit"
                                className="bg-[#002B5C] text-[#FFFFFF] px-10 py-4 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60"
                            >
                                {submitting ? "Submitting…" : "Submit Manuscript"}
                            </button>
                            <p className="text-xs text-[#4B5563]">
                                By submitting you confirm the work is original
                                and free of prior publication commitments.
                                We'll respond within four weeks.
                            </p>
                        </form>
                    )}
                </div>
            </section>
        </div>
    );
}
