import React, { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Search, X } from "lucide-react";
import {
    adminWhOverview, adminWhDocs, adminWhDoc, adminWhUndoDoc, adminWhTestCase, adminWhAccuracy,
    adminWhReplay, adminWhMode, adminWhGoLiveCheck, adminWhMovements, adminWhUndoMove, adminWhReview, adminWhCreateDoc, adminWhEditDoc,
    adminWhEditLines, adminWhDeleteDoc, adminWhRestoreDoc, adminWhResetFromSheet, syncInventoryFromSheet, whBooks, whDocFile, formatApiError,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin } from "../../lib/rbac";
import CourierRuns from "../../components/admin/CourierRuns";
import WarehouseInventory from "../../components/admin/WarehouseInventory";

/**
 * Admin → Warehouse: the manager's side of the warehouse trial.
 *
 *   Trial      start / go live / stop, and the daily "warehouse vs website"
 *              comparison that decides when it is safe to go live.
 *   Documents  every bill and invoice, the photo/PDF, what was read vs what
 *              was confirmed, Undo (24 h), and "use as test case".
 *   Accuracy   the error rate of the automatic reading, by document type and
 *              supplier, with the latest corrections and problem reports.
 *   Movements  the ledger, newest first, with Undo for single moves.
 *   Courier labels  the day's courier run: label sheet (PDF/Word) made here,
 *              sent to the phone filled in (components/admin/CourierRuns.jsx).
 *   To approve cartons the warehouse has packed, waiting for the
 *              order-management team: Approve (he may ship), Send back
 *              (repack; copies return to stock) or Cancel (copies return).
 *
 * The warehouse role itself never lands here: it is sent to /warehouse.
 */
const TABS = [["approve", "To approve"], ["inventory", "Inventory"], ["courier", "Courier labels"], ["trial", "Trial & comparison"], ["docs", "Bills & invoices"], ["accuracy", "Accuracy"], ["moves", "Movements"]];
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN") : "—");

