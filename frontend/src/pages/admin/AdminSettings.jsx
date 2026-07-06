import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { fetchSettings, adminSetSetting } from "../../lib/api";

export default function AdminSettings() {
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
            await adminSetSetting("tax_percent", Number(s.tax_percent) || 0);
            await adminSetSetting("free_ship_threshold", Number(s.free_ship_threshold) || 0);
            await adminSetSetting("ship_flat", Number(s.ship_flat) || 0);
            toast.success("Settings saved — live on the storefront.");
        } catch {
            toast.error("Could not save settings.");
        } finally {
            setSaving(false);
        }
    };

    const Field = ({ label, k, type = "text", hint }) => (
        <div>
            <label className="overline !text-[10px] block mb-1">{label}</label>
            <input
                type={type}
                value={s[k] ?? ""}
                onChange={(e) => set(k, e.target.value)}
                data-testid={`setting-${k}`}
                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
            />
            {hint && <div className="text-[11px] text-[#4B5563] mt-1">{hint}</div>}
        </div>
    );

    return (
        <div data-testid="admin-settings-page">
            <div className="overline">Store</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Settings</h1>

            <section className="mt-10 max-w-2xl space-y-8">
                <div className="border border-[#E5E7EB] bg-white p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Pricing &amp; shipping</h2>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Field label="Tax %" k="tax_percent" type="number" />
                        <Field label="Free-ship over (₹)" k="free_ship_threshold" type="number" />
                        <Field label="Flat shipping (₹)" k="ship_flat" type="number" />
                    </div>
                    <p className="text-[11px] text-[#4B5563] mt-3">
                        Tax and shipping are recomputed on the server at checkout using these values.
                    </p>
                </div>

                <div className="border border-dashed border-[#E5E7EB] bg-[#F5F7FA] p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Page editors</h2>
                    <p className="text-sm text-[#4B5563] mt-1">
                        Storefront page content now has its own editors:
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                        <Link
                            to="/admin/page-bookstore"
                            className="inline-flex items-center text-sm border border-[#002B5C] text-[#002B5C] px-4 py-2 hover:bg-white"
                        >
                            Bookstore (PLP) — sort &amp; filters →
                        </Link>
                        <Link
                            to="/admin/page-book"
                            className="inline-flex items-center text-sm border border-[#002B5C] text-[#002B5C] px-4 py-2 hover:bg-white"
                        >
                            Book page (PDP) — delivery, binding &amp; size →
                        </Link>
                    </div>
                </div>

                <button
                    onClick={save}
                    disabled={saving}
                    data-testid="settings-save"
                    className="bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60"
                >
                    {saving ? "Saving…" : "Save settings"}
                </button>
            </section>
        </div>
    );
}
