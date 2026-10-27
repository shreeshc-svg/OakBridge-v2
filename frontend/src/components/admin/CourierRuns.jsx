import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
    crList, crCreate, crGet, crSave, crOrders, crPaste, crSend, crRecall, crDiscard, crSettings, crSaveSettings,
    crLabels, saveBlob, whBooks, formatApiError,
} from "../../lib/api";

/**
 * Admin → Warehouse → Courier labels (Oct 2026).
 *
 * Replaces the Word label sheet. The order-management team builds the day's
 * courier run here — website orders drop in already addressed and filled
 * with their books; dealer orders, author copies and free copies are a short
 * form — prints the labels (PDF or Word, three to an A4 page, cut along the
 * dashed box), and sends the run to the warehouse phone, where every parcel
 * arrives filled in. Nothing is photographed or read back, so nothing can be
 * misread. Backend: backend/courier_runs.py, backend/courier_labels.py.
 */
const KINDS = [
    ["website_order", "Website order"],
    ["dealer_order", "Phone / dealer order"],
    ["author_copy", "Author copy"],
    ["free_copy", "Free copy"],
];
const STATUS = {
    draft: ["Draft", "bg-[#F3F4F6] text-[#4B5563]"],
    sent: ["With the warehouse", "bg-[#FEF3C7] text-[#92400E]"],
    packed: ["Packed", "bg-[#DCFCE7] text-[#15803D]"],
};
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const fold = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const blank = (kind) => ({ kind, order_id: "", order_number: "", name: "", org: "", address: "", pincode: "", phone: "", lines: [], note: "" });

