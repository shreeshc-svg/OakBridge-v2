import { titleFor } from "../../lib/binding";
import BindingBadge from "../BindingBadge";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, AlertTriangle, PackageX, Download, FileText, X, GitCompare, CalendarClock, Printer } from "lucide-react";
import { adminWhInventory, adminWhSetCount, adminWhMatchWebsite, adminWhSetBoth, adminWhInvMove, adminWhInventoryXlsx, adminWhBrochure, saveBlob, fetchCategories,
    formatApiError, formatINR, mediaUrl } from "../../lib/api";
import ExportButton from "./ExportButton";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin } from "../../lib/rbac";
import { preorderState, formatLaunchDate, formatLaunchTimes } from "../../lib/preorder";

/**
 * Admin → Warehouse → Stock (Oct 2026; one-stock rework Nov 2026): THE stock
 * screen. With the warehouse live, a book's stock is its shelf count; the
 * website's "available online" follows it, and Admin → Inventory only keeps
 * packs and hampers (not counted here). Every change is a movement in the ledger — who, when, why — so
 * "Save count" asks for a reason and books the difference as a correction.
 * Nothing deletes: copies leave by a movement out; a wrong movement is undone
 * in the Movements tab. Backend: warehouse.py adm_inventory / adm_set_count /
 * adm_inventory_move.
 */
const IN = [["printer", "Arrived from printer"], ["return", "Customer return (good copy)"]];
const OUT = [["damaged", "Damaged"], ["sample", "Free copy / sample"], ["author_copy", "Author copy"], ["sale_offline", "Offline / dealer sale"],
    ["amazon_fba", "Sent to Amazon FBA"], ["amazon_vendor_po", "Amazon Vendor PO"], ["office", "Sent to office"]];
