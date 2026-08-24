import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchSettings, mediaUrl,
    adminUploadBookPreview,
    adminRemoveBookPreview,
} from "../../lib/api";
import { Plus, Pencil, Trash2, X, FileUp, FileCheck2, Upload, ImagePlus, Trash, Sparkles, ArrowDownWideNarrow, UserCheck } from "lucide-react";
import {
    adminBulkDeleteBooks,
    adminBulkDraftAuthorBios,
    adminApplyReleaseOrder,
    adminRepairBookAuthors,
    adminBulkImportBooks,
    adminCreateBook,
    adminDeleteAllBooks,
    adminDeleteBook,
    adminDraftAuthorBio,
    adminRemoveEbook,
    adminUpdateBook,
    adminUploadCover,
    adminUploadEbook,
    API,
    fetchBooks,
    fetchCategories,
    formatApiError,
    formatINR,
} from "../../lib/api";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { canDelete } from "../../lib/rbac";

const BLANK = {
    title: "",
    subtitle: "",
    author: "",
    author_bio: "",
    author_photo: "",
    isbn: "",
    category: "academic",
    subject: "",
    grade: "",
    binding: "",
    size: "",
    description: "",
    price: 0,
    original_price: "",
    cover_image: "",
    pages: 100,
    publication_year: new Date().getFullYear(),
    bestseller: false,
    new_release: false,
    star_title: false,
    coming_soon: false,
    launch_at: "",
    coming_soon_label: "",
    ebook_url: "",
    ebook_price: "",
    stock: 100,
    variants: [],
};

function resolveImage(url) {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("/api/")) {
        return `${API.replace(/\/api$/, "")}${url}`;
    }
    return url;
}

function CoverUploader({ value, onChange, label = "Cover Image", testIdPrefix = "cover", aspect = "portrait" }) {
    const [uploading, setUploading] = useState(false);
    const inputRef = useRef(null);

    const handleFile = async (file) => {
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            toast.error("Please choose an image file.");
            return;
        }
        setUploading(true);
        try {
            const res = await adminUploadCover(file);
            onChange(res.url);
            toast.success(`${label} uploaded.`);
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setUploading(false);
        }
    };

    const onDrop = (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
    };

    const shownUrl = resolveImage(value);
    const previewBox = aspect === "square" ? "w-24 h-24" : "w-24 h-32";

    return (
        <div>
            <label className="overline !text-[10px] block mb-2">{label}</label>
            <div className="flex gap-4">
                <div
                    onDrop={onDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => inputRef.current?.click()}
                    data-testid={`${testIdPrefix}-dropzone`}
                    className="flex-1 border-2 border-dashed border-[#E5E7EB] hover:border-[#002B5C] bg-[#F5F7FA] p-6 text-center cursor-pointer transition-colors"
                >
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0])}
                        data-testid={`${testIdPrefix}-file-input`}
                    />
                    <ImagePlus size={24} strokeWidth={1.5} className="mx-auto text-[#4B5563]" />
                    <div className="mt-2 text-sm text-[#002B5C] font-medium">
                        {uploading ? "Uploading…" : "Drop image or click to upload"}
                    </div>
                    <div className="text-xs text-[#4B5563] mt-1">JPG, PNG or WebP — max 8 MB</div>
                </div>
                {shownUrl && (
                    <div className={`${previewBox} border border-[#E5E7EB] bg-white overflow-hidden flex-shrink-0`}>
                        <img src={shownUrl} alt={label} className="w-full h-full object-cover" />
                    </div>
                )}
            </div>
            <input
                type="text"
                value={value || ""}
                onChange={(e) => onChange(e.target.value)}
                placeholder="…or paste an image URL"
                data-testid={`${testIdPrefix}-url-input`}
                className="mt-3 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-xs outline-none focus:border-[#002B5C]"
            />
        </div>
    );
}

/**
 * Release order — what the "Newest" sort actually runs on.
 *
 * Ranks live in release_order.json, matched to books by ISBN, and that file is
 * a snapshot: every title added after it was generated matches nothing and
 * carries no rank, which sorts it behind all 251 that do. The book looks like
 * it never saved.
 *
 * Checked before it writes, always. This touches the order of the entire
 * catalogue, and "251 matched, 3 will be placed by year" is a sentence someone
 * can sanity-check in two seconds. Running it blind is not.
 */