export default function AdminWarehouse() {
    const { user } = useAuth();
    const [tab, setTab] = useState("approve");
    const [pending, setPending] = useState(null);
    const [moveQ, setMoveQ] = useState("");
    const refreshPending = useCallback(() => {
        adminWhDocs("awaiting_approval").then((d) => setPending(d.length)).catch(() => {});
    }, []);
    useEffect(refreshPending, [refreshPending]);
    if (user?.role === "warehouse") return <Navigate to="/warehouse" replace />;
    return (
        <div data-testid="admin-warehouse-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Stock in &amp; out</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">Warehouse</h1>
                </div>
                <Link to="/warehouse" className="bg-[#002B5C] text-white px-4 py-2 text-sm">Open the warehouse screen</Link>
            </div>
            <div className="mt-6 flex flex-wrap items-end gap-2 border-b border-[#E5E7EB]">
                {TABS.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                        className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === k ? "border-[#002B5C] text-[#002B5C] font-medium" : "border-transparent text-[#4B5563]"}`}>
                        {l}{k === "approve" && pending ? ` (${pending})` : ""}
                    </button>
                ))}
                {tab === "moves" && (
                    <div className="ml-auto mb-1.5 relative w-full sm:w-80" data-testid="wh-moves-search">
                        <Search size={15} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                        <input
                            value={moveQ}
                            onChange={(e) => setMoveQ(e.target.value)}
                            placeholder="Search book, ISBN, category, person, party, invoice…"
                            aria-label="Search stock movements"
                            className="w-full border border-[#E5E7EB] bg-white pl-9 pr-8 py-2 text-sm focus:border-[#002B5C] outline-none"
                        />
                        {moveQ && (
                            <button type="button" aria-label="Clear search" onClick={() => setMoveQ("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#4B5563] hover:text-[#CC0033]">
                                <X size={15} strokeWidth={1.5} />
                            </button>
                        )}
                    </div>
                )}
            </div>
            <div className="mt-6">
                {tab === "trial" && <TrialTab canSwitch={isSuperadmin(user?.role)} />}
                {tab === "approve" && <DocsTab key="approve" status="awaiting_approval" onChange={refreshPending} />}
                {tab === "docs" && <DocsTab key="docs" onChange={refreshPending} canDelete={isSuperadmin(user?.role)} />}
                {tab === "accuracy" && <AccuracyTab />}
                {tab === "courier" && <CourierRuns />}
                {tab === "inventory" && <WarehouseInventory onHistory={(q) => { setMoveQ(q); setTab("moves"); }} />}
                {tab === "moves" && <MovesTab q={moveQ} />}
            </div>
        </div>
    );
}

/* Trial re-baseline (superadmin): the stock sheet is the warehouse's own
   count, so the warehouse system's numbers are reset to it — sync the sheet,
   preview every change, confirm. Each change is saved as a correction
   (warehouse.py adm_reset_from_sheet). */
function ResetFromSheet({ onDone }) {
    const [busy, setBusy] = useState("");
    const [prev, setPrev] = useState(null);
    const sync = async () => {
        setBusy("sync");
        try {
            const r = await syncInventoryFromSheet();
            toast.success(`Sheet synced — ${r.updated ?? 0} book(s) updated on the website.${r.invalid_rows ? ` ${r.invalid_rows} row(s) unreadable.` : ""}`);
            setPrev(null);
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
    };
    const preview = async () => {
        setBusy("preview");
        try { setPrev(await adminWhResetFromSheet({ dry_run: true })); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
    };
    const apply = async () => {
        if (!prev?.count) return;
        const net = prev.changes.reduce((n, c) => n + c.diff, 0);
        if (!window.confirm(`Reset the warehouse count of ${prev.count} book(s) to the stock sheet?\n\nNet change: ${net > 0 ? "+" : ""}${net} copies.\nEach change is saved as a correction with your name — the history stays complete.\n\nDo this only when the sheet is up to date and nothing is half-packed.`)) return;
        setBusy("apply");
        try {
            const r = await adminWhResetFromSheet({ dry_run: false, expected: prev.count });
            toast.success(`Reset ${r.reset} book(s) to the sheet.`);
            setPrev(null); onDone();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
    };
    return (
        <div className="border border-[#002B5C] bg-white p-5 space-y-3" data-testid="wh-reset-from-sheet">
            <h2 className="font-serif text-2xl text-[#002B5C]">Reset warehouse counts from the stock sheet</h2>
            <p className="text-sm text-[#4B5563]">
                The Google Sheet is the warehouse's own count. Use this once (or after a full count) so the warehouse system starts from it:
                update the sheet → sync → preview → reset. Copies owed to waiting paid orders (pre-orders) stay deducted.
            </p>
            <div className="flex flex-wrap gap-2">
                <button type="button" className="border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm" disabled={!!busy} onClick={sync} data-testid="wh-reset-sync">
                    {busy === "sync" ? "Syncing…" : "1. Sync the sheet now"}</button>
                <button type="button" className="border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm" disabled={!!busy} onClick={preview} data-testid="wh-reset-preview">
                    {busy === "preview" ? "Comparing…" : "2. Preview changes"}</button>
                {prev && prev.count > 0 && (
                    <button type="button" className="bg-[#CC0033] text-white px-4 py-2 text-sm" disabled={!!busy} onClick={apply} data-testid="wh-reset-apply">
                        {busy === "apply" ? "Resetting…" : `3. Reset ${prev.count} book(s)`}</button>
                )}
            </div>
            {prev && (prev.count === 0
                ? <p className="text-sm text-[#15803D]">The warehouse already matches the sheet for all {prev.books} books.</p>
                : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="wh-reset-table">
                        {/* Number columns: fixed padding, no wrapping, same classes on
                            header and cell — the headers used to wrap ("Warehouse / now")
                            and sit out of line with their numbers. */}
                        <thead><tr className="text-left text-[#4B5563] align-bottom"><th className="py-2 pr-4">Book</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2">Warehouse now</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2">Sheet</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2">Owed to orders</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2">Will be</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2 pr-0">Change</th></tr></thead>
                        <tbody>
                            {prev.changes.slice(0, 300).map((c) => (
                                <tr key={c.id} className="border-t border-[#E5E7EB]">
                                    <td className="py-2 pr-4">{c.title}<div className="font-mono text-xs text-[#4B5563]">{c.isbn}</div></td>
                                    <td className="px-3 text-right whitespace-nowrap tabular-nums font-mono">{c.warehouse}</td>
                                    <td className="px-3 text-right whitespace-nowrap tabular-nums font-mono">{c.sheet}</td>
                                    <td className="px-3 text-right whitespace-nowrap tabular-nums font-mono text-[#6B7280]">{c.owed || "—"}</td>
                                    <td className="px-3 text-right whitespace-nowrap tabular-nums font-mono font-semibold">{c.target}</td>
                                    <td className={`px-3 text-right whitespace-nowrap tabular-nums pr-0 font-mono ${c.diff > 0 ? "text-[#15803D]" : "text-[#CC0033]"}`}>{c.diff > 0 ? `+${c.diff}` : c.diff}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                ))}
        </div>
    );
}

function TrialTab({ canSwitch }) {
    const [ov, setOv] = useState(null);
    const load = useCallback(() => { adminWhOverview().then(setOv).catch(() => setOv({ error: true })); }, []);
    useEffect(load, [load]);
    const setMode = async (mode, msg) => {
        if (!window.confirm(msg)) return;
        try { await adminWhMode(mode); toast.success("Done."); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!ov) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    if (ov.error) return <p className="text-sm text-[#CC0033]">Could not load.</p>;
    return (
        <div className="space-y-6">
            <div className="border border-[#E5E7EB] bg-white p-5">
                <div className="text-sm text-[#4B5563]">Status</div>
                <div className="font-serif text-3xl text-[#002B5C] mt-1" data-testid="wh-mode">
                    {ov.mode === "off" ? "Not started" : ov.mode === "trial" ? "Trial — website stock still from the sheet" : "Live — the warehouse sets website stock"}
                </div>
                <div className="text-xs text-[#4B5563] mt-1">Trial started {when(ov.started_at)}{ov.live_at ? ` · live since ${when(ov.live_at)}` : ""}</div>
                {canSwitch ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {ov.mode === "off" && (
                            <button type="button" className="bg-[#002B5C] text-white px-4 py-2 text-sm" data-testid="wh-start-trial"
                                onClick={() => setMode("trial", "Start the trial?\n\nEvery book's warehouse count starts from today's website stock. Website stock is not changed; the sheet keeps running.")}>
                                Start trial
                            </button>
                        )}

                        {ov.mode !== "off" && (
                            <button type="button" className="border border-[#CC0033] text-[#CC0033] px-4 py-2 text-sm"
                                onClick={() => setMode("off", "Stop the warehouse system? The sheet sync takes over stock again. Recorded movements are kept.")}>
                                Stop
                            </button>
                        )}
                    </div>
                ) : <p className="mt-3 text-xs text-[#4B5563]">Only a superadmin can start, go live or stop.</p>}
            </div>

            {ov.mode === "trial" && <GoLiveChecklist canSwitch={canSwitch} ov={ov} onLive={load} />}

            {ov.mode === "trial" && canSwitch && <ResetFromSheet onDone={load} />}

            {ov.mode !== "off" && (ov.below_zero || []).length > 0 && (
                <div className={`border-2 bg-white p-5 ${ov.below_zero_unexplained ? "border-[#CC0033]" : "border-[#F59E0B]"}`} data-testid="wh-below-zero">
                    <h2 className="font-serif text-2xl text-[#002B5C]">Below zero — {ov.below_zero.length} book{ov.below_zero.length === 1 ? "" : "s"}</h2>
                    <p className="text-sm text-[#4B5563] mt-1">
                        A shelf can't hold fewer than 0 copies. Paid pre-orders and backorders take their copies off the count when they are paid, so a count
                        below zero is expected up to what those orders are owed. Anything beyond that is a counting mistake: count the book and save a correction.
                    </p>
                    <table className="mt-3 w-full text-sm">
                        <thead><tr className="text-left text-[#4B5563] align-bottom"><th className="py-2 pr-4">Book</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2">Warehouse</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2">Owed to orders</th><th className="px-3 text-right whitespace-nowrap tabular-nums py-2">Website</th><th className="pl-4 py-2">What to do</th></tr></thead>
                        <tbody>
                            {ov.below_zero.map((b) => (
                                <tr key={b.id} className="border-t border-[#E5E7EB] align-top">
                                    <td className="py-1 pr-2">{b.title}<div className="font-mono text-xs text-[#4B5563]">{b.isbn}</div></td>
                                    <td className="px-3 text-right whitespace-nowrap tabular-nums font-mono text-[#CC0033]">{b.wh_stock}</td>
                                    <td className="px-3 text-right whitespace-nowrap tabular-nums font-mono">{b.owed || "—"}</td>
                                    <td className="px-3 text-right whitespace-nowrap tabular-nums font-mono">{b.stock}</td>
                                    <td className={`pl-4 ${b.unexplained ? "text-[#CC0033]" : "text-[#4B5563]"}`}>{b.note}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {ov.mode !== "off" && (
                <div className="border border-[#E5E7EB] bg-white p-5" data-testid="wh-compare">
                    <div className="flex items-center justify-between">
                        <h2 className="font-serif text-2xl text-[#002B5C]">Warehouse vs website</h2>
                        <button type="button" onClick={load} className="text-sm underline">Refresh</button>
                    </div>
                    <p className="text-sm text-[#4B5563] mt-1">
                        {ov.difference_count === 0
                            ? `All ${ov.books} books agree.`
                            : `${ov.difference_count} of ${ov.books} books differ. During the trial the website number comes from the sheet; differences show where the two records disagree.`}
                    </p>
                    {ov.differences.length > 0 && (
                        <table className="mt-3 w-full text-sm">
                            <thead><tr className="text-left text-[#4B5563]"><th className="py-1">Book</th><th>ISBN</th><th className="text-right">Warehouse</th><th className="text-right">Website</th><th className="text-right">Diff</th></tr></thead>
                            <tbody>
                                {ov.differences.map((d) => (
                                    <tr key={d.id} className="border-t border-[#E5E7EB]">
                                        <td className="py-1 pr-2">{d.title}{d.coming_soon ? " (pre-order)" : ""}</td>
                                        <td className="font-mono text-xs">{d.isbn}</td>
                                        <td className="text-right">{d.wh_stock}</td>
                                        <td className="text-right">{d.stock}</td>
                                        <td className={`text-right font-mono ${d.diff > 0 ? "text-[#15803D]" : "text-[#CC0033]"}`}>{d.diff > 0 ? `+${d.diff}` : d.diff}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}

const STATUS_LABEL = {
    awaiting_approval: "WAITING FOR APPROVAL", sent_back: "SENT BACK", cancelled: "CANCELLED",
};

const NO_FILTER = { q: "", direction: "", status: "", practice: "", date_from: "", date_to: "", archived: false };
const DIRECTIONS = [["out", "Carton out (Tally invoice)"], ["in", "Printer bill (books arriving)"], ["courier", "Courier sheet"]];

function DocsTab({ status = null, onChange = () => {}, canDelete = false }) {
    const [docs, setDocs] = useState(null);
    const [open, setOpen] = useState(null);
    const [busy, setBusy] = useState(false);
    const [f, setF] = useState(NO_FILTER);
    const [q, setQ] = useState(NO_FILTER);   // f, applied after typing pauses
    const [creating, setCreating] = useState(false);
    useEffect(() => { const t = setTimeout(() => setQ(f), 300); return () => clearTimeout(t); }, [f]);
    const load = useCallback(() => {
        adminWhDocs(status || q).then(setDocs).catch(() => setDocs([]));
    }, [status, q]);
    useEffect(load, [load]);
    const remove = async (d) => {
        const msg = d.practice || d.status === "draft"
            ? "Delete this document for good? It never changed stock."
            : "Delete this document?\n\nIts stock changes are reversed and it is ARCHIVED, not erased — the stock history keeps it. A superadmin can bring it back into the list (its stock stays reversed).";
        if (!window.confirm(msg)) return;
        setBusy(true);
        try {
            const r = await adminWhDeleteDoc(d.id);
            toast.success(r.deleted ? "Deleted." : `Archived. ${r.reversed} stock movement(s) reversed.`);
            setOpen(null); load(); onChange();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const restore = async (id) => {
        try { await adminWhRestoreDoc(id); toast.success("Back in the list (stock stays reversed)."); setOpen(null); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const show = async (id) => { try { setOpen(await adminWhDoc(id)); } catch (e) { toast.error(formatApiError(e)); } };
    const undo = async (id) => {
        if (!window.confirm("Undo this sync? Its stock changes are reversed.")) return;
        try { await adminWhUndoDoc(id); toast.success("Undone."); load(); show(id); } catch (e) { toast.error(formatApiError(e)); }
    };
    const review = async (id, action) => {
        let note = "";
        if (action === "send_back") {
            note = window.prompt("What should the warehouse fix? (He sees this on his phone.)") || "";
            if (!note.trim()) return;
        } else if (action === "cancel") {
            note = window.prompt("Why is this carton cancelled? The copies go back into stock.") || "";
            if (!note.trim()) return;
        } else if (!window.confirm("Approve this carton? The warehouse is told it is ready to ship.")) {
            return;
        }
        setBusy(true);
        try {
            const r = await adminWhReview(id, action, note);
            toast.success(action === "approve" ? "Approved — the warehouse has been told."
                : `${action === "cancel" ? "Cancelled" : "Sent back"}. ${r.restored} cop${r.restored === 1 ? "y" : "ies"} back in stock.`);
            load(); onChange();
            if (status) setOpen(null); else show(id);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };
    const test = async (id, on) => { try { await adminWhTestCase(id, on); load(); show(id); } catch (e) { toast.error(formatApiError(e)); } };
    const file = async (id) => {
        try { window.open(URL.createObjectURL(await whDocFile(id, true)), "_blank", "noopener"); } catch { toast.error("Could not open the file."); }
    };
    if (!docs) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    if (status && !docs.length) return <p className="text-sm text-[#4B5563]" data-testid="wh-approve-empty">Nothing waiting — every packed carton has been reviewed.</p>;
    const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
    const inp = "border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm";
    return (
        <div className="space-y-4">
        {!status && (
            <div className="flex flex-wrap items-end gap-2" data-testid="wh-doc-search">
                <input value={f.q} onChange={set("q")} placeholder="Search number, party, author, person, title…" className={`${inp} flex-1 min-w-[220px]`} />
                <select value={f.direction} onChange={set("direction")} className={inp}>
                    <option value="">All types</option>
                    {DIRECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select value={f.status} onChange={set("status")} className={inp}>
                    <option value="">Any status</option>
                    {["draft", "awaiting_approval", "confirmed", "sent_back", "cancelled", "undone"].map((v) => <option key={v} value={v}>{STATUS_LABEL[v] || v.toUpperCase()}</option>)}
                </select>
                <select value={f.practice} onChange={set("practice")} className={inp}>
                    <option value="">Real + practice</option><option value="real">Real only</option><option value="practice">Practice only</option>
                </select>
                <input type="date" value={f.date_from} onChange={set("date_from")} className={inp} aria-label="From" />
                <input type="date" value={f.date_to} onChange={set("date_to")} className={inp} aria-label="To" />
                <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={f.archived} onChange={set("archived")} /> Archived</label>
                {JSON.stringify(f) !== JSON.stringify(NO_FILTER) && <button type="button" className="text-sm underline" onClick={() => setF(NO_FILTER)}>Clear</button>}
                <button type="button" className="bg-[#002B5C] text-white px-3 py-1.5 text-sm" onClick={() => setCreating((c) => !c)} data-testid="wh-new-doc">+ New document</button>
            </div>
        )}
        {creating && <NewDocForm onDone={(d) => { setCreating(false); load(); if (d) show(d.id); }} />}
        <div className="grid lg:grid-cols-2 gap-6">
            <ul className="divide-y border border-[#E5E7EB] bg-white" data-testid="wh-docs">
                {docs.map((d) => (
                    <li key={d.id}>
                        <button type="button" onClick={() => show(d.id)} className={`w-full text-left px-4 py-3 hover:bg-[#F5F7FA] ${open?.id === d.id ? "bg-[#F5F7FA]" : ""}`}>
                            <div className="flex justify-between gap-2 text-sm">
                                <span className="font-medium text-[#002B5C]">{d.direction === "in" ? "📥 Printer bill" : d.direction === "courier" ? "🚚 Courier sheet" : d.party_kind === "author_copy" ? "📤 Author copy" : "📤 Carton out"} · {d.doc_number || "no number"}</span>
                                <span className={`text-xs ${d.status === "awaiting_approval" ? "text-[#B4750F] font-medium" : ""}`}>{d.practice ? "PRACTICE · " : ""}{STATUS_LABEL[d.status] || d.status.toUpperCase()}{d.shipped_at ? " · SHIPPED" : ""}</span>
                            </div>
                            <div className="text-xs text-[#4B5563] mt-0.5">
                                {d.party_name || "—"} · {when(d.created_at)} · {d.source}
                                {d.metrics ? ` · read ${pct(d.metrics.accuracy)} right` : ""}{d.test_case ? " · TEST CASE" : ""}
                            </div>
                        </button>
                    </li>
                ))}
                {!docs.length && <li className="px-4 py-6 text-sm text-[#4B5563]">Nothing yet.</li>}
            </ul>
            {open && (
                <div className="border border-[#E5E7EB] bg-white p-5 space-y-3 text-sm" data-testid="wh-doc-detail">
                    <div className="font-serif text-xl text-[#002B5C]">{open.doc_number || "No number"} · {open.party_name || "—"}</div>
                    <div className="text-xs text-[#4B5563]">
                        {open.direction === "in" ? "In" : "Out"} · {open.source} · by {open.created_by} · confirmed {when(open.confirmed_at)} by {open.confirmed_by || "—"}
                        {open.seconds_to_confirm != null ? ` · took ${open.seconds_to_confirm}s` : ""}
                        {open.total_matches === false ? " · ⚠️ lines did not add up to the total" : ""}
                    </div>
                    {open.archived && (
                        <div className="border border-[#CC0033] text-[#CC0033] p-2 text-xs">Archived {when(open.archived_at)} by {open.archived_by}{open.status === "undone" ? " — its stock changes were reversed" : ""}.</div>
                    )}
                    {open.party_name_read && (
                        <div className="text-xs text-[#4B5563]" data-testid="wh-party-memory">
                            Party taken from earlier documents with the same GSTIN — the photo read “{open.party_name_read}”.
                        </div>
                    )}
                    {open.read_text && (
                        <details className="text-xs" data-testid="wh-read-text">
                            <summary className="cursor-pointer text-[#4B5563]">What the system read (for fixing misreads; account numbers masked)</summary>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap bg-[#F9FAFB] border border-[#E5E7EB] p-2">{open.read_text}</pre>
                        </details>
                    )}
                    {open.lines_edited_at && (
                        <div className="text-xs text-[#B4750F]">Lines corrected {when(open.lines_edited_at)} by {open.lines_edited_by}: “{open.lines_edit_note}”</div>
                    )}
                    {(open.approved_at || open.review_note) && (
                        <div className="text-xs text-[#4B5563]">
                            {open.approved_at ? `Approved ${when(open.approved_at)} by ${open.approved_by}` : `Reviewed ${when(open.reviewed_at)} by ${open.reviewed_by}`}
                            {open.review_note ? ` · “${open.review_note}”` : ""}
                            {open.shipped_at ? ` · shipped ${when(open.shipped_at)}` : ""}
                        </div>
                    )}
                    {open.status === "awaiting_approval" && (
                        <div className="border border-[#F59E0B] bg-[#F59E0B]/10 p-3 space-y-2" data-testid="wh-review">
                            <div className="font-medium text-[#002B5C]">Packed by {open.confirmed_by} — check it against the invoice before it ships</div>
                            {(open.lines_view || []).length > 0 && (
                                <table className="w-full text-xs bg-white">
                                    <thead><tr className="text-left text-[#4B5563]"><th className="py-1 px-2">Book</th><th className="text-right">On invoice</th><th className="text-right px-2">Packed</th></tr></thead>
                                    <tbody>
                                        {open.lines_view.map((l, i) => {
                                            const short = l.invoiced != null && l.packed !== Number(l.invoiced);
                                            return (
                                                <tr key={i} className={`border-t ${short ? "bg-[#CC0033]/10" : ""}`}>
                                                    <td className="py-1 px-2">{l.title} <span className="font-mono text-[#4B5563]">{l.isbn}</span></td>
                                                    <td className="text-right">{l.invoiced ?? "—"}</td>
                                                    <td className={`text-right px-2 ${short ? "text-[#CC0033] font-medium" : ""}`}>{l.packed}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                            {open.approval_refusal ? (
                                <p className="text-xs text-[#CC0033]">{open.approval_refusal}</p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" disabled={busy} className="bg-[#15803D] text-white px-4 py-2 disabled:opacity-50" onClick={() => review(open.id, "approve")} data-testid="wh-approve">Approve — ready to ship</button>
                                    <button type="button" disabled={busy} className="border border-[#B4750F] text-[#B4750F] px-4 py-2 disabled:opacity-50" onClick={() => review(open.id, "send_back")} data-testid="wh-send-back">Send back</button>
                                    <button type="button" disabled={busy} className="border border-[#CC0033] text-[#CC0033] px-4 py-2 disabled:opacity-50" onClick={() => review(open.id, "cancel")} data-testid="wh-cancel">Cancel carton</button>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {open.file_path && <button type="button" className="border px-3 py-1" onClick={() => file(open.id)}>View file</button>}
                        {open.status === "confirmed" && !open.practice && !open.shipped_at && <button type="button" className="border border-[#CC0033] text-[#CC0033] px-3 py-1" onClick={() => undo(open.id)}>Undo</button>}
                        {open.status === "confirmed" && (
                            <button type="button" className="border px-3 py-1" onClick={() => test(open.id, !open.test_case)}>
                                {open.test_case ? "Remove from test cases" : "Use as test case"}
                            </button>
                        )}
                    </div>
                    <table className="w-full text-xs">
                        <thead><tr className="text-left text-[#4B5563]"><th className="py-1">#</th><th>Read from document</th><th className="text-right">Read qty</th><th className="text-right">Confirmed</th></tr></thead>
                        <tbody>
                            {(open.read_lines || []).map((l) => {
                                const c = (open.confirmed_lines || []).find((x) => x.line_no === l.line_no);
                                const changed = c && (c.book_id !== l.book_id || Number(c.qty) !== Number(l.qty) || c.include !== l.include);
                                return (
                                    <tr key={l.line_no} className={`border-t ${changed ? "bg-[#F59E0B]/10" : ""}`}>
                                        <td className="py-1">{l.line_no}</td>
                                        <td>{l.doc_title} {l.doc_isbn ? `· ${l.doc_isbn}` : ""} <span className="text-[#4B5563]">({l.match})</span></td>
                                        <td className="text-right">{l.include ? l.qty : "skip"}</td>
                                        <td className="text-right">{c ? (c.include ? c.qty : "skip") : "—"}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {open.direction === "courier" && (open.confirmed_parcels || open.parcels || []).length > 0 && (
                        <div>
                            <div className="font-medium">Parcels</div>
                            <ul className="list-disc pl-5">
                                {(open.confirmed_parcels || open.parcels).map((p) => {
                                    const read = (open.parcels || []).find((x) => x.no === p.no) || {};
                                    return (
                                        <li key={p.no}>
                                            {p.no}. {read.name || "—"}{read.org ? `, ${read.org}` : ""} — {p.kind === "website_order" ? `website order ${read.order_number || ""} (not deducted)`
                                                : ({ dealer_order: "phone / dealer order (deducted as a sale)", author_copy: "author copy (deducted)", free_copy: "free copy (deducted)" }[p.kind] || "not sent")}
                                            {read.kind && read.kind !== p.kind ? " · changed by hand" : ""}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                    {(open.reports || []).length > 0 && (
                        <div><div className="font-medium">Reported problems</div>
                            <ul className="list-disc pl-5">{open.reports.map((r, i) => <li key={i}>{r.note} — {r.by}, {when(r.at)}</li>)}</ul></div>
                    )}
                    <div className="text-xs text-[#4B5563]">{(open.movements || []).length} stock movement(s) recorded.</div>
                    {!open.archived && !status && <EditDetails doc={open} onSaved={(d) => { setOpen({ ...open, ...d }); load(); }} />}
                    {!open.archived && !status && !open.practice && ["in", "out"].includes(open.direction) && ["confirmed", "awaiting_approval"].includes(open.status) && (
                        <EditLines doc={open} onSaved={() => { load(); show(open.id); }} />
                    )}
                    {canDelete && !status && (
                        <div className="pt-2 border-t border-[#E5E7EB] flex flex-wrap gap-2">
                            {open.archived
                                ? <button type="button" className="border px-3 py-1" onClick={() => restore(open.id)} data-testid="wh-restore">Restore to the list</button>
                                : <button type="button" disabled={busy || !!open.shipped_at} className="border border-[#CC0033] text-[#CC0033] px-3 py-1 disabled:opacity-50" onClick={() => remove(open)} data-testid="wh-delete"
                                    title={open.shipped_at ? "Shipped — record a return instead" : ""}>Delete</button>}
                        </div>
                    )}
                </div>
            )}
        </div>
        </div>
    );
}

/* Office uploads a document; it waits on the warehouse phone as a job. */
function NewDocForm({ onDone }) {
    const [direction, setDirection] = useState("out");
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const go = async () => {
        setBusy(true);
        try {
            const d = await adminWhCreateDoc(direction, file);
            if (d.error) toast.warning(d.error);
            if (d.duplicate_of) toast.warning("This document was already done once — the warehouse will be stopped from adding it twice.");
            toast.success("Sent to the warehouse phone — it waits there until he does it.");
            onDone(d);
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    return (
        <div className="border border-[#E5E7EB] bg-white p-4 flex flex-wrap items-end gap-3 text-sm" data-testid="wh-new-doc-form">
            <label className="flex flex-col gap-1">Type
                <select value={direction} onChange={(e) => setDirection(e.target.value)} className="border border-[#E5E7EB] px-2 py-1.5">
                    {DIRECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
            </label>
            <label className="flex flex-col gap-1">PDF or photo (leave empty to type it on the phone)
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <button type="button" disabled={busy} className="bg-[#002B5C] text-white px-4 py-2 disabled:opacity-50" onClick={go}>
                {busy ? "Reading…" : "Send to warehouse"}
            </button>
            <button type="button" className="underline" onClick={() => onDone(null)}>Cancel</button>
        </div>
    );
}

/* Details only — never stock. */
function EditDetails({ doc, onSaved }) {
    const [editing, setEditing] = useState(false);
    const [v, setV] = useState({});
    const startEdit = () => {
        setV({ doc_number: doc.doc_number || "", party_name: doc.party_name || "", party_kind: doc.party_kind || "sale_offline", note: doc.office_note || "" });
        setEditing(true);
    };
    const save = async () => {
        const body = { doc_number: v.doc_number, party_name: v.party_name, note: v.note };
        if (doc.direction === "out") body.party_kind = v.party_kind;
        try { const d = await adminWhEditDoc(doc.id, body); toast.success("Saved. Stock not changed."); setEditing(false); onSaved(d); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!editing) {
        return (
            <div className="text-xs text-[#4B5563] flex flex-wrap gap-2 items-center">
                {doc.office_note ? <span>Note: {doc.office_note}</span> : null}
                {doc.edited_at ? <span>· edited {when(doc.edited_at)} by {doc.edited_by}</span> : null}
                <button type="button" className="border px-3 py-1 text-[#002B5C]" onClick={startEdit} data-testid="wh-edit-details">Edit details</button>
            </div>
        );
    }
    const box = "border border-[#E5E7EB] px-2 py-1.5 w-full";
    return (
        <div className="border border-[#E5E7EB] p-3 space-y-2" data-testid="wh-edit-details-form">
            <div className="grid sm:grid-cols-2 gap-2">
                <label>Number<input className={box} value={v.doc_number} onChange={(e) => setV({ ...v, doc_number: e.target.value })} /></label>
                <label>{doc.direction === "in" ? "Printer" : "Sent to"}<input className={box} value={v.party_name} onChange={(e) => setV({ ...v, party_name: e.target.value })} /></label>
                {doc.direction === "out" && (
                    <label>Type<select className={box} value={v.party_kind} onChange={(e) => setV({ ...v, party_kind: e.target.value })}>
                        <option value="sale_offline">Sale / shop</option><option value="author_copy">Author copy</option>
                        <option value="amazon_fba">Sent to Amazon FBA</option><option value="amazon_vendor_po">Amazon Vendor PO</option>
                    </select></label>
                )}
                <label className="sm:col-span-2">Office note<input className={box} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
            </div>
            <div className="flex gap-2"><button type="button" className="bg-[#002B5C] text-white px-3 py-1" onClick={save}>Save</button>
                <button type="button" className="underline" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
    );
}

/* Correct books / quantities after sync: posted as correction movements. */
function EditLines({ doc, onSaved }) {
    const [rows, setRows] = useState(null);
    const [books, setBooks] = useState([]);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const startEdit = async () => {
        try { setBooks(await whBooks()); } catch { /* list stays empty; picker shows ids */ }
        setRows((doc.confirmed_lines || []).filter((l) => l.include && l.book_id).map((l) => ({ book_id: l.book_id, qty: l.qty })));
    };
    const save = async () => {
        if (!note.trim()) return toast.error("Write why the lines are being corrected.");
        setBusy(true);
        try {
            const r = await adminWhEditLines(doc.id, rows.filter((x) => x.book_id).map((x) => ({ book_id: x.book_id, qty: Number(x.qty) || 0 })), note);
            const n = Object.keys(r.changes || {}).length;
            toast.success(n ? `Corrected — ${n} book(s) adjusted in stock.` : "No stock change needed.");
            setRows(null); setNote(""); onSaved();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    if (!rows) {
        return <button type="button" className="border px-3 py-1 text-xs text-[#002B5C]" onClick={startEdit} data-testid="wh-edit-lines">Correct books / quantities</button>;
    }
    const setRow = (i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    return (
        <div className="border border-[#F59E0B] bg-[#F59E0B]/5 p-3 space-y-2" data-testid="wh-edit-lines-form">
            <div className="text-xs text-[#4B5563]">Stock already moved for this document. Saving posts the <b>difference</b> as a correction (e.g. +2 / −2) with your name and reason; the original stays in the history.</div>
            {rows.map((r, i) => (
                <div key={i} className="flex gap-2 items-center">
                    <select className="border border-[#E5E7EB] px-2 py-1 flex-1 min-w-0" value={r.book_id} onChange={(e) => setRow(i, { book_id: e.target.value })}>
                        <option value="">— pick a book —</option>
                        {!books.some((b) => b.id === r.book_id) && r.book_id && <option value={r.book_id}>{r.book_id}</option>}
                        {books.map((b) => <option key={b.id} value={b.id}>{b.title}{b.isbn ? ` · ${b.isbn}` : ""}</option>)}
                    </select>
                    <input type="number" min="0" className="border border-[#E5E7EB] px-2 py-1 w-20" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
                    <button type="button" className="text-[#CC0033] px-2" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>✕</button>
                </div>
            ))}
            <button type="button" className="text-xs underline" onClick={() => setRows((rs) => [...rs, { book_id: "", qty: 1 }])}>+ Add a book</button>
            <input className="border border-[#E5E7EB] px-2 py-1 w-full" placeholder="Why? (required — e.g. printer short-shipped 2 copies)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2">
                <button type="button" disabled={busy} className="bg-[#B4750F] text-white px-3 py-1 disabled:opacity-50" onClick={save}>Save correction</button>
                <button type="button" className="underline" onClick={() => setRows(null)}>Cancel</button>
            </div>
        </div>
    );
}

function AccuracyTab() {
    const [a, setA] = useState(null);
    const [replay, setReplay] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { adminWhAccuracy(30).then(setA).catch(() => setA({ groups: {} })); }, []);
    const runReplay = async () => {
        setBusy(true);
        try { setReplay(await adminWhReplay()); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    if (!a) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    const label = (k) => k === "all" ? "All documents" : k.startsWith("party:") ? k.slice(6) :
        { "in:textract_photo": "Printer bills (photo)", "in:textract_pdf": "Printer bills (PDF)", "in:pdf_text": "Printer bills (text PDF)",
          "out:pdf_text": "Tally invoices (PDF)",
          "courier:pdf_text": "Courier sheets (PDF)", "courier:textract_photo": "Courier sheets (photo)", "courier:textract_pdf": "Courier sheets (scanned PDF)", "out:textract_photo": "Invoices (photo)", "out:textract_pdf": "Invoices (scanned PDF)" }[k] || k;
    const rows = Object.entries(a.groups || {});
    return (
        <div className="space-y-6" data-testid="wh-accuracy">
            <p className="text-sm text-[#4B5563]">
                Last {a.days} days. “Right” = a line the person did not have to change. Typed-by-hand documents: {a.manual_docs}.
            </p>
            <table className="w-full text-sm bg-white border border-[#E5E7EB]">
                <thead><tr className="text-left text-[#4B5563]"><th className="p-2">Group</th><th className="text-right">Docs</th><th className="text-right">Lines</th><th className="text-right">Right</th><th className="text-right">Wrong book</th><th className="text-right">Wrong qty</th><th className="text-right">Missed</th><th className="text-right">Extra</th><th className="text-right p-2">Avg time</th></tr></thead>
                <tbody>
                    {rows.map(([k, g]) => (
                        <tr key={k} className="border-t">
                            <td className="p-2">{label(k)}</td><td className="text-right">{g.docs}</td><td className="text-right">{g.lines}</td>
                            <td className="text-right font-medium">{pct(g.accuracy)}</td><td className="text-right">{g.wrong_book}</td>
                            <td className="text-right">{g.wrong_qty}</td><td className="text-right">{g.missed}</td><td className="text-right">{g.extra}</td>
                            <td className="text-right p-2">{g.avg_seconds != null ? `${g.avg_seconds}s` : "—"}</td>
                        </tr>
                    ))}
                    {!rows.length && <tr><td className="p-3 text-[#4B5563]" colSpan={9}>No automatically read documents yet.</td></tr>}
                </tbody>
            </table>
            <div className="border border-[#E5E7EB] bg-white p-4">
                <div className="flex items-center justify-between">
                    <div><div className="font-medium text-[#002B5C]">Test cases</div>
                        <div className="text-xs text-[#4B5563]">Re-read every document marked “test case” with today's reader and compare with what was confirmed. Photos cost about ₹1.30 each to re-read.</div></div>
                    <button type="button" disabled={busy} onClick={runReplay} className="border px-3 py-2 text-sm">{busy ? "Running…" : "Run test cases"}</button>
                </div>
                {replay && (
                    <ul className="mt-3 text-sm">
                        {replay.cases.map((c) => (
                            <li key={c.id}>{c.doc_number || c.id}: {c.error ? `error — ${c.error}` : `${pct(c.accuracy)} now (was ${pct(c.was)})`}</li>
                        ))}
                        {!replay.cases.length && <li className="text-[#4B5563]">No test cases yet — mark some in Bills &amp; invoices.</li>}
                    </ul>
                )}
            </div>
        </div>
    );
}

function MovesTab({ q = "" }) {
    const [moves, setMoves] = useState(null);
    const [term, setTerm] = useState(q);   // q, applied once typing pauses
    useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
    const load = useCallback(() => {
        adminWhMovements(null, term).then(setMoves).catch(() => setMoves([]));
    }, [term]);
    useEffect(load, [load]);
    const undo = async (id) => {
        if (!window.confirm("Undo this movement?")) return;
        try { await adminWhUndoMove(id); toast.success("Undone."); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!moves) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    return (
        <table className="w-full text-sm bg-white border border-[#E5E7EB]" data-testid="wh-moves">
            <thead><tr className="text-left text-[#4B5563]"><th className="p-2">When</th><th>Book</th><th>Category</th><th>Reason</th><th>Who / party</th><th className="text-right">Qty</th><th className="p-2"></th></tr></thead>
            <tbody>
                {moves.map((m) => (
                    <tr key={m.id} className={`border-t ${m.undone ? "opacity-50 line-through" : ""}`}>
                        <td className="p-2 text-xs">{when(m.at)}</td><td>{m.title}{m.isbn ? <span className="block text-[11px] font-mono text-[#4B5563]">{m.isbn}</span> : null}</td>
                        <td className="text-xs text-[#4B5563]">{m.category || "—"}</td><td>{m.reason}</td>
                        <td className="text-xs">{m.by}{m.party ? ` → ${m.party}` : ""}</td>
                        <td className={`text-right font-mono ${m.qty > 0 ? "text-[#15803D]" : "text-[#CC0033]"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                        <td className="p-2 text-right">
                            {!m.undone && !m.doc_id && !["website_order", "opening"].includes(m.reason) && (
                                <button type="button" className="text-xs underline" onClick={() => undo(m.id)}>Undo</button>
                            )}
                        </td>
                    </tr>
                ))}
                {!moves.length && <tr><td className="p-3 text-[#4B5563]" colSpan={7}>{term ? `Nothing matches “${term}”.` : "No movements yet."}</td></tr>}
            </tbody>
        </table>
    );
}

/**
 * Pre-launch checklist for Go live (warehouse.py go_live_checks). "Must"
 * items block the button (and the server refuses too). "Should" items can be
 * passed by a superadmin with a written reason, which is logged.
 */
function GoLiveChecklist({ canSwitch, ov, onLive }) {
    const [c, setC] = useState(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => { adminWhGoLiveCheck().then(setC).catch((e) => toast.error(formatApiError(e))); }, []);
    useEffect(load, [load]);
    if (!c) return <p className="text-sm text-[#4B5563]">Checking readiness…</p>;
    const must = c.checks.filter((x) => x.level === "must");
    const should = c.checks.filter((x) => x.level === "should");
    const needReason = c.ready && c.should_open.length > 0;
    const canGo = canSwitch && c.ready && (!needReason || reason.trim().length >= 10);
    const go = async () => {
        if (!window.confirm(`Go live?\n\n• Website stock is replaced by the warehouse counts.\n• Copies owed to paid pre-orders/backorders go to those orders first.\n• Hampers and packs keep their own website stock.\n• The Google-sheet sync stops.\n• From now on stock changes only through the warehouse screens and website orders.`)) return;
        setBusy(true);
        try {
            await adminWhMode("live", needReason ? reason.trim() : undefined);
            toast.success("The warehouse is live.");
            onLive();
        } catch (e) {
            const d = e?.response?.data?.detail;
            toast.error(d?.msg || formatApiError(e));
            load();
        } finally { setBusy(false); }
    };
    const Row = ({ x }) => (
        <li className="flex items-start gap-3 py-2 border-t border-[#E5E7EB] first:border-t-0" data-testid={`golive-${x.key}`}>
            <span className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${x.ok ? "bg-[#DCFCE7] text-[#15803D]" : x.level === "must" ? "bg-[#FEE2E2] text-[#CC0033]" : "bg-[#FEF3C7] text-[#B45309]"}`}>{x.ok ? "✓" : "!"}</span>
            <div className="flex-1 min-w-0">
                <div className="text-sm text-[#002B5C]">{x.label}</div>
                <div className="text-xs text-[#4B5563]">{x.detail}</div>
                {!x.ok && <div className="text-xs text-[#6B7280] mt-0.5">How to fix: {x.fix}</div>}
            </div>
        </li>
    );
    return (
        <div className={`border-2 bg-white p-5 ${c.ready ? (c.should_open.length ? "border-[#F59E0B]" : "border-[#15803D]") : "border-[#CC0033]"}`} data-testid="wh-golive-checklist">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-serif text-2xl text-[#002B5C]">Go-live checklist</h2>
                <span className={`text-xs px-2 py-0.5 ${c.ready ? (c.should_open.length ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#DCFCE7] text-[#15803D]") : "bg-[#FEE2E2] text-[#CC0033]"}`}>
                    {!c.ready ? "Not ready" : c.should_open.length ? `Ready — ${c.should_open.length} recommendation(s) open` : "Ready"}
                </span>
                <button type="button" className="ml-auto text-xs underline" onClick={load}>Check again</button>
            </div>
            <p className="text-xs text-[#4B5563] mt-1">Going live makes the warehouse the source of website stock. “Must” items block it; “Should” items are about the team's habits.</p>
            <div className="grid lg:grid-cols-2 gap-6 mt-4">
                <div><div className="text-xs font-semibold uppercase tracking-wider text-[#CC0033] mb-1">Must</div><ul>{must.map((x) => <Row key={x.key} x={x} />)}</ul></div>
                <div><div className="text-xs font-semibold uppercase tracking-wider text-[#B45309] mb-1">Should</div><ul>{should.map((x) => <Row key={x.key} x={x} />)}</ul></div>
            </div>
            {canSwitch ? (
                <div className="mt-4 pt-4 border-t border-[#E5E7EB] space-y-2">
                    {needReason && (
                        <label className="block text-sm">
                            <span className="text-[#002B5C]">Why go live with recommendations open? <span className="text-xs text-[#6B7280]">(saved in the audit log)</span></span>
                            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm"
                                placeholder="e.g. Counts verified by a full shelf count on 30 Oct; printer bookings start today." />
                        </label>
                    )}
                    <button type="button" disabled={!canGo || busy} onClick={go} data-testid="wh-go-live"
                        className="bg-[#15803D] text-white px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                        {busy ? "Going live…" : "Go live"}
                    </button>
                    {!c.ready && <span className="ml-3 text-xs text-[#CC0033]">Fix the “must” items first.</span>}
                </div>
            ) : <p className="mt-3 text-xs text-[#4B5563]">Only a superadmin can go live.</p>}
            <p className="text-[11px] text-[#9CA3AF] mt-2">Checked {when(c.checked_at)} · {ov.books} books tracked</p>
        </div>
    );
}
