import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Camera, FileText, PackagePlus, PackageMinus, Search, ScanBarcode, Truck } from "lucide-react";
import {
    whState, whLookup, whBooks, whUploadDoc, whConfirmDoc, whReport, whMove, whDocFile, formatApiError,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import NoIndex from "../../components/NoIndex";

/**
 * The warehouse phone screen (/warehouse).
 *
 * Written for one person, on a phone, who already works through WhatsApp
 * photos and has a barcode scanner. So: one job per screen, big buttons, plain
 * words, and the cursor always waiting in a scan box — a USB or Bluetooth
 * scanner types the ISBN and presses Enter, which is all a scan box needs.
 *
 * Nothing here trusts the automatic reading on its own. Every line can be
 * changed, removed or added by hand before Sync, and "Enter by hand" skips the
 * reading entirely. Practice mode runs the same screens without moving stock.
 */

const BIG = "w-full flex items-center gap-4 border-2 px-5 py-5 text-left text-lg font-medium bg-white active:scale-[0.99] transition";
const BTN = "px-4 py-3 text-base font-medium disabled:opacity-50";

const IN_REASONS = [["return", "Return (good copy)"], ["correction_in", "Correction: add"]];
const OUT_REASONS = [["damaged", "Damaged"], ["sample", "Sample / gift"], ["author_copy", "Author copy"],
    ["sale_offline", "Bulk / shop order"], ["correction_out", "Correction: remove"]];

export default function WarehouseApp() {
    const { user } = useAuth();
    const [state, setState] = useState(null);
    const [screen, setScreen] = useState("home");
    const [practice, setPractice] = useState(false);

    useEffect(() => {
        whState().then(setState).catch(() => setState({ mode: "error" }));
    }, []);

    const back = () => setScreen("home");
    const chip = !state ? "" : state.mode === "live" ? "LIVE" : state.mode === "trial" ? "TRIAL" : "NOT STARTED";

    return (
        <div className="min-h-screen bg-[#F5F7FA]" data-testid="warehouse-app">
            <NoIndex title="Warehouse" />
            <header className="sticky top-0 z-10 bg-[#002B5C] text-white px-4 py-3 flex items-center gap-3">
                {screen !== "home" ? (
                    <button type="button" onClick={back} aria-label="Back" className="p-1"><ArrowLeft size={22} /></button>
                ) : null}
                <div className="font-serif text-xl flex-1">Warehouse</div>
                <span className="text-[10px] font-mono tracking-widest border border-white/40 px-2 py-0.5">{chip}</span>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)}
                        data-testid="wh-practice" className="w-5 h-5" />
                    Practice
                </label>
            </header>
            {practice && (
                <div className="bg-[#F59E0B] text-[#002B5C] text-sm font-medium px-4 py-2 text-center">
                    Practice mode — nothing here changes stock.
                </div>
            )}
            {state?.mode === "off" && !practice && (
                <div className="bg-[#CC0033]/10 text-[#CC0033] text-sm px-4 py-2">
                    The trial has not been started yet. Use Practice, or ask your manager to start it.
                </div>
            )}

            <main className="max-w-xl mx-auto p-4">
                {screen === "home" && (
                    <div className="space-y-3">
                        <p className="text-sm text-[#4B5563]">Hello {user?.name?.split(" ")[0] || ""}. What are you doing?</p>
                        <button type="button" className={`${BIG} border-[#15803D]`} onClick={() => setScreen("in")} data-testid="wh-go-in">
                            <PackagePlus size={30} className="text-[#15803D]" /> Books arrived from printer
                        </button>
                        <button type="button" className={`${BIG} border-[#002B5C]`} onClick={() => setScreen("out")} data-testid="wh-go-out">
                            <PackageMinus size={30} className="text-[#002B5C]" /> Pack an invoice (carton out)
                        </button>
                        <button type="button" className={`${BIG} border-[#7C3AED]`} onClick={() => setScreen("courier")} data-testid="wh-go-courier">
                            <Truck size={30} className="text-[#7C3AED]" /> Courier sheet (parcels out)
                        </button>
                        <button type="button" className={`${BIG} border-[#F59E0B]`} onClick={() => setScreen("move")} data-testid="wh-go-move">
                            <ScanBarcode size={30} className="text-[#B4750F]" /> One book in or out
                        </button>
                        <button type="button" className={`${BIG} border-[#E5E7EB]`} onClick={() => setScreen("check")} data-testid="wh-go-check">
                            <Search size={30} className="text-[#4B5563]" /> Check stock
                        </button>
                    </div>
                )}
                {(screen === "in" || screen === "out") && (
                    <DocFlow key={screen} direction={screen} practice={practice} onDone={back} />
                )}
                {screen === "courier" && <CourierFlow practice={practice} onDone={back} />}
                {screen === "move" && <SingleMove practice={practice} />}
                {screen === "check" && <CheckStock />}
            </main>
        </div>
    );
}

