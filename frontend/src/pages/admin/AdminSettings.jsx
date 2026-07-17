import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { fetchSettings, adminSetSetting, fetchCollection, adminSaveCollection } from "../../lib/api";
import { ArrowUp, ArrowDown, X, Plus, Eye, EyeOff } from "lucide-react";

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

    const lines = Array.isArray(s.contact_direct_lines) ? s.contact_direct_lines : [];
    const setLines = (arr) => set("contact_direct_lines", arr);
    const updateLine = (i, key, val) =>
        setLines(lines.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
    const addLine = () => setLines([...lines, { label: "", email: "" }]);
    const removeLine = (i) => setLines(lines.filter((_, idx) => idx !== i));

    const save = async () => {
        setSaving(true);
        try {
            await adminSetSetting("tax_percent", Number(s.tax_percent) || 0);
            await adminSetSetting("free_ship_threshold", Number(s.free_ship_threshold) || 0);
            await adminSetSetting("ship_flat", Number(s.ship_flat) || 0);
            await adminSetSetting(
                "contact_direct_lines",
                lines
                    .map((l) => ({ label: (l.label || "").trim(), email: (l.email || "").trim() }))
                    .filter((l) => l.label && l.email),
            );
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

                <div className="border border-[#E5E7EB] bg-white p-6" data-testid="direct-lines-editor">
                    <div className="flex items-center justify-between">
                        <h2 className="font-serif text-xl text-[#002B5C]">Contact — Direct Lines</h2>
                        <button
                            type="button"
                            onClick={addLine}
                            data-testid="direct-line-add"
                            className="text-xs border border-[#002B5C] text-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA]"
                        >
                            + Add line
                        </button>
                    </div>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Shown in the “Direct Lines” box on the Contact page.
                    </p>
                    <div className="mt-4 space-y-3">
                        {lines.map((l, i) => (
                            <div key={i} className="flex gap-3 items-center">
                                <input
                                    value={l.label || ""}
                                    onChange={(e) => updateLine(i, "label", e.target.value)}
                                    placeholder="Label (e.g. Press)"
                                    className="flex-1 border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                />
                                <input
                                    value={l.email || ""}
                                    onChange={(e) => updateLine(i, "email", e.target.value)}
                                    placeholder="email@oakbridge.in"
                                    className="flex-1 border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-mono outline-none focus:border-[#002B5C]"
                                />
                                <button
                                    type="button"
                                    onClick={() => removeLine(i)}
                                    className="text-[#CC0033] text-xs px-2 hover:underline"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        {lines.length === 0 && (
                            <p className="text-sm text-[#4B5563]">No direct lines yet — click “Add line”.</p>
                        )}
                    </div>
                </div>

                <NavEditor />

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


const DEFAULT_NAV = [
    { to: "/what-we-do", label: "What We Do", hidden: false },
    { to: "/books", label: "Bookstore", hidden: false },
    { to: "/events", label: "Events", hidden: false },
    { to: "/academy", label: "Academy", hidden: false },
    { to: "/digital-solutions", label: "Digital Solutions", hidden: false },
    { to: "/authors", label: "Authors", hidden: false },
    { to: "/about", label: "About", hidden: false },
];

function NavEditor() {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        fetchCollection("site_nav")
            .then((d) => setItems(d?.items?.length ? d.items : DEFAULT_NAV))
            .catch(() => setItems(DEFAULT_NAV));
    }, []);
    if (!items) return null;

    const update = (i, k, v) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
    const move = (i, dir) =>
        setItems((a) => {
            const j = i + dir;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });
    const add = () => setItems((a) => [...a, { label: "New link", to: "/", hidden: false }]);
    const remove = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
    const save = async () => {
        setSaving(true);
        try {
            const payload = items
                .map((it) => ({ label: (it.label || "").trim(), to: (it.to || "").trim(), hidden: !!it.hidden }))
                .filter((it) => it.label && it.to);
            await adminSaveCollection("site_nav", payload);
            toast.success("Navigation saved — live on the site.");
        } catch {
            toast.error("Could not save navigation.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-[#E5E7EB] bg-white p-6" data-testid="nav-editor">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="font-serif text-xl text-[#002B5C]">Header navigation</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Rename, reorder, hide or add the links in the top menu. Use internal paths like <span className="font-mono">/about</span>. Order here = order on the site.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1.5 hover:bg-[#F5F7FA]">
                        <Plus size={12} strokeWidth={1.5} /> Add link
                    </button>
                    <button type="button" onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA] disabled:opacity-40">
                        {saving ? "…" : "Save nav"}
                    </button>
                </div>
            </div>
            <div className="mt-4 space-y-2">
                {items.map((it, i) => (
                    <div key={i} className={`flex items-center gap-2 border border-[#E5E7EB] p-2 ${it.hidden ? "bg-[#F5F7FA] opacity-70" : "bg-white"}`}>
                        <div className="flex flex-col">
                            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="border border-[#E5E7EB] p-0.5 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={11} /></button>
                            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-0.5 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={11} /></button>
                        </div>
                        <input value={it.label || ""} onChange={(e) => update(i, "label", e.target.value)} placeholder="Label" className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <input value={it.to || ""} onChange={(e) => update(i, "to", e.target.value)} placeholder="/path" className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm font-mono outline-none focus:border-[#002B5C]" />
                        <button type="button" onClick={() => update(i, "hidden", !it.hidden)} title={it.hidden ? "Hidden — click to show" : "Visible — click to hide"} className="border border-[#E5E7EB] p-1.5 hover:bg-[#F5F7FA]">
                            {it.hidden ? <EyeOff size={14} strokeWidth={1.5} className="text-[#4B5563]" /> : <Eye size={14} strokeWidth={1.5} className="text-[#002B5C]" />}
                        </button>
                        <button type="button" onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1.5 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={14} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}
