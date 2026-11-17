import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Layers, Plus, Trash2, Star, Link2, Sparkles, AlertTriangle } from "lucide-react";
import {
    adminGetBookFormats,
    adminLookupFormatIsbn,
    adminSaveBookFormats,
    formatApiError,
    formatINR,
} from "../../lib/api";

/*
 * Admin → Books → Edit → "Formats" (backend/book_formats.py).
 *
 * One title sold as Paperback, Hardback, … where EACH format is its own book
 * with its own ISBN, price and stock. This panel only groups them, names them
 * and prices them; stock is never edited here because it belongs to the
 * warehouse ledger (a new format starts at 0 and copies arrive like any new
 * title's).
 *
 * It saves on its OWN button, not the form's "Save changes": saving can
 * create new books, and the admin should see that happen as a deliberate act
 * rather than as a side effect of fixing a typo in the description.
 *
 * After a save, the price this panel set for the book being edited is pushed
 * back into the main form (onAnchorPrice). Otherwise the form still holds the
 * old price and "Save changes" would quietly put it back.
 */

const GUESS = (binding) => {
    const b = String(binding || "").toLowerCase();
    if (/hard|case|cloth/.test(b)) return "Hardback";
    if (/soft|paper/.test(b)) return "Paperback";
    return "Paperback";
};

const blankRow = (label = "") => ({ book_id: null, isbn: "", label, price: "", original_price: "", stock: 0, hint: null });