/* ------------------------------------------------------------ scan box --- */
function ScanBox({ onCode, placeholder = "Scan or type ISBN, then Enter", autoFocus = true }) {
    const [v, setV] = useState("");
    return (
        <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onCode(v.trim()); setV(""); } }}>
            <input value={v} onChange={(e) => setV(e.target.value)} autoFocus={autoFocus} inputMode="numeric"
                placeholder={placeholder} data-testid="wh-scan"
                className="w-full border-2 border-[#002B5C] px-4 py-3 text-lg font-mono bg-white" />
        </form>
    );
}

const isbnOf = (s) => String(s || "").replace(/[^0-9Xx]/g, "").toUpperCase();

/* ------------------------------------------------------- bill / invoice --- */
function DocFlow({ direction, practice, onDone }) {
    const [busy, setBusy] = useState(false);
    const [doc, setDoc] = useState(null);
    const [lines, setLines] = useState([]);
    const [books, setBooks] = useState([]);
    const [head, setHead] = useState({ doc_number: "", party_name: "", party_kind: "sale_offline" });
    const cam = useRef(null);
    const fileIn = useRef(null);
    const isOut = direction === "out";

    useEffect(() => { whBooks().then(setBooks).catch(() => {}); }, []);
    const byId = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);

    const start = async (file) => {
        setBusy(true);
        try {
            const d = await whUploadDoc(direction, file, practice);
            setDoc(d);
            setHead({ doc_number: d.doc_number || "", party_name: d.party_name || "", party_kind: d.party_kind || "sale_offline" });
            setLines((d.read_lines || []).map((l) => ({ ...l, packed: 0 })));
            if (d.error) toast.error(d.error);
            else if (file) toast.success(`Read ${d.read_lines.length} line(s). Check each one.`);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };

    const setLine = (i, patch) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
    const addLine = (bookId) => {
        if (!bookId) return;
        setLines((ls) => [...ls, { line_no: null, book_id: bookId, qty: 1, include: true, packed: 0, doc_title: "Added by hand", candidates: [] }]);
    };

    const onScan = (code) => {
        const isbn = isbnOf(code);
        const book = books.find((b) => isbnOf(b.isbn) === isbn);
        if (!book) return toast.error(`No book with ISBN ${isbn}`);
        const i = lines.findIndex((l) => l.include && l.book_id === book.id);
        if (i === -1) return toast.error(`"${book.title}" is NOT on this invoice.`);
        const l = lines[i];
        if (l.packed >= l.qty) return toast.error(`Already packed all ${l.qty} of "${book.title}".`);
        setLine(i, { packed: l.packed + 1 });
    };

    const included = lines.filter((l) => l.include && l.book_id);
    const units = included.reduce((s, l) => s + Number(l.qty || 0), 0);
    const packedUnits = included.reduce((s, l) => s + Number(l.packed || 0), 0);

    const confirm = async () => {
        let send = lines;
        if (isOut) {
            const short = included.filter((l) => l.packed < l.qty);
            if (short.length) {
                const msg = short.map((l) => `${byId[l.book_id]?.title || "?"}: packed ${l.packed} of ${l.qty}`).join("\n");
                if (!window.confirm(`Some books are short:\n\n${msg}\n\nSave only what is packed?`)) return;
            }
            send = lines.map((l) => (l.include && l.book_id ? { ...l, qty: l.packed } : l));
        }
        setBusy(true);
        try {
            const res = await whConfirmDoc(doc.id, {
                lines: send.map((l) => ({ line_no: l.line_no, book_id: l.book_id, qty: Number(l.qty) || 0, include: !!l.include })),
                doc_number: head.doc_number, party_name: head.party_name,
                party_kind: isOut ? head.party_kind : undefined,
            });
            toast.success(res.practice ? "Practice saved — stock not changed." : isOut ? "Carton packed. Stock updated." : "Synced. Stock updated.");
            onDone();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };

    const viewFile = async () => {
        try {
            const blob = await whDocFile(doc.id);
            window.open(URL.createObjectURL(blob), "_blank", "noopener");
        } catch {
            toast.error("Could not open the file.");
        }
    };

    const report = async () => {
        const note = window.prompt("What went wrong?");
        if (!note) return;
        try { await whReport(doc.id, note); toast.success("Thanks — reported."); } catch (e) { toast.error(formatApiError(e)); }
    };

    if (!doc) {
        return (
            <div className="space-y-3">
                <h1 className="font-serif text-2xl text-[#002B5C]">{isOut ? "Pack an invoice" : "Books arrived from printer"}</h1>
                <p className="text-sm text-[#4B5563]">
                    {isOut ? "Photo of the invoice, or the PDF from WhatsApp/email." : "Photo of the printer's bill."}
                </p>
                <input ref={cam} type="file" accept="image/*" capture="environment" hidden
                    onChange={(e) => e.target.files[0] && start(e.target.files[0])} />
                <input ref={fileIn} type="file" accept="image/*,application/pdf" hidden
                    onChange={(e) => e.target.files[0] && start(e.target.files[0])} />
                <button type="button" disabled={busy} className={`${BIG} border-[#002B5C]`} onClick={() => cam.current.click()} data-testid="wh-photo">
                    <Camera size={28} /> {busy ? "Reading… (up to 30 seconds)" : "Take a photo"}
                </button>
                <button type="button" disabled={busy} className={`${BIG} border-[#E5E7EB]`} onClick={() => fileIn.current.click()} data-testid="wh-file">
                    <FileText size={28} /> Choose PDF or photo
                </button>
                <button type="button" disabled={busy} className="w-full underline text-[#002B5C] py-3" onClick={() => start(null)} data-testid="wh-manual">
                    Enter by hand instead
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4 pb-28">
            {doc.duplicate_of && (
                <div className="border-2 border-[#CC0033] bg-white p-3 text-[#CC0033] font-medium">
                    ⚠️ This {isOut ? "invoice" : "bill"} was already synced before. Ask your manager before going on.
                </div>
            )}
            {doc.error && <div className="border border-[#F59E0B] bg-white p-3 text-sm">{doc.error}</div>}
            <div className="bg-white border border-[#E5E7EB] p-3 space-y-2 text-sm">
                <label className="block">{isOut ? "Invoice no." : "Bill no."}
                    <input value={head.doc_number} onChange={(e) => setHead({ ...head, doc_number: e.target.value })}
                        className="mt-1 w-full border px-3 py-2 text-base" /></label>
                <label className="block">{isOut ? "Sent to" : "Printer"}
                    <input value={head.party_name} onChange={(e) => setHead({ ...head, party_name: e.target.value })}
                        className="mt-1 w-full border px-3 py-2 text-base" /></label>
                {isOut && (
                    <div className="flex gap-2">
                        {[["sale_offline", "Sale / shop"], ["author_copy", "Author copy"]].map(([v, l]) => (
                            <button key={v} type="button" onClick={() => setHead({ ...head, party_kind: v })}
                                className={`${BTN} flex-1 border-2 ${head.party_kind === v ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#E5E7EB] bg-white"}`}>
                                {l}
                            </button>
                        ))}
                    </div>
                )}
                {doc.file_path && <button type="button" onClick={viewFile} className="underline text-[#002B5C]">View the {isOut ? "invoice" : "bill"}</button>}
            </div>

            {isOut && (
                <div className="space-y-2">
                    <div className="text-sm font-medium text-[#002B5C]">Scan each book as it goes into the carton</div>
                    <ScanBox onCode={onScan} />
                    <div className="text-lg font-medium" data-testid="wh-packed-progress">{packedUnits} of {units} copies packed</div>
                </div>
            )}

            {lines.map((l, i) => {
                const book = byId[l.book_id];
                return (
                    <div key={i} className={`bg-white border-2 p-3 ${l.include ? "border-[#002B5C]" : "border-[#E5E7EB] opacity-70"}`} data-testid="wh-line">
                        <div className="flex items-start gap-3">
                            <input type="checkbox" checked={!!l.include} onChange={(e) => setLine(i, { include: e.target.checked })}
                                className="w-6 h-6 mt-1" aria-label="Include this line" />
                            <div className="flex-1 min-w-0">
                                {book ? (
                                    <div className="text-lg font-semibold text-[#002B5C] leading-snug">{book.title}</div>
                                ) : (
                                    <div className="text-base font-semibold text-[#CC0033]">Which book is this?</div>
                                )}
                                <div className="text-xs text-[#4B5563] mt-1">
                                    On the {isOut ? "invoice" : "bill"}: “{l.doc_title || "—"}”{l.doc_isbn ? ` · ${l.doc_isbn}` : ""}
                                    {l.match === "title" ? " · matched by title — check it" : ""}
                                </div>
                                <select value={l.book_id || ""} onChange={(e) => setLine(i, { book_id: e.target.value || null, include: !!e.target.value })}
                                    className="mt-2 w-full border px-2 py-2 text-sm bg-white">
                                    <option value="">— Not a book / skip —</option>
                                    {(l.candidates || []).map((c) => <option key={`c-${c.book_id}`} value={c.book_id}>★ {c.title}</option>)}
                                    {books.map((b) => <option key={b.id} value={b.id}>{b.title} ({b.isbn})</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                            <span className="text-sm">{isOut ? "On invoice" : "Copies"}</span>
                            <input type="number" min={0} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                                className="w-24 border-2 px-2 py-2 text-lg font-mono" />
                            {isOut && l.include && l.book_id && (
                                <>
                                    <span className={`text-lg font-mono ${l.packed === l.qty ? "text-[#15803D]" : "text-[#4B5563]"}`}>
                                        packed {l.packed}
                                    </span>
                                    <button type="button" className="ml-auto border px-3 py-2 text-sm"
                                        onClick={() => setLine(i, { packed: l.qty })}>All packed</button>
                                </>
                            )}
                        </div>
                    </div>
                );
            })}

            <div className="bg-white border border-dashed p-3">
                <div className="text-sm mb-2">Missing a book? Add it:</div>
                <select value="" onChange={(e) => addLine(e.target.value)} className="w-full border px-2 py-2 text-sm bg-white" data-testid="wh-add-line">
                    <option value="">+ Add a book</option>
                    {books.map((b) => <option key={b.id} value={b.id}>{b.title} ({b.isbn})</option>)}
                </select>
            </div>

            {doc.total_qty ? (
                <div className={`text-sm ${units === doc.total_qty ? "text-[#15803D]" : "text-[#CC0033] font-medium"}`}>
                    {units === doc.total_qty ? `✓ Lines add up to the total (${doc.total_qty}).` : `⚠️ Lines add up to ${units}, but the ${isOut ? "invoice" : "bill"} total says ${doc.total_qty}.`}
                </div>
            ) : null}

            <button type="button" onClick={report} className="text-sm underline text-[#4B5563]">Something wrong? Report it</button>

            <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3">
                <button type="button" disabled={busy} onClick={confirm} data-testid="wh-confirm"
                    className={`w-full ${BTN} text-lg text-white ${practice ? "bg-[#B4750F]" : "bg-[#15803D]"}`}>
                    {busy ? "Saving…" : practice ? "Save practice (no stock change)" : isOut ? `Packed — remove ${packedUnits} from stock` : `Sync — add ${units} to stock`}
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------- courier sheet --- */
/**
 * One courier run: a sheet of address labels, several parcels, each with its
 * own books. A sheet mixes PAID WEBSITE ORDERS (their copies already left the
 * website stock at payment, so they must not be deducted again) with FREE
 * COPIES to teachers and academies (deducted here). The system suggests which
 * is which by matching phone / pin code / name to unshipped website orders;
 * he can switch any parcel with one tap.
 */
const PARCEL_KINDS = [
    ["free_copy", "Free copy — remove from stock"],
    ["website_order", "Website order — already removed"],
    ["skip", "Not sending"],
];

function CourierFlow({ practice, onDone }) {
    const [busy, setBusy] = useState(false);
    const [doc, setDoc] = useState(null);
    const [parcels, setParcels] = useState([]);
    const [books, setBooks] = useState([]);
    const cam = useRef(null);
    const fileIn = useRef(null);

    useEffect(() => { whBooks().then(setBooks).catch(() => {}); }, []);
    const byId = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);

    const start = async (file) => {
        setBusy(true);
        try {
            const d = await whUploadDoc("courier", file, practice);
            setDoc(d);
            setParcels(d.parcels || []);
            if (d.error) toast.error(d.error);
            else if (file) toast.success(`Read ${d.parcels.length} parcel(s). Check each one.`);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };

    const setParcel = (i, patch) => setParcels((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
    const setLine = (pi, li, patch) =>
        setParcels((ps) => ps.map((p, k) => (k !== pi ? p : { ...p, lines: p.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) })));
    const addLine = (pi, bookId) => {
        if (!bookId) return;
        setParcels((ps) => ps.map((p, k) => (k !== pi ? p : {
            ...p, lines: [...p.lines, { line_no: null, book_id: bookId, qty: 1, include: true, doc_title: "Added by hand", candidates: [] }],
        })));
    };
    const addParcel = () => setParcels((ps) => [...ps, {
        no: (ps.reduce((m, p) => Math.max(m, p.no), 0) || 0) + 1, name: "", org: "", pincode: "",
        kind: "free_copy", order_id: "", order_number: "", lines: [],
    }]);

    const freeCopies = parcels.filter((p) => p.kind === "free_copy")
        .reduce((s, p) => s + p.lines.filter((l) => l.include && l.book_id).reduce((a, l) => a + Number(l.qty || 0), 0), 0);

    const confirm = async () => {
        setBusy(true);
        try {
            const res = await whConfirmDoc(doc.id, {
                parcels: parcels.map((p) => ({
                    no: p.no, kind: p.kind, order_id: p.kind === "website_order" ? p.order_id || null : null,
                    lines: p.lines.map((l) => ({ line_no: l.line_no, book_id: l.book_id, qty: Number(l.qty) || 0, include: !!l.include })),
                })),
            });
            toast.success(res.practice ? "Practice saved — stock not changed." : `Done. ${freeCopies} free copies removed from stock.`);
            onDone();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };

    if (!doc) {
        return (
            <div className="space-y-3">
                <h1 className="font-serif text-2xl text-[#002B5C]">Courier sheet</h1>
                <p className="text-sm text-[#4B5563]">The sheet of address labels for today's parcels — PDF from WhatsApp/email, or a photo.</p>
                <input ref={cam} type="file" accept="image/*" capture="environment" hidden
                    onChange={(e) => e.target.files[0] && start(e.target.files[0])} />
                <input ref={fileIn} type="file" accept="image/*,application/pdf" hidden
                    onChange={(e) => e.target.files[0] && start(e.target.files[0])} />
                <button type="button" disabled={busy} className={`${BIG} border-[#7C3AED]`} onClick={() => fileIn.current.click()} data-testid="wh-courier-file">
                    <FileText size={28} /> {busy ? "Reading…" : "Choose PDF or photo"}
                </button>
                <button type="button" disabled={busy} className={`${BIG} border-[#E5E7EB]`} onClick={() => cam.current.click()}>
                    <Camera size={28} /> Take a photo
                </button>
                <button type="button" disabled={busy} className="w-full underline text-[#002B5C] py-3" onClick={() => start(null)}>
                    Enter by hand instead
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4 pb-28">
            {doc.duplicate_of && (
                <div className="border-2 border-[#CC0033] bg-white p-3 text-[#CC0033] font-medium">
                    ⚠️ This courier sheet was already synced before. Ask your manager before going on.
                </div>
            )}
            {doc.error && <div className="border border-[#F59E0B] bg-white p-3 text-sm">{doc.error}</div>}
            {parcels.map((p, pi) => (
                <div key={p.no} className={`bg-white border-2 p-3 space-y-3 ${p.kind === "skip" ? "border-[#E5E7EB] opacity-70" : "border-[#7C3AED]"}`} data-testid="wh-parcel">
                    <div>
                        <div className="text-xs font-mono text-[#4B5563]">PARCEL {p.no}</div>
                        <input value={p.name} onChange={(e) => setParcel(pi, { name: e.target.value })} placeholder="Sent to"
                            className="w-full text-lg font-semibold text-[#002B5C] border-b px-1 py-1" />
                        <div className="text-sm text-[#4B5563] mt-1">{[p.org, p.pincode].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="flex flex-col gap-2">
                        {PARCEL_KINDS.map(([v, label]) => (
                            <button key={v} type="button" onClick={() => setParcel(pi, { kind: v })}
                                disabled={v === "website_order" && !p.order_id}
                                className={`text-left px-3 py-2 text-sm border-2 disabled:opacity-40 ${p.kind === v ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#E5E7EB] bg-white"}`}>
                                {v === "website_order" && p.order_number ? `Website order ${p.order_number} — already removed` : label}
                            </button>
                        ))}
                        {!p.order_id && (
                            <div className="text-xs text-[#4B5563]">No paid website order found for this address. If it IS a website order, choose “Not sending” and tell your manager.</div>
                        )}
                    </div>
                    {p.lines.map((l, li) => {
                        const book = byId[l.book_id];
                        return (
                            <div key={li} className="border-t pt-2">
                                <div className="flex items-start gap-3">
                                    <input type="checkbox" checked={!!l.include} onChange={(e) => setLine(pi, li, { include: e.target.checked })}
                                        className="w-6 h-6 mt-1" aria-label="Include this book" />
                                    <div className="flex-1 min-w-0">
                                        {book ? <div className="text-base font-semibold text-[#002B5C]">{book.title}</div>
                                            : <div className="text-base font-semibold text-[#CC0033]">Which book is this?</div>}
                                        <div className="text-xs text-[#4B5563]">On the sheet: “{l.doc_title}”{l.match === "title" ? " · matched by title — check it" : ""}</div>
                                        <select value={l.book_id || ""} onChange={(e) => setLine(pi, li, { book_id: e.target.value || null, include: !!e.target.value })}
                                            className="mt-1 w-full border px-2 py-2 text-base bg-white">
                                            <option value="">— Not a book / skip —</option>
                                            {(l.candidates || []).map((c) => <option key={`c-${c.book_id}`} value={c.book_id}>★ {c.title}</option>)}
                                            {books.map((b) => <option key={b.id} value={b.id}>{b.title} ({b.isbn})</option>)}
                                        </select>
                                    </div>
                                    <input type="number" min={0} value={l.qty} onChange={(e) => setLine(pi, li, { qty: Number(e.target.value) })}
                                        className="w-16 border-2 px-2 py-2 text-base font-mono" aria-label="Copies" />
                                </div>
                            </div>
                        );
                    })}
                    <select value="" onChange={(e) => addLine(pi, e.target.value)} className="w-full border px-2 py-2 text-base bg-white">
                        <option value="">+ Add a book to this parcel</option>
                        {books.map((b) => <option key={b.id} value={b.id}>{b.title} ({b.isbn})</option>)}
                    </select>
                </div>
            ))}
            <button type="button" onClick={addParcel} className="w-full border-2 border-dashed py-3 text-[#002B5C]">+ Add a parcel</button>
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3">
                <button type="button" disabled={busy} onClick={confirm} data-testid="wh-courier-confirm"
                    className={`w-full ${BTN} text-lg text-white ${practice ? "bg-[#B4750F]" : "bg-[#15803D]"}`}>
                    {busy ? "Saving…" : practice ? "Save practice (no stock change)" : `Done — remove ${freeCopies} free copies from stock`}
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------- one book move --- */
function SingleMove({ practice }) {
    const [found, setFound] = useState(null);
    const [dir, setDir] = useState("out");
    const [reason, setReason] = useState("damaged");
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);

    const look = async (code) => {
        try { setFound(await whLookup(code)); } catch (e) { setFound(null); toast.error(formatApiError(e)); }
    };
    const save = async () => {
        setBusy(true);
        try {
            await whMove({ code: found.book.isbn, qty: Number(qty), reason, note, practice });
            toast.success(practice ? "Practice — not saved to stock." : "Saved.");
            setFound(null); setQty(1); setNote("");
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const reasons = dir === "in" ? IN_REASONS : OUT_REASONS;

    return (
        <div className="space-y-3">
            <h1 className="font-serif text-2xl text-[#002B5C]">One book in or out</h1>
            <ScanBox onCode={look} />
            {found && (
                <div className="bg-white border-2 border-[#002B5C] p-4 space-y-3">
                    <div className="text-lg font-semibold text-[#002B5C]">{found.book.title}</div>
                    <div className="text-sm text-[#4B5563]">Warehouse count: <b>{found.book.wh_stock ?? "—"}</b></div>
                    <div className="flex gap-2">
                        {[["in", "IN ⬆"], ["out", "OUT ⬇"]].map(([v, l]) => (
                            <button key={v} type="button" onClick={() => { setDir(v); setReason(v === "in" ? "return" : "damaged"); }}
                                className={`${BTN} flex-1 border-2 ${dir === v ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#E5E7EB] bg-white"}`}>{l}</button>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {reasons.map(([v, l]) => (
                            <button key={v} type="button" onClick={() => setReason(v)}
                                className={`px-3 py-2 text-sm border-2 ${reason === v ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#E5E7EB]"}`}>{l}</button>
                        ))}
                    </div>
                    <label className="flex items-center gap-3">Copies
                        <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="w-24 border-2 px-2 py-2 text-lg font-mono" />
                    </label>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full border px-3 py-2" />
                    <button type="button" disabled={busy} onClick={save} className={`w-full ${BTN} text-white bg-[#15803D]`} data-testid="wh-move-save">
                        {busy ? "Saving…" : "Save"}
                    </button>
                </div>
            )}
        </div>
    );
}

/* --------------------------------------------------------- check stock --- */
function CheckStock() {
    const [found, setFound] = useState(null);
    const look = async (code) => {
        try { setFound(await whLookup(code)); } catch (e) { setFound(null); toast.error(formatApiError(e)); }
    };
    return (
        <div className="space-y-3">
            <h1 className="font-serif text-2xl text-[#002B5C]">Check stock</h1>
            <ScanBox onCode={look} />
            {found && (
                <div className="bg-white border border-[#E5E7EB] p-4">
                    <div className="text-lg font-semibold text-[#002B5C]">{found.book.title}</div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-center">
                        <div className="border p-3"><div className="text-xs">Warehouse count</div><div className="text-3xl font-serif">{found.book.wh_stock ?? "—"}</div></div>
                        <div className="border p-3"><div className="text-xs">On the website</div><div className="text-3xl font-serif">{found.book.stock ?? 0}</div></div>
                    </div>
                    <div className="mt-4 text-sm font-medium">Last movements</div>
                    <ul className="mt-1 text-sm divide-y">
                        {found.movements.map((m) => (
                            <li key={m.id} className="py-1 flex justify-between gap-2">
                                <span>{new Date(m.at).toLocaleDateString("en-IN")} · {m.reason}{m.party ? ` · ${m.party}` : ""}</span>
                                <span className={`font-mono ${m.qty > 0 ? "text-[#15803D]" : "text-[#CC0033]"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}{m.undone ? " (undone)" : ""}</span>
                            </li>
                        ))}
                        {!found.movements.length && <li className="py-1 text-[#4B5563]">None yet.</li>}
                    </ul>
                </div>
            )}
            <Link to="/" className="block text-center text-sm underline text-[#4B5563]">Open the website</Link>
        </div>
    );
}
