import React, { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Search, X } from "lucide-react";
import {
    adminWhOverview, adminWhDocs, adminWhDoc, adminWhUndoDoc, adminWhTestCase, adminWhAccuracy,
    adminWhReplay, adminWhMode, adminWhMovements, adminWhUndoMove, adminWhReview, adminWhCreateDoc, adminWhEditDoc,
    adminWhEditLines, adminWhDeleteDoc, adminWhRestoreDoc, whBooks, whDocFile, formatApiError,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin } from "../../lib/rbac";

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
 *   To approve cartons the warehouse has packed, waiting for the
 *              order-management team: Approve (he may ship), Send back
 *              (repack; copies return to stock) or Cancel (copies return).
 *
 * The warehouse role itself never lands here: it is sent to /warehouse.
 */
const TABS = [["approve", "To approve"], ["trial", "Trial & comparison"], ["docs", "Bills & invoices"], ["accuracy", "Accuracy"], ["moves", "Movements"]];
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
                {tab === "moves" && <MovesTab q={moveQ} />}
            </div>
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
                        {ov.mode === "trial" && (
                            <button type="button" className="bg-[#15803D] text-white px-4 py-2 text-sm" data-testid="wh-go-live"
                                onClick={() => setMode("live", `Go live?\n\n• Website stock is replaced by the warehouse counts (${ov.difference_count} books differ today).\n• The Google-sheet sync stops.\n• From now on stock changes only through the warehouse screen and website orders.`)}>
                                Go live
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
                                            {p.no}. {read.name || "—"}{read.org ? `, ${read.org}` : ""} — {p.kind === "website_order" ? `website order ${read.order_number || ""} (not deducted)` : p.kind === "free_copy" ? "free copy (deducted)" : "not sent"}
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