function ReleaseOrderDialog({ onClose, onDone }) {
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);

    const run = async (dryRun) => {
        setBusy(true);
        try {
            const res = await adminApplyReleaseOrder(dryRun);
            setPreview(res);
            if (!dryRun) {
                toast.success(
                    `${res.updated} ranked from the master, ${res.fallback_ranked} placed by year.`,
                );
                onDone?.();
            }
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        run(true); // the check runs on open — there is nothing to configure first
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const Stat = ({ label, value, hint }) => (
        <div className="border border-[#E5E7EB] bg-white px-3 py-2">
            <div className="overline !text-[9px]">{label}</div>
            <div className="font-serif text-2xl text-[#002B5C]">{value}</div>
            {hint && <div className="text-[10px] text-[#4B5563] mt-0.5 leading-snug">{hint}</div>}
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
            <div
                data-testid="release-order-dialog"
                className="bg-white border border-[#002B5C] w-full max-w-2xl p-8 my-10"
            >
                <div className="overline">Catalogue order</div>
                <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">Release order</h2>
                <p className="text-sm text-[#4B5563] mt-3">
                    Sets which books count as new. The <strong>Newest</strong> sort and the
                    homepage <strong>Hot Off the Press</strong> row both run on this, and a title
                    without a place in it sorts behind every title that has one — however recently
                    it was published.
                </p>

                {!preview ? (
                    <p className="mt-6 font-mono text-xs text-[#4B5563]">Checking…</p>
                ) : (
                    <>
                        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Stat label="Books" value={preview.catalogue} />
                            <Stat
                                label="In the master"
                                value={preview.matched}
                                hint="Ranked by ISBN"
                            />
                            <Stat
                                label="Not in it"
                                value={preview.unmatched}
                                hint="Added since it was made"
                            />
                            <Stat
                                label="Placed by year"
                                value={
                                    preview.dry_run
                                        ? preview.would_fallback_rank
                                        : preview.fallback_ranked
                                }
                                hint="Slotted into their own year"
                            />
                        </div>

                        {preview.unmatched > 0 && (
                            <p className="text-[11px] text-[#4B5563] mt-3">
                                Not in the master:{" "}
                                {preview.unmatched_titles.map((t) => t.title).join(", ")}
                                {preview.unmatched > preview.unmatched_titles.length && " …"}
                            </p>
                        )}

                        {preview.top_new_arrivals_preview?.length > 0 && (
                            <div className="mt-5">
                                <div className="overline !text-[10px] mb-2">
                                    Newest first, after this runs
                                </div>
                                <ol className="border border-[#E5E7EB]">
                                    {preview.top_new_arrivals_preview.map((r) => (
                                        <li
                                            key={r.rank}
                                            className="flex gap-3 px-3 py-1.5 text-[12px] border-b border-[#E5E7EB] last:border-0"
                                        >
                                            <span className="font-mono text-[#4B5563] w-6">
                                                {r.rank}
                                            </span>
                                            <span className="font-mono text-[#4B5563] w-20">
                                                {r.date}
                                            </span>
                                            <span className="text-[#002B5C] flex-1">{r.title}</span>
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        )}
                    </>
                )}

                <div className="mt-7 flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-sm text-[#4B5563] hover:text-[#002B5C]"
                    >
                        Close
                    </button>
                    <button
                        onClick={() => run(false)}
                        disabled={busy || !preview}
                        data-testid="release-order-apply"
                        className="bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                    >
                        {busy ? "Working…" : "Apply"}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Author strings, back in line with the Title Master.
 *
 * The book documents hold a COPY of the author name made at import, and the
 * copy has drifted from the sheet the names are actually maintained in. Most of
 * the drift is cosmetic — "A and B" became "A & B" — but one is corrupting: the
 * master reads "Dr K K Khandelwal, IAS (R)", one man and his service, and the
 * book reads "Dr K K Khandelwal & IAS (R)", which reads as two authors, the
 * second of them named "IAS (R)".
 *
 * Matched on ISBN so a retitled book still lines up, and every change is listed
 * before anything is written.
 */
function RepairAuthorsDialog({ onClose, onDone }) {
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);

    const run = async (dryRun) => {
        setBusy(true);
        try {
            const res = await adminRepairBookAuthors(!dryRun);
            setPreview(res);
            if (!dryRun) {
                toast.success(`${res.changed} book(s) brought back in line with the master.`);
                onDone?.();
            }
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        run(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const n = preview ? (preview.dry_run ? preview.would_change : preview.changed) : 0;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
            <div
                data-testid="repair-authors-dialog"
                className="bg-white border border-[#002B5C] w-full max-w-2xl p-8 my-10"
            >
                <div className="overline">Catalogue data</div>
                <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">Author names</h2>
                <p className="text-sm text-[#4B5563] mt-3">
                    Rewrites each book&rsquo;s author line to match the Title Master, which is where
                    these names are maintained. Matched on ISBN. Nothing else on the book is touched.
                </p>

                {!preview ? (
                    <p className="mt-6 font-mono text-xs text-[#4B5563]">Checking…</p>
                ) : (
                    <>
                        <div className="mt-6 grid grid-cols-3 gap-2">
                            <div className="border border-[#E5E7EB] bg-white px-3 py-2">
                                <div className="overline !text-[9px]">Books</div>
                                <div className="font-serif text-2xl text-[#002B5C]">{preview.books}</div>
                            </div>
                            <div className="border border-[#E5E7EB] bg-white px-3 py-2">
                                <div className="overline !text-[9px]">Will change</div>
                                <div className="font-serif text-2xl text-[#002B5C]">{n}</div>
                            </div>
                            <div className="border border-[#E5E7EB] bg-white px-3 py-2">
                                <div className="overline !text-[9px]">Not in master</div>
                                <div className="font-serif text-2xl text-[#002B5C]">
                                    {preview.not_in_master}
                                </div>
                                <div className="text-[10px] text-[#4B5563] mt-0.5">Left alone</div>
                            </div>
                        </div>

                        {preview.changes?.length > 0 && (
                            <div className="mt-5 max-h-72 overflow-y-auto border border-[#E5E7EB]">
                                {preview.changes.map((c) => (
                                    <div
                                        key={c.id}
                                        className="px-3 py-2 text-[12px] border-b border-[#E5E7EB] last:border-0"
                                    >
                                        <div className="text-[#002B5C]">{c.title}</div>
                                        <div className="font-mono text-[11px] text-[#CC0033] mt-0.5">
                                            − {c.from}
                                        </div>
                                        <div className="font-mono text-[11px] text-[#3d9970]">
                                            + {c.to}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {n === 0 && (
                            <p className="mt-5 text-sm text-[#4B5563]">
                                Every book already matches the master. Nothing to do.
                            </p>
                        )}
                    </>
                )}

                <div className="mt-7 flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-sm text-[#4B5563] hover:text-[#002B5C]"
                    >
                        Close
                    </button>
                    <button
                        onClick={() => run(false)}
                        disabled={busy || !preview || n === 0}
                        data-testid="repair-authors-apply"
                        className="bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                    >
                        {busy ? "Working…" : `Apply${n ? ` to ${n}` : ""}`}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CsvImportDialog({ onClose, onDone }) {
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    const downloadTemplate = async () => {
        try {
            const token = localStorage.getItem("oakbridge_token");
            const res = await fetch(`${API}/admin/books/import-template`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error("Could not download template");
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "oakbridge-books-template.xlsx";
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(err.message || "Template download failed");
        }
    };

    const onImport = async () => {
        if (!file) return;
        setBusy(true);
        setResult(null);
        try {
            const res = await adminBulkImportBooks(file);
            setResult(res);
            toast.success(`Imported ${res.created} books`);
            onDone && onDone();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div data-testid="csv-import-dialog" className="bg-white border border-[#002B5C] w-full max-w-2xl p-8">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="overline">Bulk Import</div>
                        <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">
                            Import books from Excel / CSV
                        </h2>
                    </div>
                    <button onClick={onClose} data-testid="csv-close" className="p-2 hover:bg-[#F5F7FA]">
                        <X size={18} strokeWidth={1.5} />
                    </button>
                </div>

                <div className="mt-6 text-sm text-[#4B5563] space-y-2">
                    <p>
                        Upload an Excel (.xlsx) or CSV with these columns (<strong>required</strong>):{" "}
                        <code className="font-mono text-xs bg-[#F5F7FA] px-1">
                            title, author, isbn, category, subject, description, price, cover_image
                        </code>
                    </p>
                    <p>
                        Optional:{" "}
                        <code className="font-mono text-xs bg-[#F5F7FA] px-1">
                            subtitle, grade, pages, original_price, stock, bestseller, new_release, language, publisher, publication_year, rating
                        </code>
                    </p>
                </div>

                <div className="mt-6 flex gap-3">
                    <button
                        onClick={downloadTemplate}
                        data-testid="csv-template-download"
                        className="text-sm border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] flex items-center gap-2"
                    >
                        <FileUp size={14} strokeWidth={1.5} />
                        Download Excel template
                    </button>
                </div>

                <label className="mt-6 block border-2 border-dashed border-[#E5E7EB] hover:border-[#002B5C] bg-[#F5F7FA] p-8 text-center cursor-pointer transition-colors">
                    <input
                        type="file"
                        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="hidden"
                        onChange={(e) => setFile(e.target.files?.[0])}
                        data-testid="csv-file-input"
                    />
                    <Upload size={28} strokeWidth={1.5} className="mx-auto text-[#4B5563]" />
                    <div className="mt-2 text-sm text-[#002B5C] font-medium">
                        {file ? file.name : "Select an .xlsx or .csv file"}
                    </div>
                </label>

                {result && (
                    <div
                        data-testid="csv-result"
                        className="mt-6 border border-[#E5E7EB] bg-[#F5F7FA] p-4 text-sm max-h-60 overflow-y-auto"
                    >
                        <div className="font-serif text-lg text-[#002B5C]">
                            ✓ {result.created} created
                        </div>
                        {result.errors?.length > 0 && (
                            <div className="mt-2 text-[#CC0033]">
                                {result.errors.length} error{result.errors.length === 1 ? "" : "s"}:
                                <ul className="mt-1 list-disc pl-5 text-xs">
                                    {result.errors.slice(0, 10).map((e) => (
                                        <li key={`err-${e.row}-${e.error}`}>
                                            Row {e.row}: {e.error}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <div className="mt-8 flex justify-end gap-3">
                    <button onClick={onClose} className="px-6 py-3 text-sm border border-[#E5E7EB]">
                        Close
                    </button>
                    <button
                        onClick={onImport}
                        disabled={!file || busy}
                        data-testid="csv-import-submit"
                        className="px-8 py-3 text-sm bg-[#002B5C] text-white hover:bg-[#001F42] disabled:opacity-60"
                    >
                        {busy ? "Importing…" : "Import"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function PreviewManager({ bookId, pageCount, filename, onChange }) {
    // Removing an attached file is a DELETE; admin-only like the rest.
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);
    const [uploading, setUploading] = useState(false);
    const [count, setCount] = useState(pageCount || 0);
    const [currentName, setCurrentName] = useState(filename || "");

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            toast.error("Only PDF files are accepted");
            return;
        }
        setUploading(true);
        try {
            const res = await adminUploadBookPreview(bookId, file);
            toast.success(`Preview ready — ${res.pages} pages rendered.`);
            setCount(res.pages);
            setCurrentName(file.name);
            onChange && onChange();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setUploading(false);
            e.target.value = "";
        }
    };

    const onRemove = async () => {
        if (!window.confirm("Remove the 'Look inside' preview?")) return;
        try {
            await adminRemoveBookPreview(bookId);
            toast.success("Preview removed.");
            setCount(0);
            setCurrentName("");
            onChange && onChange();
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    return (
        <div data-testid="preview-manager" className="mt-6 border border-[#002B5C]/30 bg-[#F5F7FA] p-4">
            <div className="overline">“Look inside” preview (PDF)</div>
            <p className="text-[11px] text-[#4B5563] mt-1">
                Upload a sample PDF. Pages are rendered to images on upload, so the file itself is
                never downloadable from the site.
            </p>
            {count > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileCheck2 size={20} strokeWidth={1.5} className="text-[#002B5C]" />
                        <div className="truncate">
                            <div className="font-serif text-base text-[#002B5C] truncate">
                                {currentName || "preview.pdf"}
                            </div>
                            <div className="text-xs text-[#4B5563]">{count} pages live on the book page</div>
                        </div>
                    </div>
                    <label className="text-xs border border-[#002B5C] px-3 py-2 cursor-pointer hover:bg-white">
                        {uploading ? "Rendering…" : "Replace"}
                        <input type="file" accept="application/pdf,.pdf" onChange={onFile} className="hidden" />
                    </label>
                    {mayDelete && (
                        <button
                            type="button"
                            onClick={onRemove}
                            className="text-xs border border-[#E5E7EB] px-3 py-2 hover:bg-white text-[#CC0033]"
                        >
                            Remove
                        </button>
                    )}
                </div>
            ) : (
                <div className="mt-3">
                    <label className="inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-4 py-2 text-sm cursor-pointer hover:bg-[#001F42]">
                        <FileUp size={14} strokeWidth={1.5} />
                        {uploading ? "Rendering pages…" : "Upload preview PDF"}
                        <input type="file" accept="application/pdf,.pdf" onChange={onFile} className="hidden" />
                    </label>
                </div>
            )}
        </div>
    );
}

function EbookManager({ bookId, hasEbook, filename, onChange }) {
    // Removing an attached file is a DELETE; admin-only like the rest.
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);
    const [uploading, setUploading] = useState(false);
    const [currentHas, setCurrentHas] = useState(hasEbook);
    const [currentName, setCurrentName] = useState(filename || "");

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            toast.error("Only PDF files are accepted");
            return;
        }
        setUploading(true);
        try {
            await adminUploadEbook(bookId, file);
            toast.success("eBook uploaded.");
            setCurrentHas(true);
            setCurrentName(file.name);
            onChange && onChange();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setUploading(false);
            e.target.value = "";
        }
    };

    const onRemove = async () => {
        if (!window.confirm("Remove the attached eBook?")) return;
        try {
            await adminRemoveEbook(bookId);
            toast.success("eBook removed.");
            setCurrentHas(false);
            setCurrentName("");
            onChange && onChange();
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    return (
        <div
            data-testid="ebook-manager"
            className="mt-6 border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-4"
        >
            <div className="overline">eBook (PDF)</div>
            {currentHas ? (
                <div className="mt-3 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileCheck2 size={20} strokeWidth={1.5} className="text-[#F59E0B]" />
                        <div className="truncate">
                            <div className="font-serif text-base text-[#002B5C] truncate">
                                {currentName || "ebook.pdf"}
                            </div>
                            <div className="text-xs text-[#4B5563]">Attached</div>
                        </div>
                    </div>
                    <label className="text-xs border border-[#002B5C] px-3 py-2 cursor-pointer hover:bg-[#F5F7FA]">
                        Replace
                        <input
                            type="file"
                            accept="application/pdf,.pdf"
                            onChange={onFile}
                            className="hidden"
                            data-testid="ebook-replace-input"
                        />
                    </label>
                    {mayDelete && (
                        <button
                            type="button"
                            onClick={onRemove}
                            data-testid="ebook-remove-button"
                            className="text-xs border border-[#E5E7EB] px-3 py-2 hover:bg-[#F5F7FA] text-[#CC0033]"
                        >
                            Remove
                        </button>
                    )}
                </div>
            ) : (
                <div className="mt-3">
                    <label className="inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-4 py-2 text-sm cursor-pointer hover:bg-[#001F42]">
                        <FileUp size={14} strokeWidth={1.5} />
                        {uploading ? "Uploading…" : "Upload PDF"}
                        <input
                            type="file"
                            accept="application/pdf,.pdf"
                            onChange={onFile}
                            disabled={uploading}
                            className="hidden"
                            data-testid="ebook-upload-input"
                        />
                    </label>
                    <p className="mt-2 text-xs text-[#4B5563]">
                        Customers who purchase this title will be able to download the PDF from their account.
                    </p>
                </div>
            )}
        </div>
    );
}

function BookForm({ initial, categories, onClose, onSaved }) {
    const [form, setForm] = useState({ ...BLANK, ...(initial || {}) });
    const [vsettings, setVsettings] = useState(null);
    useEffect(() => {
        fetchSettings().then(setVsettings).catch(() => {});
    }, []);
    const bindingOpts = vsettings?.binding_options || ["Hardcover", "Softcover"];
    const sizeOpts = vsettings?.size_options || ["Demi", "Royal", "Crown"];
    const updateVariant = (i, key, val) =>
        setForm((f) => ({ ...f, variants: (f.variants || []).map((v, idx) => (idx === i ? { ...v, [key]: val } : v)) }));
    const removeVariant = (i) =>
        setForm((f) => ({ ...f, variants: (f.variants || []).filter((_, idx) => idx !== i) }));
    const [saving, setSaving] = useState(false);
    const [draftingBio, setDraftingBio] = useState(false);
    const isEdit = !!initial?.id;

    const onDraftBio = async () => {
        if (!isEdit) {
            toast.info("Save the book first, then draft a bio.");
            return;
        }
        setDraftingBio(true);
        try {
            const res = await adminDraftAuthorBio(initial.id);
            setForm((f) => ({ ...f, author_bio: res.author_bio }));
            toast.success("Bio drafted. Review & edit before saving.");
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setDraftingBio(false);
        }
    };

    const onChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm((f) => ({
            ...f,
            [name]: type === "checkbox" ? checked : value,
        }));
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                ...form,
                price: Number(form.price),
                original_price: form.original_price === "" ? null : Number(form.original_price),
                // null, not 0 — an empty field means "this title has no eBook
                // price", and 0 would read as a free eBook.
                ebook_price:
                    form.ebook_price === "" || form.ebook_price == null
                        ? null
                        : Number(form.ebook_price),
                pages: Number(form.pages),
                coming_soon: !!form.coming_soon,
                // Empty rather than a half-value: a flag with no date is treated
                // as not-a-pre-order everywhere, so it shows nothing rather than
                // a countdown to an invalid time.
                launch_at: (form.launch_at || "").trim() || null,
                coming_soon_label: (form.coming_soon_label || "").trim() || null,
                publication_year:
                    Number(form.publication_year) || new Date().getFullYear(),
                stock: Number(form.stock),
                variants: (form.variants || []).map((v) => ({
                    binding: v.binding || "",
                    size: v.size || "",
                    price: Number(v.price) || 0,
                    stock: v.stock === "" || v.stock == null ? null : Number(v.stock),
                })),
            };
            if (isEdit) {
                await adminUpdateBook(initial.id, payload);
                toast.success("Book updated.");
            } else {
                await adminCreateBook(payload);
                toast.success("Book created.");
            }
            onSaved();
            onClose();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
            <form
                onSubmit={onSubmit}
                data-testid="admin-book-form"
                className="bg-white border border-[#002B5C] w-full max-w-3xl p-8 my-10"
            >
                <div className="flex items-center justify-between">
                    <div>
                        <div className="overline">{isEdit ? "Edit Book" : "New Book"}</div>
                        <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">
                            {isEdit ? form.title || "Edit" : "Add a new title"}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        data-testid="book-form-close"
                        className="p-2 hover:bg-[#F5F7FA]"
                    >
                        <X size={18} strokeWidth={1.5} />
                    </button>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-4">
                    {[
                        ["title", "Title", "text", 2, true],
                        ["subtitle", "Subtitle", "text", 2, false],
                        ["author", "Author", "text", 1, true],
                        ["isbn", "ISBN", "text", 1, true],
                        ["subject", "Subject", "text", 1, true],
                        ["grade", "Grade / Level", "text", 1, false],
                        ["binding", "Binding (spec, optional)", "text", 1, false],
                        ["size", "Size (spec, optional)", "text", 1, false],
                        ["price", "Price (INR)", "number", 1, true],
                        ["original_price", "Original Price (optional)", "number", 1, false],
                        ["pages", "Pages", "number", 1, false],
                        // Shown on the book page under Specifications, and it
                        // decides where an unranked title lands under "Newest"
                        // — so it is worth getting right rather than leaving on
                        // the default.
                        ["publication_year", "Publication year", "number", 1, false],
                        ["stock", "Stock", "number", 1, false],
                    ].map(([name, label, type, col, req]) => (
                        <div key={name} className={col === 2 ? "col-span-2" : "col-span-2 sm:col-span-1"}>
                            <label className="overline !text-[10px] block mb-2">{label}</label>
                            <input
                                type={type}
                                name={name}
                                required={req}
                                value={form[name] ?? ""}
                                onChange={onChange}
                                data-testid={`book-form-${name}`}
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                    ))}
                    <div className="col-span-2">
                        <CoverUploader
                            value={form.cover_image}
                            onChange={(url) => setForm((f) => ({ ...f, cover_image: url }))}
                        />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                        <label className="overline !text-[10px] block mb-2">Category</label>
                        <select
                            name="category"
                            value={form.category}
                            onChange={onChange}
                            data-testid="book-form-category"
                            className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                        >
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="col-span-2">
                        <label className="overline !text-[10px] block mb-2">Description</label>
                        <textarea
                            name="description"
                            required
                            rows={4}
                            value={form.description}
                            onChange={onChange}
                            data-testid="book-form-description"
                            className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C] resize-none"
                        />
                    </div>
                    <div className="col-span-2 border-t border-[#E5E7EB] pt-6 mt-2">
                        <div className="overline mb-4">About the Author</div>
                        <div className="space-y-4">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="overline !text-[10px]">Author Bio</label>
                                    <button
                                        type="button"
                                        onClick={onDraftBio}
                                        disabled={draftingBio || !isEdit}
                                        title={isEdit ? "Draft a bio with AI" : "Save the book first, then draft a bio"}
                                        data-testid="book-form-draft-bio"
                                        className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest border border-[#F59E0B] text-[#002B5C] px-2 py-1 hover:bg-[#F59E0B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <Sparkles size={11} strokeWidth={1.75} className="text-[#F59E0B]" />
                                        {draftingBio ? "Drafting…" : "Draft with AI"}
                                    </button>
                                </div>
                                <textarea
                                    name="author_bio"
                                    rows={4}
                                    placeholder="A short paragraph about the author — affiliations, expertise, notable work. Shown on the book detail page."
                                    value={form.author_bio || ""}
                                    onChange={onChange}
                                    data-testid="book-form-author-bio"
                                    className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C] resize-none"
                                />
                            </div>
                            <CoverUploader
                                value={form.author_photo}
                                onChange={(url) => setForm((f) => ({ ...f, author_photo: url }))}
                                label="Author Photo"
                                testIdPrefix="author-photo"
                                aspect="square"
                            />
                        </div>
                    </div>
                    <div className="col-span-2 flex gap-6 text-sm">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                name="bestseller"
                                checked={!!form.bestseller}
                                onChange={onChange}
                                data-testid="book-form-bestseller"
                            />{" "}
                            Bestseller
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                name="new_release"
                                checked={!!form.new_release}
                                onChange={onChange}
                                data-testid="book-form-new-release"
                            />{" "}
                            New Release
                        </label>
                        {/* Unlike the other two this drives no carousel and no
                            filter. It only changes how the card is drawn — a
                            gold frame and a label, everywhere the book shows. */}
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                name="star_title"
                                checked={!!form.star_title}
                                onChange={onChange}
                                data-testid="book-form-star-title"
                            />{" "}
                            <span className="whitespace-nowrap">
                                Star Title
                                <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-[#4B5563]">
                                    gold frame
                                </span>
                            </span>
                        </label>
                    </div>

                    {/*
                     * Pre-order. Two fields that only matter together: the
                     * switch does nothing without a date, and the date does
                     * nothing without the switch, so they are shown as one
                     * block and the date only appears once it is ticked.
                     */}
                    <div className="col-span-2 border border-[#F59E0B]/40 bg-[#F59E0B]/[0.05] p-4">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="checkbox"
                                name="coming_soon"
                                checked={!!form.coming_soon}
                                onChange={onChange}
                                data-testid="book-form-coming-soon"
                                className="mt-0.5 accent-[#002B5C] w-4 h-4"
                            />
                            <span>
                                <span className="block text-sm font-medium text-[#002B5C]">
                                    Coming soon — take pre-orders
                                </span>
                                <span className="block text-[11px] text-[#4B5563] mt-0.5">
                                    Shows a band on the cover and a countdown, and turns Add to
                                    Cart into Pre-order. Customers are charged today and the book
                                    despatches on publication day. Stock is ignored, so the title
                                    sells even at zero.
                                </span>
                            </span>
                        </label>

                        {form.coming_soon && (
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="overline !text-[10px] block mb-2">
                                        Publication day
                                    </label>
                                    <input
                                        type="datetime-local"
                                        name="launch_at"
                                        value={(form.launch_at || "").slice(0, 16)}
                                        onChange={onChange}
                                        data-testid="book-form-launch-at"
                                        className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                    <div className="text-[11px] text-[#4B5563] mt-1">
                                        The countdown ends here, and the band and timer disappear
                                        on their own — nothing to switch off afterwards.
                                    </div>
                                </div>
                                <div>
                                    <label className="overline !text-[10px] block mb-2">
                                        Band text
                                    </label>
                                    <input
                                        type="text"
                                        name="coming_soon_label"
                                        value={form.coming_soon_label || ""}
                                        onChange={onChange}
                                        placeholder="Coming soon"
                                        data-testid="book-form-coming-soon-label"
                                        className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                    />
                                    <div className="text-[11px] text-[#4B5563] mt-1">
                                        Blank shows &ldquo;Coming soon&rdquo;. Keep it short — it
                                        sits across the top of the cover.
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Per title, because only some titles are on the reader.
                        Everything else about the eBook mark — the wording, the
                        button, whether it shows on listings or product pages at
                        all — is in Admin → E-Books. This is just the address. */}
                    <div className="col-span-2">
                        <label className="block text-sm text-[#4B5563]">
                            eBook edition — link on the Oakbridge eReader
                            <input
                                name="ebook_url"
                                value={form.ebook_url || ""}
                                onChange={onChange}
                                placeholder="https://ebooks.oakbridge.in/… — leave blank if this title isn't on the reader"
                                data-testid="book-form-ebook-url"
                                className="mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </label>
                        <p className="text-[11px] text-[#4B5563] mt-1">
                            Add an address and this book shows an eBook link in the bookstore and a
                            Read button on its page. Clear it and both disappear. Bulk-settable via
                            the <span className="font-mono">ebook_url</span> column in the CSV
                            importer.
                        </p>
                    </div>

                    <div className="col-span-2">
                        <label className="block text-sm text-[#4B5563]">
                            eBook price — before GST
                            <input
                                name="ebook_price"
                                type="number"
                                step="0.01"
                                min="0"
                                value={form.ebook_price ?? ""}
                                onChange={onChange}
                                placeholder="e.g. 466 — the site adds GST and shows ₹489"
                                data-testid="book-form-ebook-price"
                                className="mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </label>
                        <p className="text-[11px] text-[#4B5563] mt-1">
                            Shown beside the print price, but only once the price display is
                            switched on in Admin → E-Books and this title has a link above. For many
                            titles at once, upload a price list there instead of typing them here.
                        </p>
                    </div>
                </div>

                {/* Preview + eBook management — only for existing books */}
                {isEdit && (
                    <>
                        <PreviewManager
                            bookId={initial.id}
                            pageCount={(initial.preview_paths || []).length}
                            filename={initial.preview_filename}
                        />
                        <EbookManager
                            bookId={initial.id}
                            hasEbook={!!initial.has_ebook || !!initial.ebook_filename}
                            filename={initial.ebook_filename}
                            onChange={() => onSaved()}
                        />
                    </>
                )}

                <div className="mt-8 border-t border-[#E5E7EB] pt-6">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="overline">Price matrix (optional)</div>
                            <p className="text-xs text-[#4B5563] mt-1">
                                Binding &times; size variants with their own price. Leave empty to sell at the single price above.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() =>
                                setForm((f) => ({
                                    ...f,
                                    variants: [
                                        ...(f.variants || []),
                                        { binding: bindingOpts[0] || "", size: sizeOpts[0] || "", price: form.price, stock: "" },
                                    ],
                                }))
                            }
                            data-testid="add-variant"
                            className="text-xs border border-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA] whitespace-nowrap"
                        >
                            + Add variant
                        </button>
                    </div>
                    {(form.variants || []).length > 0 && (
                        <div className="mt-4 space-y-2">
                            {(form.variants || []).map((v, i) => (
                                <div key={i} className="flex flex-wrap items-center gap-2">
                                    <select value={v.binding || ""} onChange={(e) => updateVariant(i, "binding", e.target.value)} className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm">
                                        <option value="">Binding…</option>
                                        {bindingOpts.map((b) => (<option key={b} value={b}>{b}</option>))}
                                    </select>
                                    <select value={v.size || ""} onChange={(e) => updateVariant(i, "size", e.target.value)} className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm">
                                        <option value="">Size…</option>
                                        {sizeOpts.map((sz) => (<option key={sz} value={sz}>{sz}</option>))}
                                    </select>
                                    <input type="number" value={v.price} onChange={(e) => updateVariant(i, "price", e.target.value)} placeholder="Price" className="w-28 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm" />
                                    <input type="number" value={v.stock ?? ""} onChange={(e) => updateVariant(i, "stock", e.target.value)} placeholder="Stock" className="w-24 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm" />
                                    <button type="button" onClick={() => removeVariant(i)} className="text-[#CC0033] border border-[#CC0033] px-2 py-1.5 text-xs">Remove</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-3 text-sm border border-[#E5E7EB]"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        data-testid="book-form-save"
                        className="px-8 py-3 text-sm bg-[#002B5C] text-[#FFFFFF] hover:bg-[#001F42] disabled:opacity-60"
                    >
                        {saving ? "Saving…" : isEdit ? "Save changes" : "Create book"}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default function AdminBooks() {
    const [books, setBooks] = useState([]);
    const [cats, setCats] = useState([]);
    const [editing, setEditing] = useState(null); // object or "new"
    const [csvOpen, setCsvOpen] = useState(false);
    const [releaseOrderOpen, setReleaseOrderOpen] = useState(false);
    const [repairAuthorsOpen, setRepairAuthorsOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [catFilter, setCatFilter] = useState("all");
    const [sort, setSort] = useState("newest");
    const [selected, setSelected] = useState(() => new Set());
    const [deleteAllOpen, setDeleteAllOpen] = useState(false);
    const [bulkDraftingBios, setBulkDraftingBios] = useState(false);

    // Deleting is admin-only; the server refuses it either way, this just
    // keeps a button off the screen that would only say no.
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);

    const load = () => {
        setLoading(true);
        fetchBooks({ limit: 500 })
            .then((list) => {
                setBooks(list);
                setSelected(new Set());
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchCategories().then(setCats);
        load();
    }, []);

    const onDelete = async (id, title) => {
        if (!window.confirm(`Delete "${title}"?`)) return;
        try {
            await adminDeleteBook(id);
            toast.success("Book deleted.");
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const toggleOne = (id) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const togglePage = (rows) => {
        setSelected((prev) => {
            const allSelected = rows.every((r) => prev.has(r.id));
            const next = new Set(prev);
            if (allSelected) rows.forEach((r) => next.delete(r.id));
            else rows.forEach((r) => next.add(r.id));
            return next;
        });
    };

    const onBulkDelete = async () => {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        if (!window.confirm(`Delete ${ids.length} selected book${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
        try {
            const res = await adminBulkDeleteBooks(ids);
            toast.success(`Deleted ${res.deleted} book${res.deleted === 1 ? "" : "s"}.`);
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const onBulkDraftBios = async () => {
        const missing = books.filter((b) => !b.author_bio).length;
        if (missing === 0) {
            toast.info("Every book already has an author bio.");
            return;
        }
        if (!window.confirm(`Draft AI bios for ${missing} book${missing === 1 ? "" : "s"} missing one? This usually takes a couple of minutes.`)) return;
        setBulkDraftingBios(true);
        toast.info(`Drafting bios for ${missing} books — this runs in the background. You can keep using the dashboard.`);
        try {
            const res = await adminBulkDraftAuthorBios(false);
            toast.success(`Done — ${res.drafted} bios drafted, ${res.failed} failed.`);
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBulkDraftingBios(false);
        }
    };

    const bookCats = useMemo(
        () => Array.from(new Set(books.map((b) => b.category).filter(Boolean))).sort(),
        [books],
    );
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        let a = books.filter(
            (b) =>
                !needle ||
                (b.title || "").toLowerCase().includes(needle) ||
                (b.author || "").toLowerCase().includes(needle) ||
                (b.isbn || "").includes(query.trim()),
        );
        if (catFilter !== "all") a = a.filter((b) => b.category === catFilter);
        const t = (b) => new Date(b.created_at || 0).getTime();
        a = [...a].sort((x, y) => {
            if (sort === "title") return (x.title || "").localeCompare(y.title || "");
            if (sort === "price_asc") return (x.price || 0) - (y.price || 0);
            if (sort === "price_desc") return (y.price || 0) - (x.price || 0);
            if (sort === "stock") return (x.stock || 0) - (y.stock || 0);
            return t(y) - t(x);
        });
        return a;
    }, [books, query, catFilter, sort]);

    const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

    return (
        <div data-testid="admin-books-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Catalogue</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                        Books ({books.length})
                    </h1>
                </div>
                <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                    <input
                        placeholder="Search title / author / ISBN"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        data-testid="admin-books-search"
                        className="border border-[#E5E7EB] bg-white px-4 py-2 text-sm w-full sm:w-72 outline-none focus:border-[#002B5C]"
                    />
                    <select
                        value={catFilter}
                        onChange={(e) => setCatFilter(e.target.value)}
                        data-testid="admin-books-category"
                        className="border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                    >
                        <option value="all">All categories</option>
                        {bookCats.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                    <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                        data-testid="admin-books-sort"
                        className="border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                    >
                        <option value="newest">Newest</option>
                        <option value="title">Title A–Z</option>
                        <option value="price_asc">Price: low → high</option>
                        <option value="price_desc">Price: high → low</option>
                        <option value="stock">Stock: low → high</option>
                    </select>
                    <button
                        onClick={() => setCsvOpen(true)}
                        data-testid="admin-import-csv-button"
                        className="inline-flex items-center gap-2 border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm hover:bg-[#F5F7FA]"
                    >
                        <Upload size={14} strokeWidth={1.5} /> Import CSV
                    </button>
                    <button
                        onClick={() => setReleaseOrderOpen(true)}
                        data-testid="admin-release-order-button"
                        title="Fix which books count as new — the Newest sort runs on this"
                        className="inline-flex items-center gap-2 border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm hover:bg-[#F5F7FA]"
                    >
                        <ArrowDownWideNarrow size={14} strokeWidth={1.5} /> Release order
                    </button>
                    <button
                        onClick={() => setRepairAuthorsOpen(true)}
                        data-testid="admin-repair-authors-button"
                        title="Bring book author lines back in line with the Title Master"
                        className="inline-flex items-center gap-2 border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm hover:bg-[#F5F7FA]"
                    >
                        <UserCheck size={14} strokeWidth={1.5} /> Author names
                    </button>
                    <button
                        onClick={onBulkDraftBios}
                        disabled={bulkDraftingBios}
                        data-testid="admin-bulk-draft-bios-button"
                        title="AI-draft author bios for every book missing one"
                        className="inline-flex items-center gap-2 border border-[#F59E0B] text-[#002B5C] px-4 py-2 text-sm hover:bg-[#F59E0B] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Sparkles size={14} strokeWidth={1.5} className="text-[#F59E0B]" />
                        {bulkDraftingBios ? "Drafting…" : "Draft missing bios"}
                    </button>
                    <button
                        onClick={() => setDeleteAllOpen(true)}
                        data-testid="admin-delete-all-button"
                        className="inline-flex items-center gap-2 border border-[#CC0033] text-[#CC0033] px-4 py-2 text-sm hover:bg-[#CC0033]/5"
                    >
                        <Trash size={14} strokeWidth={1.5} /> Delete all
                    </button>
                    <button
                        onClick={() => setEditing("new")}
                        data-testid="admin-new-book-button"
                        className="inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-4 py-2 text-sm hover:bg-[#001F42]"
                    >
                        <Plus size={14} strokeWidth={1.5} /> New Book
                    </button>
                </div>
            </div>

            {selected.size > 0 && (
                <div
                    data-testid="admin-bulk-actions-bar"
                    className="mt-6 flex items-center justify-between bg-[#002B5C] text-white px-4 py-3 text-sm"
                >
                    <div>
                        <span data-testid="admin-selected-count" className="font-mono">{selected.size}</span> selected
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setSelected(new Set())}
                            className="text-xs text-white/80 hover:text-white px-3 py-1"
                        >
                            Clear
                        </button>
                        <button
                            onClick={onBulkDelete}
                            data-testid="admin-bulk-delete-button"
                            className="inline-flex items-center gap-2 bg-[#CC0033] hover:bg-[#A80029] px-4 py-2 text-xs uppercase tracking-wider"
                        >
                            <Trash2 size={12} strokeWidth={1.5} /> Delete selected
                        </button>
                    </div>
                </div>
            )}

            <div className="mt-8 bg-white border border-[#E5E7EB] overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-[#F5F7FA] text-[10px] font-mono uppercase tracking-widest text-[#4B5563]">
                        <tr>
                            <th className="px-4 py-3 w-10">
                                <input
                                    type="checkbox"
                                    checked={allFilteredSelected}
                                    onChange={() => togglePage(filtered)}
                                    data-testid="admin-books-select-all"
                                    className="h-4 w-4 cursor-pointer accent-[#002B5C]"
                                />
                            </th>
                            <th className="text-left px-4 py-3">Title</th>
                            <th className="text-left px-4 py-3">Author</th>
                            <th className="text-left px-4 py-3">Category</th>
                            <th className="text-right px-4 py-3">Price</th>
                            <th className="text-right px-4 py-3">Stock</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={7} className="px-4 py-10 text-center text-[#4B5563]">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {filtered.map((b) => (
                            <tr
                                key={b.id}
                                data-testid={`admin-book-row-${b.id}`}
                                className="border-t border-[#E5E7EB] hover:bg-[#F5F7FA]/40"
                            >
                                <td className="px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(b.id)}
                                        onChange={() => toggleOne(b.id)}
                                        data-testid={`admin-book-select-${b.id}`}
                                        className="h-4 w-4 cursor-pointer accent-[#002B5C]"
                                    />
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={mediaUrl(b.cover_image)}
                                            alt=""
                                            className="w-8 h-12 object-cover border border-[#E5E7EB]"
                                        />
                                        <div>
                                            <div className="font-serif text-base text-[#002B5C]">
                                                {b.title}
                                            </div>
                                            <div className="font-mono text-[10px] text-[#4B5563]">
                                                {b.isbn}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-[#4B5563]">{b.author}</td>
                                <td className="px-4 py-3 text-[#4B5563]">{b.category}</td>
                                <td className="px-4 py-3 text-right font-mono text-[#002B5C]">
                                    {formatINR(b.price)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-[#4B5563]">
                                    {b.stock}
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <button
                                        onClick={() => setEditing(b)}
                                        data-testid={`admin-edit-book-${b.id}`}
                                        className="inline-flex items-center gap-1 text-xs px-2 py-1 hover:bg-[#F5F7FA] mr-1"
                                    >
                                        <Pencil size={12} strokeWidth={1.5} /> Edit
                                    </button>
                                    {mayDelete && (
                                        <button
                                            onClick={() => onDelete(b.id, b.title)}
                                            data-testid={`admin-delete-book-${b.id}`}
                                            className="inline-flex items-center gap-1 text-xs px-2 py-1 hover:bg-[#F5F7FA] text-[#CC0033]"
                                        >
                                            <Trash2 size={12} strokeWidth={1.5} /> Delete
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {editing && (
                <BookForm
                    initial={editing === "new" ? null : editing}
                    categories={cats}
                    onClose={() => setEditing(null)}
                    onSaved={load}
                />
            )}
            {repairAuthorsOpen && (
                <RepairAuthorsDialog
                    onClose={() => setRepairAuthorsOpen(false)}
                    onDone={load}
                />
            )}
            {releaseOrderOpen && (
                <ReleaseOrderDialog
                    onClose={() => setReleaseOrderOpen(false)}
                    onDone={load}
                />
            )}
            {csvOpen && (
                <CsvImportDialog
                    onClose={() => setCsvOpen(false)}
                    onDone={load}
                />
            )}
            {deleteAllOpen && (
                <DeleteAllDialog
                    count={books.length}
                    onClose={() => setDeleteAllOpen(false)}
                    onDone={load}
                />
            )}
        </div>
    );
}

function DeleteAllDialog({ count, onClose, onDone }) {
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const CONFIRM_TEXT = "DELETE ALL";

    const onConfirm = async () => {
        if (confirm !== CONFIRM_TEXT) return;
        setBusy(true);
        try {
            const res = await adminDeleteAllBooks(CONFIRM_TEXT);
            toast.success(`Deleted all ${res.deleted} books.`);
            onDone && onDone();
            onClose();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div
                data-testid="admin-delete-all-dialog"
                className="bg-white border-t-4 border-[#CC0033] w-full max-w-lg p-8"
            >
                <div className="flex items-start justify-between">
                    <div>
                        <div className="overline !text-[#CC0033]">Destructive action</div>
                        <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">
                            Delete every book?
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[#F5F7FA]">
                        <X size={18} strokeWidth={1.5} />
                    </button>
                </div>

                <p className="mt-6 text-sm text-[#4B5563]">
                    This will permanently remove <strong>all {count} books</strong> from the catalogue.
                    Orders, reviews and desk-copy records are <strong>not</strong> affected, but any
                    references to these books will become broken. This cannot be undone.
                </p>

                <label className="block mt-6">
                    <span className="overline !text-[10px] block mb-2">
                        Type <code className="font-mono text-[#CC0033]">{CONFIRM_TEXT}</code> to confirm
                    </span>
                    <input
                        type="text"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        data-testid="admin-delete-all-confirm-input"
                        className="w-full border border-[#E5E7EB] px-4 py-3 text-sm outline-none focus:border-[#CC0033] font-mono"
                    />
                </label>

                <div className="mt-8 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 text-sm border border-[#E5E7EB]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={confirm !== CONFIRM_TEXT || busy}
                        data-testid="admin-delete-all-confirm-button"
                        className="px-8 py-3 text-sm bg-[#CC0033] text-white hover:bg-[#A80029] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {busy ? "Deleting…" : "Delete all books"}
                    </button>
                </div>
            </div>
        </div>
    );
}
