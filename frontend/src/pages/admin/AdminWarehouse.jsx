import React, { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
    adminWhOverview, adminWhDocs, adminWhDoc, adminWhUndoDoc, adminWhTestCase, adminWhAccuracy,
    adminWhReplay, adminWhMode, adminWhMovements, adminWhUndoMove, whDocFile, formatApiError,
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
 *
 * The warehouse role itself never lands here: it is sent to /warehouse.
 */
const TABS = [["trial", "Trial & comparison"], ["docs", "Bills & invoices"], ["accuracy", "Accuracy"], ["moves", "Movements"]];
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN") : "—");

export default function AdminWarehouse() {
    const { user } = useAuth();
    const [tab, setTab] = useState("trial");
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
            <div className="mt-6 flex gap-2 border-b border-[#E5E7EB]">
                {TABS.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                        className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === k ? "border-[#002B5C] text-[#002B5C] font-medium" : "border-transparent text-[#4B5563]"}`}>
                        {l}
                    </button>
                ))}
            </div>
            <div className="mt-6">
                {tab === "trial" && <TrialTab canSwitch={isSuperadmin(user?.role)} />}
                {tab === "docs" && <DocsTab />}
                {tab === "accuracy" && <AccuracyTab />}
                {tab === "moves" && <MovesTab />}
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

function DocsTab() {
    const [docs, setDocs] = useState(null);
    const [open, setOpen] = useState(null);
    const load = useCallback(() => { adminWhDocs().then(setDocs).catch(() => setDocs([])); }, []);
    useEffect(load, [load]);
    const show = async (id) => { try { setOpen(await adminWhDoc(id)); } catch (e) { toast.error(formatApiError(e)); } };
    const undo = async (id) => {
        if (!window.confirm("Undo this sync? Its stock changes are reversed.")) return;
        try { await adminWhUndoDoc(id); toast.success("Undone."); load(); show(id); } catch (e) { toast.error(formatApiError(e)); }
    };
    const test = async (id, on) => { try { await adminWhTestCase(id, on); load(); show(id); } catch (e) { toast.error(formatApiError(e)); } };
    const file = async (id) => {
        try { window.open(URL.createObjectURL(await whDocFile(id, true)), "_blank", "noopener"); } catch { toast.error("Could not open the file."); }
    };
    if (!docs) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    return (
        <div className="grid lg:grid-cols-2 gap-6">
            <ul className="divide-y border border-[#E5E7EB] bg-white" data-testid="wh-docs">
                {docs.map((d) => (
                    <li key={d.id}>
                        <button type="button" onClick={() => show(d.id)} className={`w-full text-left px-4 py-3 hover:bg-[#F5F7FA] ${open?.id === d.id ? "bg-[#F5F7FA]" : ""}`}>
                            <div className="flex justify-between gap-2 text-sm">
                                <span className="font-medium text-[#002B5C]">{d.direction === "in" ? "📥 Printer bill" : d.party_kind === "author_copy" ? "📤 Author copy" : "📤 Carton out"} · {d.doc_number || "no number"}</span>
                                <span className="text-xs">{d.practice ? "PRACTICE · " : ""}{d.status.toUpperCase()}</span>
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
                    <div className="flex flex-wrap gap-2">
                        {open.file_path && <button type="button" className="border px-3 py-1" onClick={() => file(open.id)}>View file</button>}
                        {open.status === "confirmed" && !open.practice && <button type="button" className="border border-[#CC0033] text-[#CC0033] px-3 py-1" onClick={() => undo(open.id)}>Undo</button>}
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
                    {(open.reports || []).length > 0 && (
                        <div><div className="font-medium">Reported problems</div>
                            <ul className="list-disc pl-5">{open.reports.map((r, i) => <li key={i}>{r.note} — {r.by}, {when(r.at)}</li>)}</ul></div>
                    )}
                    <div className="text-xs text-[#4B5563]">{(open.movements || []).length} stock movement(s) recorded.</div>
                </div>
            )}
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
          "out:pdf_text": "Tally invoices (PDF)", "out:textract_photo": "Invoices (photo)", "out:textract_pdf": "Invoices (scanned PDF)" }[k] || k;
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

function MovesTab() {
    const [moves, setMoves] = useState(null);
    const load = useCallback(() => { adminWhMovements().then(setMoves).catch(() => setMoves([])); }, []);
    useEffect(load, [load]);
    const undo = async (id) => {
        if (!window.confirm("Undo this movement?")) return;
        try { await adminWhUndoMove(id); toast.success("Undone."); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!moves) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    return (
        <table className="w-full text-sm bg-white border border-[#E5E7EB]" data-testid="wh-moves">
            <thead><tr className="text-left text-[#4B5563]"><th className="p-2">When</th><th>Book</th><th>Reason</th><th>Who / party</th><th className="text-right">Qty</th><th className="p-2"></th></tr></thead>
            <tbody>
                {moves.map((m) => (
                    <tr key={m.id} className={`border-t ${m.undone ? "opacity-50 line-through" : ""}`}>
                        <td className="p-2 text-xs">{when(m.at)}</td><td>{m.title}</td><td>{m.reason}</td>
                        <td className="text-xs">{m.by}{m.party ? ` → ${m.party}` : ""}</td>
                        <td className={`text-right font-mono ${m.qty > 0 ? "text-[#15803D]" : "text-[#CC0033]"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                        <td className="p-2 text-right">
                            {!m.undone && !m.doc_id && !["website_order", "opening"].includes(m.reason) && (
                                <button type="button" className="text-xs underline" onClick={() => undo(m.id)}>Undo</button>
                            )}
                        </td>
                    </tr>
                ))}
                {!moves.length && <tr><td className="p-3 text-[#4B5563]" colSpan={6}>No movements yet.</td></tr>}
            </tbody>
        </table>
    );
}
