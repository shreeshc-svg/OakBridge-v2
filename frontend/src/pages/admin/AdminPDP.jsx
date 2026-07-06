import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchSettings, adminSetSetting } from "../../lib/api";

const toArr = (v) =>
    Array.isArray(v) ? v : String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
const toStr = (v) => (Array.isArray(v) ? v.join(", ") : v || "");

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

    const save = async () => {
        setSaving(true);
        try {
            await adminSetSetting("pdp_delivery", String(s.pdp_delivery || ""));
            await adminSetSetting("pdp_returns", String(s.pdp_returns || ""));
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
                The delivery / returns notes and the binding &amp; size choices shown on every book
                detail page. Changes go live immediately on save.
            </p>

            <section className="mt-10 max-w-2xl space-y-8">
                {/* ---- INFO TILES ---- */}
                <div className="border border-[#E5E7EB] bg-white p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Delivery &amp; returns</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Shown in the info tiles under the price. The “Free shipping over ₹X” tile
                        uses the threshold from Settings.
                    </p>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="overline !text-[10px] block mb-1">Delivery time</label>
                            <input
                                value={s.pdp_delivery ?? ""}
                                onChange={(e) => set("pdp_delivery", e.target.value)}
                                data-testid="setting-pdp_delivery"
                                placeholder="e.g. 3–7 business days"
                                className={box}
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-1">Returns</label>
                            <input
                                value={s.pdp_returns ?? ""}
                                onChange={(e) => set("pdp_returns", e.target.value)}
                                data-testid="setting-pdp_returns"
                                placeholder="e.g. 14-day returns"
                                className={box}
                            />
                        </div>
                    </div>
                </div>

                {/* ---- VARIANT OPTIONS ---- */}
                <div className="border border-[#E5E7EB] bg-white p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Binding &amp; size options</h2>
                    <p className="text-sm text-[#4B5563] mt-1">
                        The choices offered on the book page and in the Books price-matrix editor
                        (comma-separated). Per-book prices are set in Admin → Books → Price matrix.
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
