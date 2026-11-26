import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import { adminUploadCover, adminUpdateBook, formatApiError } from "../../lib/api";

/*
 * Admin → Books → "Covers by ISBN" (Nov 2026).
 *
 * Pick many image files at once, each NAMED BY ISBN ("9789391032272.jpg",
 * "978-93-91032-27-2 front.png" works too — the first 13 or 10 ISBN digits
 * in the name are used). Each is matched to the book with that ISBN, shown
 * for a check, then uploaded through the same cover upload the Books form
 * uses and set as that book's cover.
 *
 * Why: titles were added with a fallback cover until the real artwork
 * arrives; this replaces any number of them in one go, and the same tool
 * takes the next batch whenever it comes. Files whose ISBN matches no book,
 * or two files for one book, are listed and skipped — never guessed.
 */
const ISBN_RE = /(97[89]\d{10}|\d{9}[\dXx])/;

export const isbnFromName = (name) => {
    const digits = String(name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[\s-]/g, "");
    const m = digits.match(ISBN_RE);
    return m ? m[1].toUpperCase() : "";
};

export default function BulkCovers({ books, onClose, onDone }) {
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState({});   // isbn -> "ok" | error text

    const byIsbn = useMemo(() => {
        const m = {};
        for (const b of books || []) {
            const k = String(b.isbn || "").replace(/[^0-9Xx]/g, "").toUpperCase();
            if (k) m[k] = b;
        }
        return m;
    }, [books]);

    const rows = useMemo(() => {
        const seen = {};
        return files.map((f) => {
            const isbn = isbnFromName(f.name);
            const book = isbn ? byIsbn[isbn] : null;
            seen[isbn] = (seen[isbn] || 0) + 1;
            return { f, isbn, book };
        }).map((r) => ({
            ...r,
            problem: !r.f.type.startsWith("image/") ? "not an image"
                : !r.isbn ? "no ISBN in the file name"
                : !r.book ? "no book with this ISBN"
                : seen[r.isbn] > 1 ? "two files for this book — keep one"
                : r.f.size > 8 * 1024 * 1024 ? "over 8 MB" : "",
        }));
    }, [files, byIsbn]);
    const ready = rows.filter((r) => !r.problem);

    const go = async () => {
        if (!window.confirm(`Set the cover of ${ready.length} book${ready.length === 1 ? "" : "s"} from these files?\n\nEach replaces that book's current cover.`)) return;
        setBusy(true);
        let ok = 0;
        for (const r of ready) {
            try {
                const up = await adminUploadCover(r.f);
                await adminUpdateBook(r.book.id, { cover_image: up.url });
                setDone((d) => ({ ...d, [r.isbn]: "ok" }));
                ok += 1;
            } catch (e) {
                setDone((d) => ({ ...d, [r.isbn]: formatApiError(e) }));
            }
        }
        setBusy(false);
        toast.success(`${ok} cover${ok === 1 ? "" : "s"} updated${ok < ready.length ? ` — ${ready.length - ok} failed (see the list)` : ""}.`);
        onDone();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" data-testid="bulk-covers">
            <div className="bg-white border border-[#002B5C] w-full max-w-3xl my-10 p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="overline">Covers by ISBN</div>
                        <p className="text-sm text-[#4B5563] mt-1">Choose cover images named by ISBN (e.g. <span className="font-mono">9789391032272.jpg</span>). Each is matched to its book, checked here, then set as its cover.</p>
                    </div>
                    <button type="button" aria-label="Close" onClick={onClose}><X size={18} /></button>
                </div>
                <label className="flex items-center gap-2 border-2 border-dashed border-[#E5E7EB] hover:border-[#002B5C] bg-[#F5F7FA] p-4 cursor-pointer text-sm text-[#002B5C]">
                    <ImagePlus size={18} /> {files.length ? `${files.length} file(s) chosen — choose again to replace` : "Choose cover files (you can select a whole folder's worth)"}
                    <input type="file" accept="image/*" multiple className="hidden" data-testid="bulk-covers-input"
                        onChange={(e) => { setFiles([...(e.target.files || [])]); setDone({}); }} />
                </label>
                {rows.length > 0 && (
                    <div className="max-h-[50vh] overflow-y-auto border border-[#E5E7EB]">
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-xs text-[#6B7280] bg-[#F9FAFB]"><th className="p-2">File</th><th>Book</th><th className="p-2">Status</th></tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.f.name} className="border-t border-[#F3F4F6] align-top">
                                        <td className="p-2 font-mono text-xs break-all">{r.f.name}</td>
                                        <td className="py-2 pr-2">{r.book ? r.book.title : <span className="text-[#9CA3AF]">—</span>}</td>
                                        <td className="p-2 text-xs whitespace-nowrap">
                                            {done[r.isbn] === "ok" ? <span className="text-[#15803D]">✓ updated</span>
                                                : done[r.isbn] ? <span className="text-[#CC0033]">{done[r.isbn]}</span>
                                                : r.problem ? <span className="text-[#B45309]">{r.problem}</span>
                                                : <span className="text-[#4B5563]">ready</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[#E5E7EB]">Close</button>
                    <button type="button" disabled={busy || !ready.length} onClick={go} data-testid="bulk-covers-go"
                        className="px-4 py-2 text-sm bg-[#002B5C] text-white disabled:opacity-40">
                        {busy ? "Uploading…" : `Set ${ready.length} cover${ready.length === 1 ? "" : "s"}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
