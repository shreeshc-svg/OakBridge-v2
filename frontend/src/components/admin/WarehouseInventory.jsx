import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, AlertTriangle, PackageX, Download, FileText, X, GitCompare } from "lucide-react";
import { adminWhInventory, adminWhSetCount, adminWhInvMove, adminWhInventoryXlsx, adminWhBrochure, saveBlob, fetchCategories,
    formatApiError, formatINR, mediaUrl } from "../../lib/api";
import ExportButton from "./ExportButton";

/**
 * Admin → Warehouse → Inventory (Oct 2026): the WAREHOUSE's counts, with the
 * same search / view / edit / export as Admin → Inventory (the website's
 * stock). Every change is a movement in the ledger — who, when, why — so
 * "Save count" asks for a reason and books the difference as a correction.
 * Nothing deletes: copies leave by a movement out; a wrong movement is undone
 * in the Movements tab. Backend: warehouse.py adm_inventory / adm_set_count /
 * adm_inventory_move.
 */
const IN = [["printer", "Arrived from printer"], ["return", "Customer return (good copy)"]];
const OUT = [["damaged", "Damaged"], ["sample", "Free copy / sample"], ["author_copy", "Author copy"], ["sale_offline", "Offline / dealer sale"]];
const REASON = Object.fromEntries([...IN, ...OUT, ["correction_in", "Correction +"], ["correction_out", "Correction −"],
    ["website_order", "Website order"], ["opening", "Opening count"]]);
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function WarehouseInventory({ onHistory }) {
    const [d, setD] = useState(null);
    const [q, setQ] = useState("");
    const [view, setView] = useState("all");
    const [open, setOpen] = useState(null);
    const load = useCallback(() => adminWhInventory().then(setD).catch((e) => { toast.error(formatApiError(e)); setD({ rows: [], threshold: 10 }); }), []);
    useEffect(() => { load(); }, [load]);

    const rows = useMemo(() => {
        if (!d) return [];
        const t = q.trim().toLowerCase();
        const digits = q.replace(/[^0-9Xx]/g, "");
        let a = d.rows.filter((b) => !t || [b.title, b.author, b.category].some((f) => (f || "").toLowerCase().includes(t))
            || (digits.length >= 4 && String(b.isbn || "").replace(/[^0-9Xx]/g, "").includes(digits)));
        const wh = (b) => (b.wh_stock == null ? 0 : b.wh_stock);
        if (view === "out") a = a.filter((b) => wh(b) <= 0);
        if (view === "low") a = a.filter((b) => wh(b) > 0 && wh(b) <= d.threshold);
        if (view === "diff") a = a.filter((b) => b.diff);
        if (view === "uncounted") a = a.filter((b) => b.wh_stock == null);
        return [...a].sort((x, y) => wh(x) - wh(y));
    }, [d, q, view]);

    if (!d) return <p className="text-sm text-[#4B5563] mt-6">Loading…</p>;
    const all = d.rows;
    const units = all.reduce((n, b) => n + Math.max(0, b.wh_stock || 0), 0);
    const value = all.reduce((n, b) => n + Math.max(0, b.wh_stock || 0) * (Number(b.price) || 0), 0);
    const out = all.filter((b) => (b.wh_stock ?? 0) <= 0).length;
    const low = all.filter((b) => (b.wh_stock ?? 0) > 0 && b.wh_stock <= d.threshold).length;
    const diffs = all.filter((b) => b.diff).length;
    const uncounted = all.filter((b) => b.wh_stock == null).length;
    return (
        <div className="mt-6 space-y-5" data-testid="wh-inventory">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                <p className="text-sm text-[#4B5563] max-w-2xl">
                    The warehouse's own count of every book (packs and hampers are counted per book). Mode: <b>{d.mode}</b>
                    {d.mode !== "live" && " — during the trial these counts don't change the website's stock."}
                </p>
                <div className="flex flex-wrap items-center gap-2" data-testid="wh-inv-exports">
                    <ExportButton path="/admin/warehouse/inventory/export.csv" label="CSV" className="h-10" />
                    <XlsxButton />
                    <BrochureButton />
                </div>
            </div>
            {/* Six tiles, one height, one label style. Money is shortened
                (₹2.39 Cr) so it can never overflow; the exact figure is in the
                tooltip and in the Excel export. The last three filter the
                table: click to filter, click again (or ✕) to clear. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="wh-inv-tiles">
                <StatTile label="Titles" value={num(all.length)} />
                <StatTile label="Units on shelf" value={num(units)} />
                <StatTile label="Shelf value" value={compactINR(value)} title={`${formatINR(value)} at selling price`} hint="at selling price" />
                <StatTile label="Out / below 0" value={num(out)} icon={PackageX} tone="text-[#CC0033]" active={view === "out"} onClick={() => setView(view === "out" ? "all" : "out")} />
                <StatTile label={`Low (≤ ${d.threshold})`} value={num(low)} icon={AlertTriangle} tone="text-[#B45309]" active={view === "low"} onClick={() => setView(view === "low" ? "all" : "low")} />
                <StatTile label="≠ Website" value={num(diffs)} icon={GitCompare} tone={diffs ? "text-[#CC0033]" : ""} active={view === "diff"} onClick={() => setView(view === "diff" ? "all" : "diff")} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, ISBN, category" data-testid="wh-inv-search"
                        className="w-full sm:w-80 border border-[#E5E7EB] bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                </div>
                {uncounted > 0 && <button type="button" onClick={() => setView(view === "uncounted" ? "all" : "uncounted")} className="text-xs underline text-[#B45309]">{uncounted} never counted</button>}
                {view !== "all" && (
                    <button type="button" onClick={() => setView("all")}
                        className="inline-flex items-center gap-1 text-xs bg-[#002B5C] text-white px-2 py-1">
                        {VIEW_LABEL[view]} <X size={12} aria-label="Clear filter" />
                    </button>
                )}
                <span className="text-xs text-[#6B7280] ml-auto">{rows.length} shown</span>
            </div>
            <div className="bg-white border border-[#E5E7EB] overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[#4B5563] border-b border-[#E5E7EB] align-bottom">
                        <th className="px-3 py-2">Book</th><th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">Warehouse</th><th className="px-3 py-2 text-right whitespace-nowrap">Website</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">Owed</th><th className="px-3 py-2 whitespace-nowrap">Last movement</th><th className="px-3 py-2" />
                    </tr></thead>
                    <tbody>
                        {rows.map((b) => (
                            <React.Fragment key={b.id}>
                                <tr className="border-b border-[#E5E7EB] align-top">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-3">
                                            {b.cover_image && <img src={mediaUrl(b.cover_image)} alt="" className="w-8 h-11 object-cover border border-[#E5E7EB]" />}
                                            <div className="min-w-0">
                                                <div className="text-[#002B5C] truncate sm:max-w-[280px]">{b.title}</div>
                                                <div className="text-[11px] text-[#4B5563] font-mono">{b.isbn}{b.pod ? " · print on demand" : ""}{b.coming_soon ? " · pre-order" : ""}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-[#4B5563] whitespace-nowrap">{b.category}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${b.wh_stock == null ? "text-[#9CA3AF]" : b.wh_stock < 0 ? "text-[#CC0033]" : b.wh_stock <= d.threshold ? "text-[#B45309]" : "text-[#002B5C]"}`}>{b.wh_stock ?? "—"}</td>
                                    <td className="px-3 py-2 text-right font-mono">{b.stock}{b.diff ? <span className="block text-[10px] text-[#CC0033]">{b.diff > 0 ? "+" : ""}{b.diff} vs website</span> : null}</td>
                                    <td className="px-3 py-2 text-right font-mono">{b.owed || "—"}</td>
                                    <td className="px-3 py-2 text-xs text-[#4B5563] whitespace-nowrap">{b.last_at ? <>{when(b.last_at)}<span className="block">{REASON[b.last_reason] || b.last_reason}</span></> : "—"}</td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        <button type="button" className="text-xs border border-[#002B5C] px-2 py-1 mr-2" onClick={() => setOpen(open === b.id ? null : b.id)} data-testid="wh-inv-edit">{open === b.id ? "Close" : "Edit"}</button>
                                        {onHistory && <button type="button" className="text-xs underline" onClick={() => onHistory(b.isbn || b.title)}>History</button>}
                                    </td>
                                </tr>
                                {open === b.id && <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]"><td colSpan={7} className="px-3 py-3"><EditPanel b={b} onDone={() => { setOpen(null); load(); }} /></td></tr>}
                            </React.Fragment>
                        ))}
                        {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-[#4B5563]">No matching books.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function EditPanel({ b, onDone }) {
    const [count, setCount] = useState(b.wh_stock ?? 0);
    const [note, setNote] = useState("");
    const [qty, setQty] = useState(1);
    const [reason, setReason] = useState("printer");
    const [mnote, setMnote] = useState("");
    const [busy, setBusy] = useState(false);
    const run = async (fn, ok) => {
        setBusy(true);
        try {
            const r = await fn();
            toast.success(ok);
            (r?.below_zero || []).forEach((x) => toast.warning(`${x.title}: warehouse count is now ${x.wh_stock}. ${x.note}`, { duration: 10000 }));
            onDone();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const diff = Number(count) - (b.wh_stock ?? 0);
    const inp = "border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm";
    return (
        <div className="grid md:grid-cols-2 gap-5 text-sm">
            <div className="space-y-2">
                <div className="font-medium text-[#002B5C]">Set the counted number</div>
                <div className="flex flex-wrap items-center gap-2">
                    <input type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} className={`${inp} w-24 font-mono`} aria-label="Counted copies" />
                    <span className={`text-xs ${diff ? "text-[#B45309]" : "text-[#6B7280]"}`}>{diff ? `${diff > 0 ? "+" : ""}${diff} copies (saved as a correction)` : "no change"}</span>
                </div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — e.g. shelf counted 28 Oct by Ravi" className={`${inp} w-full`} />
                <button type="button" disabled={busy || !diff || note.trim().length < 3} onClick={() => run(() => adminWhSetCount(b.id, Number(count), note), "Count saved.")}
                    className="bg-[#002B5C] text-white px-3 py-1.5 text-xs disabled:opacity-40">Save count</button>
            </div>
            <div className="space-y-2">
                <div className="font-medium text-[#002B5C]">Copies in or out</div>
                <div className="flex flex-wrap items-center gap-2">
                    <select value={reason} onChange={(e) => setReason(e.target.value)} className={inp}>
                        <optgroup label="In">{IN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
                        <optgroup label="Out">{OUT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
                    </select>
                    <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={`${inp} w-20 font-mono`} aria-label="Copies" />
                </div>
                <input value={mnote} onChange={(e) => setMnote(e.target.value)} placeholder="Note (bill no., who it went to…)" className={`${inp} w-full`} />
                <button type="button" disabled={busy || !(Number(qty) > 0)} onClick={() => run(() => adminWhInvMove(b.id, Number(qty), reason, mnote), "Saved.")}
                    className="border border-[#002B5C] px-3 py-1.5 text-xs disabled:opacity-40">{IN.some(([v]) => v === reason) ? "Add copies" : "Remove copies"}</button>
            </div>
            <p className="md:col-span-2 text-[11px] text-[#6B7280]">Every change is a line in Movements with your name and note. A mistake is undone there (within 24 hours), not deleted.</p>
        </div>
    );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Founders / internal reports: Summary + Inventory sheets (warehouse.py adm_inventory_xlsx). */
function XlsxButton() {
    const [busy, setBusy] = useState(false);
    const go = async () => {
        setBusy(true);
        try { saveBlob(await adminWhInventoryXlsx(), `warehouse-inventory-${today()}.xlsx`); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    return (
        <button type="button" onClick={go} disabled={busy} data-testid="wh-inv-xlsx"
            className="inline-flex items-center gap-2 h-10 border border-[#002B5C] text-[#002B5C] px-4 text-sm font-medium hover:bg-[#F5F7FA] transition-colors disabled:opacity-50">
            <Download size={14} strokeWidth={1.5} />{busy ? "Preparing…" : "Excel"}
        </button>
    );
}

/**
 * Vendor catalogue PDF: titles with cover, author, ISBN, edition, binding,
 * pages, MRP and availability — no internal counts (warehouse.py
 * adm_inventory_brochure). Options: one category or all, only what can be
 * ordered (in stock, print on demand, pre-order), with or without covers.
 */
function BrochureButton() {
    const [open, setOpen] = useState(false);
    const [cats, setCats] = useState([]);
    const [o, setO] = useState({ category: "", available_only: true, covers: true });
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open && !cats.length) fetchCategories().then((c) => setCats(Array.isArray(c) ? c.filter((x) => x.book_count) : [])).catch(() => {}); }, [open, cats.length]);
    const go = async () => {
        setBusy(true);
        try {
            const blob = await adminWhBrochure(o);
            saveBlob(blob, `oakbridge-${o.category || "catalogue"}-${today().slice(0, 7)}.pdf`);
            setOpen(false);
        } catch (e) {
            let msg = formatApiError(e);
            try { const t = await e?.response?.data?.text?.(); if (t) msg = JSON.parse(t).detail || msg; } catch { /* keep msg */ }
            toast.error(msg);
        } finally { setBusy(false); }
    };
    return (
        <span className="relative">
            <button type="button" onClick={() => setOpen(!open)} data-testid="wh-inv-brochure" aria-expanded={open}
                className="inline-flex items-center gap-2 h-10 bg-[#002B5C] text-white px-4 text-sm font-medium hover:bg-[#001F42] transition-colors">
                <FileText size={14} strokeWidth={1.5} />Vendor brochure (PDF)
            </button>
            {open && (
                <div className="absolute right-0 z-20 mt-2 w-72 bg-white border border-[#E5E7EB] shadow-lg p-3 space-y-2 text-sm">
                    <div className="font-medium text-[#002B5C]">Catalogue for book vendors</div>
                    <p className="text-[11px] text-[#6B7280]">Title, author, ISBN, edition, binding, pages, MRP and availability. No stock numbers.</p>
                    <select value={o.category} onChange={(e) => setO({ ...o, category: e.target.value })} className="w-full border border-[#E5E7EB] px-2 py-1.5">
                        <option value="">All categories</option>
                        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={o.available_only} onChange={(e) => setO({ ...o, available_only: e.target.checked })} /> Only titles that can be ordered (hide out of stock)</label>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={o.covers} onChange={(e) => setO({ ...o, covers: e.target.checked })} /> With cover images (slower)</label>
                    <button type="button" disabled={busy} onClick={go} className="w-full bg-[#002B5C] text-white py-2 text-xs disabled:opacity-50">{busy ? "Making the PDF… (up to a minute)" : "Download PDF"}</button>
                </div>
            )}
        </span>
    );
}

const VIEW_LABEL = { out: "Out / below 0", low: "Low stock", diff: "≠ Website", uncounted: "Never counted" };
const num = (n) => Number(n || 0).toLocaleString("en-IN");
// ₹2,38,82,935 -> "₹2.39 Cr"; ₹4,52,300 -> "₹4.52 L"; smaller amounts in full.
const compactINR = (n) => {
    const v = Number(n || 0);
    if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
    if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
    return formatINR(v);
};

/** One summary tile. With onClick it is a filter toggle (pressed = filtering). */
function StatTile({ label, value, icon: Icon = null, tone = "", hint = "", title, onClick, active = false }) {
    const body = (
        <>
            <div className="flex items-center gap-1.5 h-4 min-w-0">
                {Icon && <Icon size={12} strokeWidth={1.75} className={`flex-shrink-0 ${tone || "text-[#4B5563]"}`} aria-hidden="true" />}
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4B5563] truncate">{label}</span>
            </div>
            <div className={`mt-2 font-serif text-2xl leading-none tabular-nums truncate ${tone || "text-[#002B5C]"}`} title={title}>{value}</div>
            <div className="mt-1.5 h-4 text-[11px] text-[#6B7280] truncate">
                {onClick ? (active ? "Filtering — click to clear" : "Click to filter") : hint}
            </div>
        </>
    );
    const box = "min-w-0 text-left bg-white border p-4 transition-colors";
    if (!onClick) return <div className={`${box} border-[#E5E7EB]`}>{body}</div>;
    return (
        <button type="button" onClick={onClick} aria-pressed={active}
            className={`${box} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#002B5C] ${active ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#E5E7EB] hover:border-[#002B5C]"}`}>
            {body}
        </button>
    );
}
