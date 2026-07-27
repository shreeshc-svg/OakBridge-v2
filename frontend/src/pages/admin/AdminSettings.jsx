import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ArrowUp, ArrowDown } from "lucide-react";
import { fetchSettings, adminSetSetting } from "../../lib/api";
import { ADMIN_NAV, applyNavOrder } from "../../lib/adminNav";


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

    // Admin sidebar order: merge saved order with any new/missing items.
    const savedNav = Array.isArray(s.admin_nav_order) ? s.admin_nav_order : [];
    // Same helper the sidebar uses, so the numbers here are exactly what renders.
    const navOrder = applyNavOrder(savedNav).map((l) => l.to);
    const navLabel = (to) => ADMIN_NAV.find((x) => x.to === to)?.label || to;
    const moveNav = (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= navOrder.length) return;
        const n = [...navOrder];
        [n[i], n[j]] = [n[j], n[i]];
        set("admin_nav_order", n);
    };
    const saveNavOrder = async () => {
        try {
            await adminSetSetting("admin_nav_order", navOrder);
            toast.success("Sidebar order saved — reload to see it.");
        } catch {
            toast.error("Could not save sidebar order.");
        }
    };

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
            await adminSetSetting("authors_per_row", Number(s.authors_per_row) || 4);
            await adminSetSetting(
                "authors_grid_rows",
                Math.max(0, Number(s.authors_grid_rows) || 0),
            );
            await adminSetSetting(
                "authors_carousel_title",
                (s.authors_carousel_title || "").trim() || "More from our list",
            );
            for (const p of ["vidhi", "summit"]) {
                await adminSetSetting(`${p}_carousel_autoplay`, s[`${p}_carousel_autoplay`] !== false);
                await adminSetSetting(`${p}_marquee_seconds`, Math.max(8, Number(s[`${p}_marquee_seconds`]) || 40));
            }
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

                <div className="border border-[#E5E7EB] bg-white p-6" data-testid="admin-nav-order">
                    <div className="flex items-center justify-between">
                        <h2 className="font-serif text-xl text-[#002B5C]">Admin sidebar order</h2>
                        <button onClick={saveNavOrder} className="text-sm border border-[#002B5C] text-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA]">
                            Save order
                        </button>
                    </div>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Rearrange the links in this admin sidebar. Reload the page after saving to see the new order.
                    </p>
                    <div className="mt-4 space-y-1.5 max-w-md">
                        {navOrder.map((to, i) => (
                            <div key={to} className="flex items-center gap-2 border border-[#E5E7EB] px-3 py-1.5">
                                <span className="font-mono text-xs text-[#4B5563] w-5">{String(i + 1).padStart(2, "0")}</span>
                                <span className="flex-1 text-sm text-[#002B5C]">{navLabel(to)}</span>
                                <button onClick={() => moveNav(i, -1)} disabled={i === 0} aria-label="Up" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25"><ArrowUp size={14} strokeWidth={1.5} /></button>
                                <button onClick={() => moveNav(i, 1)} disabled={i === navOrder.length - 1} aria-label="Down" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25"><ArrowDown size={14} strokeWidth={1.5} /></button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="border border-[#E5E7EB] bg-white p-6" data-testid="authors-layout-settings">
                    <h2 className="font-serif text-xl text-[#002B5C]">Authors page layout</h2>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="overline !text-[10px] block mb-1">Authors per row</label>
                            <select
                                value={s.authors_per_row ?? 4}
                                onChange={(e) => set("authors_per_row", Number(e.target.value))}
                                data-testid="setting-authors_per_row"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            >
                                <option value={3}>3 across</option>
                                <option value={4}>4 across</option>
                                <option value={5}>5 across</option>
                            </select>
                            <div className="text-[11px] text-[#4B5563] mt-1">
                                Widest screens only — phones show 2 and tablets step down automatically.
                            </div>
                        </div>
                        <Field
                            label="Rows before carousel"
                            k="authors_grid_rows"
                            type="number"
                            hint="0 puts every author in the grid and hides the carousel."
                        />
                    </div>
                    <div className="mt-4">
                        <Field label="Carousel heading" k="authors_carousel_title" />
                    </div>
                    <p className="text-[11px] text-[#4B5563] mt-3">
                        With 4 across and 2 rows, the first 8 authors show as a grid and the rest
                        become a swipeable row below.
                    </p>
                </div>

                <div className="border border-[#E5E7EB] bg-white p-6" data-testid="speaker-layout-settings">
                    <h2 className="font-serif text-xl text-[#002B5C]">Events — speaker sections layout</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Each speaker section is a single row that scrolls continuously. Set the scroll speed
                        (seconds for one full loop — lower is faster) and turn the movement on or off.
                    </p>
                    {[{ key: "vidhi", label: "Vidhi Utsav speakers" }, { key: "summit", label: "Summit speakers" }].map((sec) => (
                        <div key={sec.key} className="mt-5 border-t border-[#E5E7EB] pt-5 first:border-t-0 first:pt-0 first:mt-4">
                            <div className="overline !text-[10px] mb-3 !text-[#002B5C]">{sec.label}</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                                <div>
                                    <label className="overline !text-[10px] block mb-1">Scroll speed (seconds per loop)</label>
                                    <input
                                        type="number"
                                        min="8"
                                        value={s[`${sec.key}_marquee_seconds`] ?? 40}
                                        onChange={(e) => set(`${sec.key}_marquee_seconds`, e.target.value)}
                                        data-testid={`setting-${sec.key}_marquee_seconds`}
                                        className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                    <div className="text-[11px] text-[#4B5563] mt-1">On-screen speed (lower = faster) — the same value gives the same visual speed on both rows, whatever the speaker count. e.g. 40 = leisurely, 20 = brisk. Minimum 8.</div>
                                </div>
                                <label className="flex items-center gap-2 text-sm text-[#002B5C] cursor-pointer pb-2">
                                    <input
                                        type="checkbox"
                                        checked={s[`${sec.key}_carousel_autoplay`] !== false}
                                        onChange={(e) => set(`${sec.key}_carousel_autoplay`, e.target.checked)}
                                        data-testid={`setting-${sec.key}_carousel_autoplay`}
                                    />
                                    Auto-scroll (movement on)
                                </label>
                            </div>
                        </div>
                    ))}
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

                <div className="border border-dashed border-[#E5E7EB] bg-[#F5F7FA] p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Page editors</h2>
                    <p className="text-sm text-[#4B5563] mt-1">
                        Storefront page content now has its own editors:
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                        <Link
                            to="/admin/pages"
                            className="inline-flex items-center text-sm border border-[#002B5C] text-[#002B5C] px-4 py-2 hover:bg-white"
                        >
                            Pages — all storefront content →
                        </Link>
                        <Link
                            to="/admin/navigation"
                            className="inline-flex items-center text-sm border border-[#002B5C] text-[#002B5C] px-4 py-2 hover:bg-white"
                        >
                            Navigation — header &amp; footer links →
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
