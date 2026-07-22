import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { fetchSettings, adminSetSetting } from "../../lib/api";

const toArr = (v) =>
    Array.isArray(v) ? v : String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
const toStr = (v) => (Array.isArray(v) ? v.join(", ") : v || "");

const DEFAULT_PDP_BADGES = [
    { label: "Free Shipping", value: "On all orders", enabled: true },
    { label: "Delivery", value: "3–7 business days", enabled: true },
];

export default function AdminPDP() {
    const [s, setS] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings().then(setS).catch(() => {});
    }, []);

    if (!s) {
        return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;
    }

    const set = (k, v) => setS((cur) => ({ ...cur, [k]: v }));

    // Trust badges — fall back to the defaults until something is saved.
    const badges = Array.isArray(s.pdp_badges) ? s.pdp_badges : DEFAULT_PDP_BADGES;
    const setBadges = (arr) => set("pdp_badges", arr);
    const updateBadge = (i, k, v) => setBadges(badges.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)));
    const addBadge = () => setBadges([...badges, { label: "", value: "", enabled: true }]);
    const removeBadge = (i) => setBadges(badges.filter((_, idx) => idx !== i));
    const moveBadge = (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= badges.length) return;
        const next = [...badges];
        [next[i], next[j]] = [next[j], next[i]];
        setBadges(next);
    };

    const save = async () => {
        setSaving(true);
        try {
            const cleanBadges = badges
                .map((b) => ({
                    label: (b.label || "").trim(),
                    value: (b.value || "").trim(),
                    enabled: b.enabled !== false,
                }))
                .filter((b) => b.label || b.value);
            await adminSetSetting("pdp_badges", cleanBadges);
            await adminSetSetting("binding_options", toArr(s.binding_options));
            await adminSetSetting("size_options", toArr(s.size_options));
            toast.success("Book page saved — live on the storefront.");
        } catch {
            toast.error("Could not save. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const box = "w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]";

    return (
        <div data-testid="admin-pdp-page">
            <div className="overline">Page editor</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Book page (PDP)</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                The delivery / returns notes shown on every book page, plus the palette of
                binding &amp; size choices used when building a book's price matrix. Changes go
                live immediately on save.
            </p>

            <section className="mt-10 max-w-2xl space-y-8">
                {/* ---- TRUST BADGES ---- */}
                <div className="border border-[#E5E7EB] bg-white p-6" data-testid="pdp-badges-editor">
                    <h2 className="font-serif text-xl text-[#002B5C]">Trust badges</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        The small tiles shown under the price on every book page — shipping,
                        delivery, returns, invoice and anything else. Reorder, rename, hide or add
                        your own. Hidden badges stay saved but don’t show on the site. Up to four
                        sit in a row; more will wrap.
                    </p>

                    <div className="mt-4 space-y-2">
                        {badges.map((b, i) => (
                            <div
                                key={i}
                                data-testid={`pdp-badge-row-${i}`}
                                className={`flex items-center gap-2 border border-[#E5E7EB] p-2 ${b.enabled === false ? "opacity-50 bg-[#F5F7FA]" : "bg-white"}`}
                            >
                                <div className="flex flex-col">
                                    <button type="button" onClick={() => moveBadge(i, -1)} disabled={i === 0} aria-label="Move up" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25">
                                        <ArrowUp size={13} strokeWidth={1.5} />
                                    </button>
                                    <button type="button" onClick={() => moveBadge(i, 1)} disabled={i === badges.length - 1} aria-label="Move down" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25">
                                        <ArrowDown size={13} strokeWidth={1.5} />
                                    </button>
                                </div>
                                <input
                                    value={b.label ?? ""}
                                    onChange={(e) => updateBadge(i, "label", e.target.value)}
                                    placeholder="Label (e.g. Delivery)"
                                    aria-label="Badge label"
                                    className="w-1/3 border border-[#E5E7EB] px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]"
                                />
                                <input
                                    value={b.value ?? ""}
                                    onChange={(e) => updateBadge(i, "value", e.target.value)}
                                    placeholder="Value (e.g. 3–7 business days)"
                                    aria-label="Badge value"
                                    className="flex-1 border border-[#E5E7EB] px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]"
                                />
                                <button
                                    type="button"
                                    onClick={() => updateBadge(i, "enabled", b.enabled === false)}
                                    aria-label={b.enabled === false ? "Show badge" : "Hide badge"}
                                    title={b.enabled === false ? "Hidden — click to show" : "Visible — click to hide"}
                                    className="p-1.5 text-[#4B5563] hover:text-[#002B5C]"
                                >
                                    {b.enabled === false ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => removeBadge(i)}
                                    aria-label="Remove badge"
                                    className="p-1.5 text-[#4B5563] hover:text-[#CC0033]"
                                >
                                    <Trash2 size={15} strokeWidth={1.5} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={addBadge}
                        data-testid="pdp-badge-add"
                        className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]"
                    >
                        <Plus size={14} strokeWidth={1.5} /> Add badge
                    </button>
                </div>

                {/* ---- VARIANT OPTIONS ---- */}
                <div className="border border-[#E5E7EB] bg-white p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Binding &amp; size variant palette</h2>
                    <p className="text-sm text-[#4B5563] mt-1">
                        The choices available when building a book's price matrix
                        (comma-separated). A book shows binding/size <strong>selectors</strong> on its
                        PDP only when it has price-matrix variants — by default none are shown. For a
                        fixed binding/size shown as a read-only <strong>spec</strong>, set the
                        Binding / Size fields on the individual book in Admin → Books.
                    </p>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="overline !text-[10px] block mb-1">Binding options</label>
                            <input
                                value={toStr(s.binding_options)}
                                onChange={(e) => set("binding_options", e.target.value)}
                                data-testid="setting-binding-options"
                                placeholder="Hardcover, Softcover"
                                className={box}
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-1">Size options</label>
                            <input
                                value={toStr(s.size_options)}
                                onChange={(e) => set("size_options", e.target.value)}
                                data-testid="setting-size-options"
                                placeholder="Demi, Royal, Crown"
                                className={box}
                            />
                        </div>
                    </div>
                </div>

                <button
                    onClick={save}
                    disabled={saving}
                    data-testid="pdp-save"
                    className="bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60"
                >
                    {saving ? "Saving…" : "Save book page"}
                </button>
            </section>
        </div>
    );
}