export default function BookFormats({ book, onAnchorPrice, onChanged }) {
    const [data, setData] = useState(null);
    const [rows, setRows] = useState([]);
    const [primary, setPrimary] = useState(0);
    const [on, setOn] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const fromServer = (d) => {
        setData(d);
        setOn(!!d.enabled);
        const rs = (d.formats || []).map((f) => ({
            book_id: f.id, isbn: f.isbn, label: f.label, price: f.price ?? "", original_price: f.original_price ?? "",
            stock: f.stock, pod: f.pod, title: f.title, hint: null,
        }));
        setRows(rs);
        setPrimary(Math.max(0, (d.formats || []).findIndex((f) => f.primary)));
        setDirty(false);
    };

    useEffect(() => {
        adminGetBookFormats(book.id).then(fromServer).catch((e) => toast.error(formatApiError(e)));
    }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const startFresh = () => {
        const mine = GUESS(book.binding);
        setRows([
            { book_id: book.id, isbn: book.isbn, label: mine, price: book.price ?? "", original_price: book.original_price ?? "", stock: book.stock ?? 0, hint: null },
            blankRow(mine === "Hardback" ? "Paperback" : "Hardback"),
        ]);
        setPrimary(0);
        setOn(true);
        setDirty(true);
    };

    const toggle = async () => {
        if (!on) return startFresh();
        if (!data?.enabled) {
            // Never saved — just close the editor.
            setOn(false);
            setRows([]);
            setDirty(false);
            return;
        }
        if (!window.confirm("Stop selling this title in formats?\n\nEvery format stays as its own book (nothing is deleted) and shows as its own card in the bookstore again.")) return;
        setSaving(true);
        try {
            fromServer(await adminSaveBookFormats(book.id, { formats: [], primary_index: 0 }));
            toast.success("Formats switched off — each format is its own book again.");
            onChanged?.();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setSaving(false);
        }
    };

    const set = (i, k, v) => {
        setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v, ...(k === "isbn" ? { hint: null } : {}) } : r)));
        setDirty(true);
    };

    const lookup = async (i) => {
        const r = rows[i];
        if (r.book_id || !String(r.isbn || "").trim()) return;
        try {
            const h = await adminLookupFormatIsbn(r.isbn, book.id);
            setRows((rs) => rs.map((x, idx) => {
                if (idx !== i) return x;
                // Linking an existing book: start from ITS price, not a blank.
                const fill = h.action === "link" && h.book && x.price === "" ? { price: h.book.price ?? "", original_price: h.book.original_price ?? "" } : {};
                return { ...x, ...fill, hint: h };
            }));
        } catch {
            /* the save validates anyway */
        }
    };

    const remove = (i) => {
        setRows((rs) => rs.filter((_, idx) => idx !== i));
        setPrimary((p) => (p === i ? 0 : p > i ? p - 1 : p));
        setDirty(true);
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload = {
                primary_index: primary,
                formats: rows.map((r) => ({
                    book_id: r.book_id || null,
                    isbn: r.book_id ? null : String(r.isbn || "").trim(),
                    label: String(r.label || "").trim(),
                    price: r.price === "" ? null : Number(r.price),
                    original_price: r.original_price === "" || r.original_price == null ? null : Number(r.original_price),
                })),
            };
            const d = await adminSaveBookFormats(book.id, payload);
            fromServer(d);
            const mine = (d.formats || []).find((f) => f.id === book.id);
            if (mine) onAnchorPrice?.(mine.price, mine.original_price);
            const made = (d.created || []).length;
            toast.success(made ? `Formats saved — ${made} new book${made === 1 ? "" : "s"} created (stock 0 until the warehouse counts copies).` : "Formats saved.");
            onChanged?.();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setSaving(false);
        }
    };

    const labels = data?.suggested_labels || ["Paperback", "Hardback"];

    return (
        <div className="mt-8 border-t border-[#E5E7EB] pt-6" data-testid="book-formats">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="overline flex items-center gap-2">
                        <Layers size={14} strokeWidth={1.5} /> Formats
                    </div>
                    <p className="text-xs text-[#4B5563] mt-1 max-w-xl">
                        Sell this title as Paperback, Hardback and more. Each format is its own book — own ISBN, price and
                        stock — so warehouse, courier, Amazon/Flipkart sheets and invoices work as usual. The bookstore shows
                        one card; the product page gets a format switcher.
                    </p>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={toggle}
                    disabled={saving || !data}
                    data-testid="formats-toggle"
                    className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${on ? "bg-[#002B5C]" : "bg-[#D1D5DB]"} disabled:opacity-50`}
                    title={on ? "Switch formats off" : "Sell in more than one format"}
                >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                </button>
            </div>

            {on && (
                <div className="mt-4">
                    <datalist id="format-labels">
                        {labels.map((l) => <option key={l} value={l} />)}
                    </datalist>
                    <div className="hidden md:grid grid-cols-[56px_1.3fr_1.5fr_100px_100px_80px_32px] gap-2 px-2 pb-1 text-[10px] font-mono uppercase tracking-widest text-[#6B7280]">
                        <span>Listed</span><span>Format</span><span>ISBN</span><span>Price ₹</span><span>MRP ₹</span><span>Stock</span><span />
                    </div>
                    <div className="space-y-2">
                        {rows.map((r, i) => {
                            const self = r.book_id === book.id;
                            const h = r.hint;
                            return (
                                <div key={r.book_id || `new-${i}`} className={`border ${primary === i ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#E5E7EB]"} p-2`} data-testid={`format-row-${i}`}>
                                    <div className="grid grid-cols-2 md:grid-cols-[56px_1.3fr_1.5fr_100px_100px_80px_32px] gap-2 items-center">
                                        <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="The format the bookstore lists">
                                            <input type="radio" name="format-primary" checked={primary === i} onChange={() => { setPrimary(i); setDirty(true); }} />
                                            {primary === i && <Star size={12} className="text-[#F59E0B]" fill="#F59E0B" />}
                                        </label>
                                        <input
                                            list="format-labels"
                                            value={r.label}
                                            onChange={(e) => set(i, "label", e.target.value)}
                                            placeholder="Hardback"
                                            maxLength={40}
                                            className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm"
                                            data-testid={`format-label-${i}`}
                                        />
                                        {r.book_id ? (
                                            <div className="text-xs font-mono text-[#374151] truncate" title={r.title}>
                                                {r.isbn || "—"}{" "}
                                                <span className={`ml-1 px-1.5 py-0.5 text-[10px] ${self ? "bg-[#002B5C] text-white" : "bg-[#E5E7EB] text-[#374151]"}`}>
                                                    {self ? "this book" : "linked"}
                                                </span>
                                            </div>
                                        ) : (
                                            <input
                                                value={r.isbn}
                                                onChange={(e) => set(i, "isbn", e.target.value)}
                                                onBlur={() => lookup(i)}
                                                placeholder="978…"
                                                inputMode="numeric"
                                                className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm font-mono"
                                                data-testid={`format-isbn-${i}`}
                                            />
                                        )}
                                        <input type="number" min="1" value={r.price} onChange={(e) => set(i, "price", e.target.value)} placeholder="Price" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm" data-testid={`format-price-${i}`} />
                                        <input type="number" min="0" value={r.original_price ?? ""} onChange={(e) => set(i, "original_price", e.target.value)} placeholder="MRP" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm" />
                                        <span className="text-xs text-[#4B5563]" title="Stock comes from the warehouse">
                                            {r.book_id ? (r.stock > 0 ? r.stock : r.pod ? "POD" : "0") : h?.action === "link" ? h.book?.stock ?? 0 : "new · 0"}
                                        </span>
                                        {self ? <span /> : (
                                            <button type="button" onClick={() => remove(i)} className="text-[#CC0033] hover:bg-[#FEF2F2] p-1" title="Remove from this title (the book itself is kept)" aria-label="Remove format">
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                    {h && !r.book_id && (
                                        <div className={`mt-1.5 text-[11px] flex items-center gap-1.5 ${h.valid === false || h.in_other_group ? "text-[#CC0033]" : "text-[#4B5563]"}`}>
                                            {h.valid === false ? (<><AlertTriangle size={12} /> Not a valid ISBN — check the digits.</>)
                                                : h.action === "create" ? (<><Sparkles size={12} /> New book — copies title, author, cover and description from this one. Stock starts at 0.</>)
                                                : h.action === "self" ? (<><AlertTriangle size={12} /> That's this book's own ISBN.</>)
                                                : h.in_other_group ? (<><AlertTriangle size={12} /> “{h.book?.title}” is already a format of another title — remove it there first.</>)
                                                : (<><Link2 size={12} /> Links the existing book “{h.book?.title}” ({formatINR(h.book?.price)}, stock {h.book?.stock ?? 0}). Nothing is copied over it.</>)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => { setRows((rs) => [...rs, blankRow()]); setDirty(true); }}
                            disabled={rows.length >= 6}
                            className="text-xs border border-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA] inline-flex items-center gap-1 disabled:opacity-40"
                            data-testid="format-add"
                        >
                            <Plus size={12} /> Add format
                        </button>
                        <div className="flex items-center gap-3">
                            {dirty && <span className="text-[11px] text-[#B45309]">Unsaved format changes</span>}
                            <button
                                type="button"
                                onClick={save}
                                disabled={saving || !dirty}
                                className="text-xs bg-[#002B5C] text-white px-4 py-2 hover:bg-[#001a3a] disabled:opacity-40"
                                data-testid="format-save"
                            >
                                {saving ? "Saving…" : "Save formats"}
                            </button>
                        </div>
                    </div>
                    <p className="mt-2 text-[11px] text-[#6B7280]">
                        ★ Listed = the card shown in the bookstore and search (any format's ISBN finds it). Stock for each
                        format is set by the warehouse; open that book in this list to edit its other details.
                    </p>
                </div>
            )}
        </div>
    );
}
