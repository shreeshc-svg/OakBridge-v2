import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchLegal, adminSaveLegal } from "../../lib/api";

const ORDER = ["terms", "privacy", "refund", "shipping"];

export default function AdminLegal() {
    const [pages, setPages] = useState(null);
    const [active, setActive] = useState("terms");
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchLegal()
            .then((data) => {
                setPages(data);
                setDraft(data?.terms?.content || "");
            })
            .catch(() => {});
    }, []);

    if (!pages) {
        return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;
    }

    const selectTab = (slug) => {
        setActive(slug);
        setDraft(pages[slug]?.content || "");
    };

    const save = async () => {
        setSaving(true);
        try {
            await adminSaveLegal(active, draft);
            setPages((cur) => ({ ...cur, [active]: { ...cur[active], content: draft } }));
            toast.success(`${pages[active]?.title} saved — live on the site.`);
        } catch {
            toast.error("Could not save. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const dirty = draft !== (pages[active]?.content || "");

    return (
        <div data-testid="admin-legal-page">
            <div className="overline">Legal</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Legal &amp; Policies</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Edit your Terms, Privacy, Refund and Shipping pages. Written in Markdown —
                use <code className="bg-[#F5F7FA] px-1">## Heading</code>,
                <code className="bg-[#F5F7FA] px-1">- bullet</code>,
                <code className="bg-[#F5F7FA] px-1">**bold**</code> and
                <code className="bg-[#F5F7FA] px-1">[link](/path)</code>. Changes go live on save.
                Please have the final wording reviewed by counsel.
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
                {ORDER.map((slug) => (
                    <button
                        key={slug}
                        onClick={() => selectTab(slug)}
                        data-testid={`legal-tab-${slug}`}
                        className={`px-4 py-2 text-sm border transition-colors ${
                            active === slug
                                ? "border-[#002B5C] bg-[#002B5C] text-white"
                                : "border-[#E5E7EB] text-[#002B5C] hover:border-[#002B5C]"
                        }`}
                    >
                        {pages[slug]?.title || slug}
                    </button>
                ))}
            </div>

            <div className="mt-6 max-w-4xl">
                <label className="overline !text-[10px] block mb-2">
                    {pages[active]?.title} — Markdown
                </label>
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    data-testid={`legal-editor-${active}`}
                    spellCheck={false}
                    className="w-full h-[520px] border border-[#E5E7EB] bg-white px-4 py-3 text-sm font-mono leading-relaxed outline-none focus:border-[#002B5C]"
                />
                <div className="mt-4 flex items-center gap-4">
                    <button
                        onClick={save}
                        disabled={saving || !dirty}
                        data-testid="legal-save"
                        className="bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                    >
                        {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
                    </button>
                    <a
                        href={`/${active === "refund" ? "refund-policy" : active === "shipping" ? "shipping-policy" : active}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-[#002B5C] underline"
                    >
                        Preview live page →
                    </a>
                </div>
            </div>
        </div>
    );
}
