import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, AlertTriangle, PackageX } from "lucide-react";
import { adminWhInventory, adminWhSetCount, adminWhInvMove, formatApiError, formatINR, mediaUrl } from "../../lib/api";
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
    const Tile = ({ label, v, tone = "", k }) => (
        <button type="button" onClick={() => k && setView(view === k ? "all" : k)}
            className={`text-left bg-white border p-4 ${view === k ? "border-[#002B5C] ring-1 ring-[#002B5C]" : "border-[#E5E7EB]"}`}>
            <div className="overline !text-[10px]">{label}</div>
            <div className={`font-serif text-2xl mt-1 ${tone || "text-[#002B5C]"}`}>{v}</div>
        </button>
    );
    return (
        <div className="mt-6 space-y-5" data-testid="wh-inventory">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[#4B5563] max-w-3xl">
                    The warehouse's own count of every book (packs and hampers are counted per book). Mode: <b>{d.mode}</b>
                    {d.mode !== "live" && " — during the trial these counts don't change the website's stock."}
                </p>
                <ExportButton path="/admin/warehouse/inventory/export.csv" label="Export CSV" count={all.length} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <Tile label="Titles" v={all.length} />
                <Tile label="Units on shelf" v={units} />
                <Tile label="Shelf value" v={formatINR(value)} />
                <Tile label={<span className="inline-flex items-center gap-1"><PackageX size={12} />Out / below 0</span>} v={out} tone="text-[#CC0033]" k="out" />
                <Tile label={<span className="inline-flex items-center gap-1"><AlertTriangle size={12} />Low (≤ {d.threshold})</span>} v={low} tone="text-[#B45309]" k="low" />
                <Tile label="≠ website" v={diffs} k="diff" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, ISBN, category" data-testid="wh-inv-search"
                        className="w-full sm:w-80 border border-[#E5E7EB] bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                </div>
                {uncounted > 0 && <button type="button" onClick={() => setView(view === "uncounted" ? "all" : "uncounted")} className="text-xs underline text-[#B45309]">{uncounted} never counted</button>}
                {view !== "all" && <button type="button" className="text-xs underline" onClick={() => setView("all")}>Show all</button>}
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