const REASON = Object.fromEntries([...IN, ...OUT, ["correction_in", "Correction +"], ["correction_out", "Correction −"],
    ["website_order", "Website order"], ["opening", "Opening count"],
    // Amazon / Flipkart daily sheet (backend/warehouse_marketplace.py)
    ["amazon_mp", "Carton out – Amazon"], ["flipkart_mp", "Carton out – Flipkart"],
    ["short_cancelled", "Short parcel cancelled – back in stock"]]);
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function WarehouseInventory({ onHistory }) {
    const { user } = useAuth();
    const canFix = isSuperadmin(user?.role);   // Fix mismatch (website-only repair) is superadmin
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
        if (view === "out") a = a.filter((b) => isOut(b));
        if (view === "low") a = a.filter((b) => isLow(b, d.threshold));
        if (view === "diff") a = a.filter((b) => b.diff);
        if (view === "uncounted") a = a.filter((b) => needsCount(b));
        if (["preorder", "pod", "launched_empty"].includes(view)) a = a.filter((b) => kindOf(b) === view);
        // Problems first (launched with no copies, then the emptiest real
        // books); pre-orders / POD, which are empty by design, after them.
        const rank = (b) => ({ launched_empty: 0, book: 1, pod: 2, preorder: 2 }[kindOf(b)] ?? 1);
        return [...a].sort((x, y) => rank(x) - rank(y) || wh(x) - wh(y));
    }, [d, q, view]);

    if (!d) return <p className="text-sm text-[#4B5563] mt-6">Loading…</p>;
    const all = d.rows;
    const units = all.reduce((n, b) => n + Math.max(0, b.wh_stock || 0), 0);
    const value = all.reduce((n, b) => n + Math.max(0, b.wh_stock || 0) * (Number(b.price) || 0), 0);
    const out = all.filter((b) => isOut(b)).length;
    const low = all.filter((b) => isLow(b, d.threshold)).length;
    const pre = all.filter((b) => kindOf(b) === "preorder");
    const preOwed = pre.reduce((n, b) => n + (b.owed || 0), 0);
    const pods = all.filter((b) => kindOf(b) === "pod").length;
    const launchedEmpty = all.filter((b) => kindOf(b) === "launched_empty").length;
    const diffs = all.filter((b) => b.diff).length;
    const uncounted = all.filter((b) => needsCount(b)).length;
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
            {/* Books with no copies BY DESIGN are counted here, not in Out /
                Low / ≠ Website above — so those three show only real problems.
                The red one is the exception: a pre-order whose launch has
                passed with nothing on the shelf, unbuyable on the site. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="wh-inv-bydesign">
                <StatTile label="Launched, no copies" value={num(launchedEmpty)} icon={AlertTriangle} tone={launchedEmpty ? "text-[#CC0033]" : ""}
                    title="Pre-order launch has passed and there are no copies — the site shows it out of stock. Add stock or tick Print on demand (Admin → Books)."
                    active={view === "launched_empty"} onClick={() => setView(view === "launched_empty" ? "all" : "launched_empty")} />
                <StatTile label={`Pre-orders · ${num(preOwed)} cop${preOwed === 1 ? "y" : "ies"} owed`} value={num(pre.length)} icon={CalendarClock}
                    title="Not printed yet. Copies owed = paid pre-orders waiting; arriving copies go to them first."
                    active={view === "preorder"} onClick={() => setView(view === "preorder" ? "all" : "preorder")} />
                <StatTile label="Print on demand" value={num(pods)} icon={Printer} title="No copies kept: printed per order"
                    active={view === "pod"} onClick={() => setView(view === "pod" ? "all" : "pod")} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, ISBN, category" data-testid="wh-inv-search"
                        className="w-full sm:w-80 border border-[#E5E7EB] bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                </div>
                {uncounted > 0 && (
                    <button type="button" onClick={() => setView(view === "uncounted" ? "all" : "uncounted")} data-testid="wh-inv-never"
                        title="Added after the trial started, so the opening count missed them. Count the shelf, then Adjust → Counted the shelf (0 if none)."
                        className="inline-flex items-center gap-1 border border-[#B45309] text-[#B45309] bg-[#FFFBEB] px-2 py-1 text-xs font-medium">
                        <AlertTriangle size={12} aria-hidden="true" />{uncounted} never counted — set a count
                    </button>
                )}
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
                        {/* One stock, three plain words: what's physically ON THE SHELF,
                            what of it is RESERVED (paid orders waiting + short-parcel
                            copies set aside), and what the website can still SELL. */}
                        <th className="px-3 py-2">Book</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap" title="Copies physically in the warehouse (the count)">On shelf</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap" title="Paid orders waiting for copies + copies set aside for short website parcels">Reserved</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap" title="What the website can sell now — follows the shelf count">Available online</th>
                        <th className="px-3 py-2 whitespace-nowrap">Status</th>
                        <th className="px-3 py-2 whitespace-nowrap">Last movement</th><th className="px-3 py-2" />
                    </tr></thead>
                    <tbody>
                        {rows.map((b) => (
                            <React.Fragment key={b.id}>
                                <tr className="border-b border-[#E5E7EB] align-top">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-3">
                                            {b.cover_image && <img src={mediaUrl(b.cover_image)} alt="" className="w-8 h-11 object-cover border border-[#E5E7EB]" />}
                                            <div className="min-w-0">
                                                <div className="text-[#002B5C] line-clamp-2 sm:max-w-[320px]" title={b.plain_title || b.title}><BindingBadge binding={b.binding} />{b.plain_title || b.title}</div>
                                                <div className="text-[11px] text-[#4B5563] font-mono">{b.isbn}</div>
                                                <KindTag b={b} />
                                            </div>
                                        </div>
                                    </td>
                                    {byDesign(b) && (b.wh_stock ?? 0) <= 0 ? (
                                        // Empty by design: a −2 here is 2 copies owed, not a fault.
                                        <td className="px-3 py-2 text-right text-[11px] text-[#6B7280] whitespace-nowrap">
                                            {kindOf(b) === "preorder" ? "awaiting print" : "printed to order"}
                                        </td>
                                    ) : (
                                        <td className={`px-3 py-2 text-right font-mono ${b.wh_stock == null ? "text-[#9CA3AF]" : b.wh_stock < 0 ? "text-[#CC0033]" : b.wh_stock <= d.threshold ? "text-[#B45309]" : "text-[#002B5C]"}`}>{b.wh_stock ?? "—"}</td>
                                    )}
                                    <td className="px-3 py-2 text-right font-mono" title={`${b.owed || 0} owed to paid orders · ${b.set_aside || 0} set aside for short parcels`}>
                                        {(b.owed || 0) + (b.set_aside || 0) || "—"}</td>
                                    <td className="px-3 py-2 text-right font-mono">{b.stock}</td>
                                    <td className="px-3 py-2"><StockStatus b={b} threshold={d.threshold} /></td>
                                    <td className="px-3 py-2 text-xs text-[#4B5563] whitespace-nowrap">{b.last_at ? <>{when(b.last_at)}<span className="block">{REASON[b.last_reason] || b.last_reason}</span></> : "—"}</td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        <button type="button" className="text-xs border border-[#002B5C] px-2 py-1 mr-2" onClick={() => setOpen(open === b.id ? null : b.id)} data-testid="wh-inv-edit">{open === b.id ? "Close" : "Adjust"}</button>
                                        {onHistory && <button type="button" className="text-xs underline" onClick={() => onHistory(b.isbn || b.title)}>History</button>}
                                    </td>
                                </tr>
                                {open === b.id && <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]"><td colSpan={7} className="px-3 py-3"><AdjustPanel b={b} live={d.mode === "live"} canFix={canFix} onDone={() => { setOpen(null); load(); }} /></td></tr>}
                            </React.Fragment>
                        ))}
                        {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-[#4B5563]">No matching books.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/*
 * ONE way to change a book's stock (Nov 2026). Before, the row offered
 * "Save count", "Copies in or out", "Set both" and "Set website to match" —
 * four forms an admin had to choose between. Now: pick what happened, enter
 * the number, add a note, Save. Each choice is still its own ledger line
 * (who, when, why) and the website follows the warehouse automatically.
 *
 *   Counted the shelf  -> warehouse_match.set_both in live mode: the count is
 *                         saved AND the website brought in line, so a count
 *                         also repairs any mismatch and works on a title never
 *                         counted before. (Trial mode: the plain count.)
 *   Copies in / out    -> warehouse.adm_inventory_move with that reason.
 *
 * "Fix mismatch" (website only, warehouse untouched) shows only when the two
 * disagree, as a one-click repair — it is not a daily action.
 */
const ACTIONS = [
    ["count", "Counted the shelf", "count"],
    ...IN.map(([v, l]) => [v, l, "in"]),
    ...OUT.map(([v, l]) => [v, l, "out"]),
];

function AdjustPanel({ b, live, canFix = false, onDone }) {
    const aside = b.set_aside || 0;
    const [action, setAction] = useState("count");
    const [n, setN] = useState(String((b.wh_stock ?? 0) + aside));
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const kind = (ACTIONS.find(([v]) => v === action) || [])[2];
    const pick = (v) => {
        setAction(v);
        setN(v === "count" ? String((b.wh_stock ?? 0) + aside) : "1");
    };
    const num = Number(n);
    const valid = String(n).trim() !== "" && Number.isInteger(num) && (kind === "count" ? num >= 0 : num > 0);
    const after = kind === "count" ? num - aside : (b.wh_stock ?? 0) + (kind === "in" ? num : -num);
    const changes = kind !== "count" || b.wh_stock == null || after !== (b.wh_stock ?? 0) || Boolean(b.diff);
    const needNote = kind === "count" ? 3 : 0;
    const save = async () => {
        setBusy(true);
        try {
            let r;
            if (kind === "count") {
                r = live ? await adminWhSetBoth(b.id, num, note) : await adminWhSetCount(b.id, num, note);
            } else {
                r = await adminWhInvMove(b.id, num, action, note);
            }
            toast.success(kind === "count" ? `Count saved: ${num} on the shelf.` : `Saved: ${kind === "in" ? "+" : "−"}${num}.`);
            const below = r?.below_zero || r?.count?.below_zero || [];
            below.forEach((x) => toast.warning(`${titleFor(x.title, x.book_id || x.id)}: warehouse count is now ${x.wh_stock}. ${x.note}`, { duration: 10000 }));
            onDone();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const inp = "border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm";
    return (
        <div className="space-y-3 text-sm" data-testid="wh-adjust">
            <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                    <span className="block text-xs text-[#6B7280] mb-1">What happened?</span>
                    <select value={action} onChange={(e) => pick(e.target.value)} className={inp} data-testid="wh-adjust-action">
                        <option value="count">Counted the shelf</option>
                        <optgroup label="Copies in">{IN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
                        <optgroup label="Copies out">{OUT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
                    </select>
                </label>
                <label className="block">
                    <span className="block text-xs text-[#6B7280] mb-1">{kind === "count" ? "Copies on the shelf" : "Copies"}</span>
                    <input type="number" min={kind === "count" ? 0 : 1} value={n} onChange={(e) => setN(e.target.value)} className={`${inp} w-28 font-mono`} data-testid="wh-adjust-n" />
                </label>
                <label className="block flex-1 min-w-[220px]">
                    <span className="block text-xs text-[#6B7280] mb-1">Note {kind === "count" ? "(required)" : "(bill no., who it went to…)"}</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "count" ? "e.g. shelf counted 27 Nov by Ravi" : ""} className={`${inp} w-full`} data-testid="wh-adjust-note" />
                </label>
                <button type="button" onClick={save} disabled={busy || !valid || !changes || note.trim().length < needNote}
                    className="bg-[#002B5C] text-white px-4 py-2 text-sm disabled:opacity-40" data-testid="wh-adjust-save">{busy ? "Saving…" : "Save"}</button>
            </div>
            {valid && (
                <p className="text-xs text-[#4B5563]" data-testid="wh-adjust-preview">
                    On shelf: <b>{b.wh_stock ?? "never counted"}</b> → <b>{kind === "count" ? num : after}</b>
                    {kind === "count" && aside ? ` (${aside} of them already sold to a short website parcel — counted ${after})` : ""}
                    {live ? " · the website follows automatically." : " · trial mode: the website is not changed."}
                    {kind === "count" && !changes ? " Nothing to change." : ""}
                </p>
            )}
            {live && b.diff ? (canFix ? <FixMismatch b={b} onDone={onDone} />
                : <p className="text-xs text-[#92400E]">Website and shelf disagree. Count the shelf above to fix both, or ask a super admin to use Fix mismatch.</p>) : null}
        </div>
    );
}

function FixMismatch({ b, onDone }) {
    const [busy, setBusy] = useState(false);
    const target = Math.max(0, (b.wh_stock ?? 0) + (b.owed || 0));
    const fix = async () => {
        if (!window.confirm(`Set the website stock of “${b.plain_title || b.title}” from ${b.stock} to ${target}?\n\nThe shelf count (${b.wh_stock ?? 0}) is not changed. If the shelf count is wrong, use “Counted the shelf” above instead.`)) return;
        setBusy(true);
        try { await adminWhMatchWebsite(b.id, "Fix mismatch: website set to the warehouse count"); toast.success(`Website stock set to ${target}.`); onDone(); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    return (
        <div className="border border-[#FDE68A] bg-[#FFFBEB] p-3 flex flex-wrap items-center gap-3" data-testid="wh-fix-mismatch">
            <span className="text-[#92400E]">Website shows {b.stock}, the shelf count says {target}.</span>
            <button type="button" disabled={busy} onClick={fix} className="border border-[#B4750F] text-[#92400E] px-3 py-1 text-xs bg-white disabled:opacity-40">Fix mismatch (set website to {target})</button>
            <span className="text-xs text-[#6B7280]">or count the shelf above — that fixes both.</span>
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

const VIEW_LABEL = { out: "Out / below 0", low: "Low stock", diff: "≠ Website", uncounted: "Never counted",
    preorder: "Pre-orders", pod: "Print on demand", launched_empty: "Launched, no copies" };

/* What a row IS (backend warehouse_core.inventory_kind): book | preorder |
   pod | launched_empty. Older API responses without `kind` read as books. */
const kindOf = (b) => b.kind || "book";
const byDesign = (b) => ["preorder", "pod"].includes(kindOf(b));
// Out / Low judge only ordinary books: a pre-order or POD title is empty on
// purpose, and "launched, no copies" has its own red tile.
const isOut = (b) => kindOf(b) === "book" && (b.wh_stock ?? 0) <= 0;
const isLow = (b, t) => kindOf(b) === "book" && (b.wh_stock ?? 0) > 0 && b.wh_stock <= t;
// Same rule as the go-live check: no count at all, and not empty by design.
const needsCount = (b) => b.wh_stock == null && !byDesign(b);

/* One status per row, in the words an admin would use. "≠ website" is added
   when the website and the shelf disagree (Adjust → Fix mismatch). */
function StockStatus({ b, threshold }) {
    const k = kindOf(b);
    const wh = b.wh_stock;
    const [label, cls] = k === "preorder" ? ["Pre-order", "bg-[#EDE9FE] text-[#5B21B6]"]
        : k === "pod" ? ["Print on demand", "bg-[#E0F2FE] text-[#075985]"]
        : k === "launched_empty" ? ["Launched, no copies", "bg-[#FEE2E2] text-[#991B1B]"]
        : wh == null ? ["Not counted yet", "bg-[#FEF3C7] text-[#92400E]"]
        : wh < 0 ? ["Below 0 — count it", "bg-[#FEE2E2] text-[#991B1B]"]
        : wh === 0 ? ["Out of stock", "bg-[#FEE2E2] text-[#991B1B]"]
        : wh <= threshold ? ["Low", "bg-[#FEF3C7] text-[#92400E]"]
        : ["In stock", "bg-[#DCFCE7] text-[#166534]"];
    return (
        <span className="inline-flex flex-col gap-0.5" data-testid="wh-stock-status">
            <span className={`text-[11px] px-1.5 py-0.5 whitespace-nowrap ${cls}`}>{label}</span>
            {b.diff ? <span className="text-[10px] text-[#CC0033] whitespace-nowrap" title="Website and shelf disagree — Adjust → Fix mismatch">≠ website</span> : null}
        </span>
    );
}

function KindTag({ b }) {
    const k = kindOf(b);
    if (k === "preorder") {
        const { at, timed } = preorderState(b);
        // IST only here (the GMT half is for international customers).
        const time = at && timed ? `, ${formatLaunchTimes(at).split(" · ")[0]}` : "";
        return (
            <div className="mt-0.5 text-[11px] text-[#B4750F]" data-testid="wh-inv-kind">
                Pre-order{at ? ` · launches ${formatLaunchDate(at)}${time}` : ""}
                {b.owed ? ` · ${b.owed} cop${b.owed === 1 ? "y" : "ies"} owed` : ""}
            </div>
        );
    }
    if (k === "launched_empty") {
        return (
            <div className="mt-0.5 text-[11px] text-[#CC0033]" data-testid="wh-inv-kind">
                Launched, no copies — not buyable on the site. Add stock, or tick Print on demand in Admin → Books.
                {b.owed ? ` ${b.owed} cop${b.owed === 1 ? "y" : "ies"} owed to paid orders.` : ""}
            </div>
        );
    }
    if (k === "pod") return <div className="mt-0.5 text-[11px] text-[#4B5563]" data-testid="wh-inv-kind">Print on demand</div>;
    return null;
}
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