export default function CourierRuns() {
    const [runs, setRuns] = useState(null);
    const [openId, setOpenId] = useState(null);
    const load = useCallback(() => crList().then((d) => setRuns(d.runs)).catch((e) => toast.error(formatApiError(e))), []);
    useEffect(() => { load(); }, [load]);

    if (openId) return <RunEditor id={openId} onClose={() => { setOpenId(null); load(); }} />;

    const create = async () => {
        try {
            const r = await crCreate("");
            setOpenId(r.id);
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };
    return (
        <div className="space-y-4" data-testid="courier-runs">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[#4B5563] max-w-2xl">
                    Make the day's courier label sheet here instead of in Word. Website orders come in already addressed; print the labels
                    (PDF or Word), then send the run to the warehouse phone — every parcel arrives filled in, nothing to photograph.
                </p>
                <button type="button" onClick={create} className="bg-[#002B5C] text-white px-4 py-2 text-sm" data-testid="cr-new">+ New courier run</button>
            </div>
            {runs === null ? <p className="text-sm text-[#6B7280]">Loading…</p> : !runs.length ? (
                <p className="text-sm text-[#6B7280]">No courier runs yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="text-left text-[#4B5563]"><th className="py-2 pr-4">Run</th><th className="pr-4">Status</th>
                            <th className="px-3 text-right whitespace-nowrap">Parcels</th><th className="px-3 text-right whitespace-nowrap">Copies</th><th className="px-3">Made</th><th /></tr></thead>
                        <tbody>
                            {runs.map((r) => (
                                <tr key={r.id} className="border-t border-[#E5E7EB]">
                                    <td className="py-2 pr-4 font-medium text-[#002B5C]">{r.title}</td>
                                    <td className="pr-4"><span className={`px-2 py-0.5 text-xs ${(STATUS[r.status] || STATUS.draft)[1]}`}>{(STATUS[r.status] || STATUS.draft)[0]}</span></td>
                                    <td className="px-3 text-right tabular-nums">{r.parcels}</td>
                                    <td className="px-3 text-right tabular-nums">{r.copies}</td>
                                    <td className="px-3 text-xs text-[#4B5563] whitespace-nowrap">{when(r.created_at)}<div>{r.created_by}</div></td>
                                    <td className="text-right"><button type="button" className="underline text-[#002B5C]" onClick={() => setOpenId(r.id)}>Open</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <FromBlock />
        </div>
    );
}

/* -------------------------------------------------------------- editor ---- */
function RunEditor({ id, onClose }) {
    const [run, setRun] = useState(null);
    const [title, setTitle] = useState("");
    const [parcels, setParcels] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState("");
    const [books, setBooks] = useState([]);
    const [orders, setOrders] = useState(null);
    const [paste, setPaste] = useState(null);

    const apply = (r) => { setRun(r); setTitle(r.title); setParcels(r.parcels || []); setDirty(false); };
    useEffect(() => { crGet(id).then(apply).catch((e) => toast.error(formatApiError(e))); }, [id]);
    useEffect(() => { whBooks().then(setBooks).catch(() => {}); }, []);
    const editable = run?.status === "draft";

    const change = (fn) => { setParcels(fn); setDirty(true); };
    const setP = (i, patch) => change((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
    const setLine = (pi, li, patch) => change((ps) => ps.map((p, k) => (k !== pi ? p : { ...p, lines: p.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) })));
    const move = (i, d) => change((ps) => { const a = [...ps]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });

    const save = async () => {
        setBusy("save");
        try {
            const r = await crSave(id, { title, parcels });
            apply(r);
            return r;
        } catch (e) {
            toast.error(formatApiError(e));
            return null;
        } finally {
            setBusy("");
        }
    };
    const download = async (fmt) => {
        if (editable && dirty && !(await save())) return;
        setBusy(fmt);
        try {
            saveBlob(await crLabels(id, fmt), `${(title || "courier-labels").replace(/[^A-Za-z0-9._-]+/g, "-")}.${fmt}`);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy("");
        }
    };
    const send = async () => {
        const r = dirty ? await save() : run;
        if (!r) return;
        if (r.problems?.length) return toast.error("Fix the items in red first.");
        if (!window.confirm(`Send ${r.parcels.length} parcel(s) to the warehouse phone?\n\nHe packs them, ticks each one and taps Done. Free/author/dealer copies leave stock then; website orders were taken off when paid.`)) return;
        setBusy("send");
        try {
            apply(await crSend(id));
            toast.success("Sent — it is waiting on the warehouse phone.");
        } catch (e) {
            const d = e?.response?.data?.detail;
            if (d?.code === "run_problems") setRun((x) => ({ ...x, problems: d.problems }));
            toast.error(d?.code === "run_problems" ? "Fix the items in red first." : formatApiError(e));
        } finally {
            setBusy("");
        }
    };
    const recall = async () => {
        if (!window.confirm("Take this run back from the warehouse phone to change it?")) return;
        try { apply(await crRecall(id)); toast.success("Recalled — you can edit it again."); } catch (e) { toast.error(formatApiError(e)); }
    };
    const discard = async () => {
        if (!window.confirm("Throw this draft away?")) return;
        try { await crDiscard(id); onClose(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const loadOrders = async () => {
        try { setOrders((await crOrders(id)).orders); } catch (e) { toast.error(formatApiError(e)); }
    };
    const addOrders = (picked) => {
        const have = new Set(parcels.map((p) => p.order_id).filter(Boolean));
        change((ps) => [...ps, ...picked.filter((o) => !have.has(o.order_id))]);
        setOrders(null);
    };
    const doPaste = async () => {
        if (!paste?.trim()) return;
        setBusy("paste");
        try {
            const r = await crPaste(id, paste);
            if (!r.parcels.length) return toast.error("No labels found in that text.");
            change((ps) => [...ps, ...r.parcels]);
            setPaste(null);
            toast.success(`${r.parcels.length} parcel(s) added from the text — check each one.`);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy("");
        }
    };

    if (!run) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    const st = STATUS[run.status] || STATUS.draft;
    const copies = parcels.reduce((n, p) => n + p.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0), 0);
    return (
        <div className="space-y-4 pb-24" data-testid="cr-editor">
            <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="underline text-sm" onClick={() => (!dirty || window.confirm("Leave without saving?")) && onClose()}>← All runs</button>
                <input value={title} disabled={!editable} onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                    className="font-serif text-2xl text-[#002B5C] border-b border-[#E5E7EB] px-1 flex-1 min-w-[200px]" aria-label="Run name" />
                <span className={`px-2 py-0.5 text-xs ${st[1]}`}>{st[0]}</span>
            </div>
            <div className="text-sm text-[#4B5563]">{parcels.length} parcel(s) · {copies} copies
                {run.sent_at && <> · sent {when(run.sent_at)}</>}{run.packed_at && <> · packed {when(run.packed_at)} by {run.packed_by}</>}</div>

            {editable && run.problems?.length > 0 && !dirty && (
                <div className="border-l-4 border-[#CC0033] bg-white p-3 text-sm text-[#CC0033]" data-testid="cr-problems">
                    <div className="font-medium mb-1">Before sending:</div>
                    <ul className="list-disc ml-5 space-y-0.5">{run.problems.slice(0, 20).map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
            )}

            {editable && (
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={loadOrders} className="border border-[#002B5C] px-3 py-2 text-sm" data-testid="cr-add-orders">+ Website orders</button>
                    {KINDS.slice(1).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => change((ps) => [...ps, blank(k)])} className="border border-[#E5E7EB] px-3 py-2 text-sm">+ {l}</button>
                    ))}
                    <button type="button" onClick={() => setPaste("")} className="border border-[#E5E7EB] px-3 py-2 text-sm">Paste from a Word sheet</button>
                </div>
            )}

            {orders && <OrderPicker orders={orders} already={new Set(parcels.map((p) => p.order_id))} onAdd={addOrders} onClose={() => setOrders(null)} />}
            {paste !== null && (
                <div className="border border-[#E5E7EB] bg-white p-3 space-y-2">
                    <div className="text-sm text-[#002B5C] font-medium">Paste the text of an old Word label sheet</div>
                    <p className="text-xs text-[#4B5563]">Open the Word file, select all, copy, paste here. Books are matched to the catalogue — check the ones marked in red.</p>
                    <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={8} className="w-full border px-2 py-1 font-mono text-xs" />
                    <div className="flex gap-2">
                        <button type="button" disabled={busy === "paste"} onClick={doPaste} className="bg-[#002B5C] text-white px-3 py-1.5 text-sm">{busy === "paste" ? "Reading…" : "Add these parcels"}</button>
                        <button type="button" onClick={() => setPaste(null)} className="text-sm underline">Cancel</button>
                    </div>
                </div>
            )}

            {parcels.map((p, i) => (
                <ParcelCard key={i} p={{ ...p, no: i + 1 }} books={books} editable={editable}
                    onChange={(patch) => setP(i, patch)} onLine={(li, patch) => setLine(i, li, patch)}
                    // Scanning / adding a book already on this label adds a copy
                    // instead of a second line for the same book.
                    onAddBook={(b) => setP(i, {
                        lines: p.lines.some((l) => l.book_id === b.id)
                            ? p.lines.map((l) => (l.book_id === b.id ? { ...l, qty: (Number(l.qty) || 0) + 1 } : l))
                            : [...p.lines, { book_id: b.id, label: b.title, qty: 1 }],
                    })}
                    onRemoveLine={(li) => setP(i, { lines: p.lines.filter((_, j) => j !== li) })}
                    onUp={() => move(i, -1)} onDown={() => move(i, 1)}
                    onRemove={() => window.confirm(`Remove parcel ${i + 1}?`) && change((ps) => ps.filter((_, k) => k !== i))} />
            ))}

            <div className="fixed bottom-0 left-0 right-0 md:left-auto md:right-6 md:bottom-4 bg-white border-t md:border p-3 flex flex-wrap gap-2 justify-end shadow-lg z-20">
                {editable && <button type="button" disabled={!!busy || !dirty} onClick={save} className="border border-[#002B5C] px-4 py-2 text-sm disabled:opacity-40">{busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}</button>}
                <button type="button" disabled={!!busy || !parcels.length} onClick={() => download("pdf")} className="border border-[#E5E7EB] px-4 py-2 text-sm" data-testid="cr-pdf">{busy === "pdf" ? "Making…" : "Labels PDF"}</button>
                <button type="button" disabled={!!busy || !parcels.length} onClick={() => download("docx")} className="border border-[#E5E7EB] px-4 py-2 text-sm" data-testid="cr-docx">{busy === "docx" ? "Making…" : "Labels Word"}</button>
                {editable && <button type="button" disabled={!!busy || !parcels.length} onClick={send} className="bg-[#15803D] text-white px-4 py-2 text-sm" data-testid="cr-send">{busy === "send" ? "Sending…" : "Send to warehouse"}</button>}
                {run.status === "sent" && <button type="button" onClick={recall} className="border border-[#B4750F] text-[#B4750F] px-4 py-2 text-sm">Recall to edit</button>}
                {editable && <button type="button" onClick={discard} className="text-sm underline text-[#CC0033] px-2">Discard</button>}
            </div>
        </div>
    );
}

function OrderPicker({ orders, already, onAdd, onClose }) {
    const fresh = orders.filter((o) => !already.has(o.order_id));
    const [sel, setSel] = useState(() => new Set(fresh.map((o) => o.order_id)));
    const toggle = (oid) => setSel((s) => { const n = new Set(s); n.has(oid) ? n.delete(oid) : n.add(oid); return n; });
    return (
        <div className="border border-[#002B5C] bg-white p-3 space-y-2" data-testid="cr-order-picker">
            <div className="text-sm font-medium text-[#002B5C]">Paid website orders waiting to be sent</div>
            {!fresh.length ? <p className="text-sm text-[#6B7280]">None waiting (or all already in this run / another run).</p> : (
                <ul className="divide-y max-h-80 overflow-y-auto">
                    {fresh.map((o) => (
                        <li key={o.order_id} className="py-2">
                            <label className="flex gap-3 items-start text-sm">
                                <input type="checkbox" className="mt-1 w-4 h-4" checked={sel.has(o.order_id)} onChange={() => toggle(o.order_id)} />
                                <span><b>{o.order_number}</b> · {o.name} · {o.pincode}
                                    <span className="block text-xs text-[#4B5563]">{o.lines.map((l) => `${l.label} ×${l.qty}`).join(", ")}</span></span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex gap-2">
                <button type="button" disabled={!sel.size} onClick={() => onAdd(fresh.filter((o) => sel.has(o.order_id)))} className="bg-[#002B5C] text-white px-3 py-1.5 text-sm">Add {sel.size} order(s)</button>
                <button type="button" onClick={onClose} className="text-sm underline">Cancel</button>
            </div>
        </div>
    );
}

function ParcelCard({ p, books, editable, onChange, onLine, onAddBook, onRemoveLine, onUp, onDown, onRemove }) {
    const byId = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);
    const web = p.kind === "website_order";
    const inp = "w-full border border-[#E5E7EB] px-2 py-1.5 text-sm disabled:bg-[#F9FAFB]";
    return (
        <div className="border border-[#E5E7EB] bg-white p-4" data-testid="cr-parcel">
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="font-mono text-xs text-[#4B5563]">PARCEL {p.no}</span>
                {web ? <span className="text-xs bg-[#E0F2FE] text-[#075985] px-2 py-0.5">Website order {p.order_number}</span> : (
                    <div className="flex flex-wrap gap-1">
                        {KINDS.slice(1).map(([k, l]) => (
                            <button key={k} type="button" disabled={!editable} onClick={() => onChange({ kind: k })}
                                className={`px-2 py-1 text-xs border ${p.kind === k ? "bg-[#002B5C] text-white border-[#002B5C]" : "border-[#E5E7EB]"}`}>{l}</button>
                        ))}
                        {!p.kind && <span className="text-xs text-[#CC0033] self-center">← choose one</span>}
                    </div>
                )}
                {editable && (
                    <div className="ml-auto flex gap-2 text-xs">
                        <button type="button" onClick={onUp} aria-label="Move up">↑</button>
                        <button type="button" onClick={onDown} aria-label="Move down">↓</button>
                        <button type="button" onClick={onRemove} className="text-[#CC0033] underline">Remove</button>
                    </div>
                )}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <div className="text-xs font-medium text-[#4B5563]">Books on the label</div>
                    {p.lines.map((l, li) => {
                        const b = byId[l.book_id];
                        return (
                            <div key={li} className="flex gap-2 items-start">
                                <div className="flex-1 min-w-0">
                                    <input value={l.label} disabled={!editable} onChange={(e) => onLine(li, { label: e.target.value })} className={inp}
                                        aria-label="Name printed on the label" />
                                    <div className={`text-[11px] mt-0.5 ${b ? "text-[#4B5563]" : "text-[#CC0033]"}`}>
                                        {b ? `Catalogue: ${b.title}` : "Not matched to a book — pick it below and remove this line"}
                                    </div>
                                    {!b && (l.candidates || []).length > 0 && editable && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {l.candidates.slice(0, 3).map((c) => (
                                                <button key={c.book_id} type="button" onClick={() => onLine(li, { book_id: c.book_id })}
                                                    className="text-[11px] border border-[#002B5C] px-1.5 py-0.5 text-[#002B5C]">★ {c.title}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <input type="number" min={1} value={l.qty} disabled={!editable} onChange={(e) => onLine(li, { qty: e.target.value === "" ? "" : Number(e.target.value) })}
                                    className={`w-16 border px-2 py-1.5 text-sm ${Number(l.qty) >= 1 ? "border-[#E5E7EB]" : "border-[#CC0033]"}`} aria-label="Copies" />
                                {editable && <button type="button" onClick={() => onRemoveLine(li)} className="text-[#CC0033] text-sm px-1" aria-label="Remove book">×</button>}
                            </div>
                        );
                    })}
                    {editable && <BookSearch books={books} onPick={onAddBook} />}
                    <p className="text-[11px] text-[#6B7280]">The name on the label can be shortened (e.g. “LA/LR, 2nd Ed”) — the book itself is what the warehouse packs.</p>
                </div>
                <div className="space-y-2">
                    <input value={p.name} disabled={!editable} onChange={(e) => onChange({ name: e.target.value })} placeholder="Name (e.g. Mr Rajeev Pandey, Director)" className={`${inp} font-medium`} />
                    <input value={p.org} disabled={!editable} onChange={(e) => onChange({ org: e.target.value })} placeholder="Organisation (optional)" className={inp} />
                    <textarea value={p.address} disabled={!editable} onChange={(e) => onChange({ address: e.target.value })} rows={4}
                        placeholder={"Address, one line per line on the label\n22 no Phatak Road,\nAmritsar-143002\nPunjab"} className={inp} />
                    <div className="flex gap-2">
                        <input value={p.pincode} disabled={!editable} onChange={(e) => onChange({ pincode: e.target.value })} placeholder="PIN" inputMode="numeric" className={`${inp} w-28`} />
                        <input value={p.phone} disabled={!editable} onChange={(e) => onChange({ phone: e.target.value })} placeholder="Mobile" inputMode="tel" className={inp} />
                    </div>
                    <input value={p.note} disabled={!editable} onChange={(e) => onChange({ note: e.target.value })} placeholder="Note for the office (not printed)" className={`${inp} text-xs`} />
                </div>
            </div>
        </div>
    );
}

// ISBN as digits only ("978-93-95764-54-4" -> "9789395764544"); ISBN-10s
// keep their final X.
const isbnKey = (s) => String(s || "").replace(/[^0-9Xx]/g, "").toUpperCase();

function BookSearch({ books, onPick }) {
    const [q, setQ] = useState("");
    const [miss, setMiss] = useState("");
    const hits = useMemo(() => {
        const w = fold(q).split(" ").filter(Boolean);
        const digits = isbnKey(q);
        if (!w.length) return [];
        return books.filter((b) => w.every((x) => fold(`${b.title} ${b.author || ""}`).includes(x))
            || (digits.length >= 4 && isbnKey(b.isbn).includes(digits))).slice(0, 8);
    }, [q, books]);
    const pick = (b) => { onPick(b); setQ(""); setMiss(""); };
    /*
     * Enter adds straight away when it is unambiguous — a full ISBN typed or
     * read by a barcode scanner (scanners type the number and press Enter),
     * or a search with exactly one match. A full ISBN we don't have says so
     * instead of silently doing nothing.
     */
    const onKey = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const key = isbnKey(q);
        if (key.length === 10 || key.length === 13) {
            const exact = books.find((b) => isbnKey(b.isbn) === key);
            if (exact) return pick(exact);
            setMiss(`No book with ISBN ${key} in the catalogue.`);
            return;
        }
        if (hits.length === 1) pick(hits[0]);
    };
    return (
        <div>
            <input value={q} onChange={(e) => { setQ(e.target.value); setMiss(""); }} onKeyDown={onKey} inputMode="search"
                placeholder="+ Add a book: title, author or ISBN (scan or type, then Enter)" data-testid="cr-book-search"
                className="w-full border border-dashed border-[#9CA3AF] px-2 py-1.5 text-sm" />
            {miss && <p className="text-[11px] text-[#CC0033] mt-1">{miss}</p>}
            {hits.length > 0 && (
                <div className="border border-t-0 divide-y max-h-60 overflow-y-auto">
                    {hits.map((b) => (
                        <button key={b.id} type="button" onClick={() => pick(b)} className="block w-full text-left px-2 py-1.5 text-sm hover:bg-[#F3F4F6]">
                            {b.title}<span className="block text-[11px] text-[#6B7280]">{[b.author, b.isbn].filter(Boolean).join(" · ")}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function FromBlock() {
    const [txt, setTxt] = useState(null);
    useEffect(() => { crSettings().then((s) => setTxt(s.from_lines.join("\n"))).catch(() => {}); }, []);
    if (txt === null) return null;
    const save = async () => {
        try {
            const r = await crSaveSettings(txt.split("\n"));
            setTxt(r.from_lines.join("\n"));
            toast.success("Return address saved — used on every label.");
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };
    return (
        <div className="border-t border-[#E5E7EB] pt-4 max-w-xl">
            <div className="text-sm font-medium text-[#002B5C]">“From” on every label</div>
            <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={3} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm" />
            <button type="button" onClick={save} className="mt-1 border border-[#002B5C] px-3 py-1.5 text-sm">Save</button>
        </div>
    );
}

