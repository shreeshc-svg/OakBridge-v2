import React, { useEffect, useRef, useState } from "react";
import { UploadCloud, ArrowUp, ArrowDown, X, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
    fetchCollection,
    adminSaveCollection,
    adminUploadMedia,
    adminImportStoreLinks,
    mediaUrl,
} from "../../lib/api";

/**
 * Admin → Pages → Homepage → "Available on" stores.
 *
 * One list drives two things:
 *  - the homepage logo strip (StoreStrip) — logos only, no links;
 *  - the "Also available on" buttons on each book page, which use the store
 *    `id` to look up that book's link in book.store_links.
 *
 * So the `id` is a stable key, not a label: renaming "Amazon" to "Amazon.in"
 * changes only the name, while changing the id would orphan every book link
 * stored under the old one — hence the warning under the field.
 *
 * Logos are the stores' official artwork uploaded here (drag-drop or click);
 * nothing is drawn by us. An entry without a logo is skipped by the strip but
 * still shows as a text button on book pages.
 *
 * Reorder by dragging the grip, or the arrows (keyboard / touch screens,
 * where HTML5 drag does not fire).
 */

// Same rule the backend uses for store_links keys (extensions.clean_store_links):
// lowercase a–z, 0–9 and hyphens, 2–30 chars.
export const slugStoreId = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30);

const INPUT = "border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]";

export default function StoresEditor() {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    const [dragFrom, setDragFrom] = useState(null);
    const [preview, setPreview] = useState(null);
    const [importing, setImporting] = useState(false);
    const fileRef = useRef(null);
    const pendingFile = useRef(null);

    useEffect(() => {
        fetchCollection("home_stores")
            .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
            .catch(() => setItems([]));
    }, []);
    if (!items) return null;

    const update = (i, key, val) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
    const moveTo = (from, to) =>
        setItems((arr) => {
            if (to < 0 || to >= arr.length || from === to) return arr;
            const c = [...arr];
            const [x] = c.splice(from, 1);
            c.splice(to, 0, x);
            return c;
        });
    const add = () => setItems((arr) => [...arr, { id: "", name: "", logo: "", alt: "", enabled: true }]);
    const remove = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));

    const uploadLogo = async (i, fileList) => {
        const file = Array.from(fileList || []).find((x) => x.type.startsWith("image/"));
        if (!file) return;
        try {
            const m = await adminUploadMedia(file, items[i]?.alt || items[i]?.name || "");
            update(i, "logo", m.url);
            toast.success("Logo uploaded — click Save stores to publish.");
        } catch {
            toast.error("Upload failed — object storage (S3) may not be configured.");
        }
    };

    const save = async () => {
        // Fill a missing id from the name, then refuse blanks and duplicates:
        // two stores with one id would share every book's link.
        const clean = items.map((it) => ({
            ...it,
            name: String(it.name || "").trim(),
            id: slugStoreId(it.id || it.name),
            alt: String(it.alt || "").trim(),
            enabled: it.enabled !== false,
        }));
        const bad = clean.find((it) => !it.name || it.id.length < 2);
        if (bad) {
            toast.error("Every store needs a name (and an id of at least 2 letters).");
            return;
        }
        const ids = clean.map((it) => it.id);
        const dup = ids.find((id, k) => ids.indexOf(id) !== k);
        if (dup) {
            toast.error(`Two stores share the id "${dup}" — make each id unique.`);
            return;
        }
        setSaving(true);
        try {
            await adminSaveCollection("home_stores", clean);
            setItems(clean);
            toast.success("Stores saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    // Import: always a dry run first; the admin sees the counts and confirms
    // before anything is written.
    const runImport = async (file, dryRun) => {
        if (!file) return;
        setImporting(true);
        try {
            const r = await adminImportStoreLinks(file, dryRun);
            if (dryRun) {
                pendingFile.current = file;
                setPreview(r);
            } else {
                pendingFile.current = null;
                setPreview(null);
                toast.success(`Store links saved on ${r.books_updated} book(s).`);
            }
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Import failed.");
        } finally {
            setImporting(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    return (
        <div className="border border-[#E5E7EB] bg-[#F5F7FA] p-4 mb-2" data-testid="stores-editor">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <div className="font-serif text-lg text-[#002B5C]">“Available on” stores ({items.length})</div>
                    <p className="text-[11px] text-[#4B5563] mt-0.5 max-w-xl">
                        Logos for the homepage strip (logos only, no links) and the “Also available on” buttons on
                        book pages. Upload each store's official logo — a transparent PNG or SVG works best. A store
                        without a logo is left out of the strip. Move or hide the strip in “Section order &amp; visibility”.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] bg-white px-3 py-1 hover:bg-[#F5F7FA]">
                        <Plus size={12} strokeWidth={1.5} /> Add store
                    </button>
                    <button onClick={save} disabled={saving} data-testid="stores-save" className="text-xs font-medium border border-[#002B5C] bg-white px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">
                        {saving ? "…" : "Save stores"}
                    </button>
                </div>
            </div>

            <div className="mt-4 space-y-2">
                {items.map((it, i) => (
                    <div
                        key={i}
                        draggable
                        onDragStart={() => setDragFrom(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            // A dropped FILE is a logo upload (handled by the
                            // logo tile); only a dragged ROW reorders.
                            e.preventDefault(); // never let the browser open a stray dropped file
                            if (dragFrom === null) return;
                            moveTo(dragFrom, i);
                            setDragFrom(null);
                        }}
                        onDragEnd={() => setDragFrom(null)}
                        className={`border bg-white p-3 flex flex-wrap items-center gap-3 ${dragFrom === i ? "border-[#002B5C] opacity-60" : "border-[#E5E7EB]"}`}
                    >
                        <GripVertical size={14} className="text-[#4B5563] cursor-grab" aria-hidden="true" />
                        <label
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                if (!e.dataTransfer.files?.length) return;
                                e.preventDefault();
                                e.stopPropagation();
                                uploadLogo(i, e.dataTransfer.files);
                            }}
                            title="Drag & drop or click to upload the logo"
                            className="w-28 h-12 bg-[#F5F7FA] border border-dashed border-[#E5E7EB] flex-shrink-0 cursor-pointer flex items-center justify-center"
                        >
                            {it.logo
                                ? <img src={mediaUrl(it.logo)} alt="" className="max-h-10 max-w-[100px] object-contain" />
                                : <UploadCloud size={16} strokeWidth={1.5} className="text-[#4B5563]" />}
                            <input type="file" accept="image/*" onChange={(e) => uploadLogo(i, e.target.files)} className="hidden" />
                        </label>
                        <div className="flex-1 min-w-[200px] grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input value={it.name || ""} onChange={(e) => update(i, "name", e.target.value)} placeholder="Name (e.g. Amazon)" aria-label="Store name" className={INPUT} />
                            <div>
                                <input
                                    value={it.id || ""}
                                    onChange={(e) => update(i, "id", slugStoreId(e.target.value))}
                                    placeholder="id (e.g. amazon)"
                                    aria-label="Store id"
                                    className={`${INPUT} w-full font-mono`}
                                />
                            </div>
                            <input value={it.alt || ""} onChange={(e) => update(i, "alt", e.target.value)} placeholder="Logo description (screen readers)" aria-label="Logo description" className={INPUT} />
                        </div>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input type="checkbox" checked={it.enabled !== false} onChange={(e) => update(i, "enabled", e.target.checked)} />
                            Show
                        </label>
                        <div className="flex gap-1">
                            <button onClick={() => moveTo(i, i - 1)} disabled={i === 0} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={12} /></button>
                            <button onClick={() => moveTo(i, i + 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={12} /></button>
                            <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={12} /></button>
                        </div>
                    </div>
                ))}
            </div>
            <p className="text-[11px] text-[#4B5563] mt-2">
                The id links a store to each book's link (Admin → Books → Store links). Changing an id after links
                are saved disconnects those links.
            </p>

            <div className="mt-5 border-t border-[#E5E7EB] pt-4">
                <div className="overline !text-[10px]">Book links in bulk</div>
                <p className="text-[11px] text-[#4B5563] mt-1 max-w-2xl">
                    Upload a CSV or Excel sheet with an <b>ISBN</b> column and one column per store, headed with the
                    store's name or id (e.g. Amazon, Flipkart, Kindle). Only https links are taken; empty cells leave a
                    book's link unchanged. You will see a preview before anything is saved.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".csv,.xlsx"
                        disabled={importing}
                        onChange={(e) => runImport(e.target.files?.[0], true)}
                        data-testid="store-links-file"
                        className="text-xs"
                    />
                    {importing && <span className="text-xs text-[#4B5563]">Reading…</span>}
                </div>
                {preview && (
                    <div className="mt-3 border border-[#E5E7EB] bg-white p-3 text-sm" data-testid="store-links-preview">
                        <div>
                            <b>{preview.books_updated}</b> book(s) will change · <b>{preview.links_set}</b> link(s) set
                            {preview.rejected_links ? <> · <span className="text-[#CC0033]">{preview.rejected_links} rejected (not https)</span></> : null}
                        </div>
                        <div className="text-xs text-[#4B5563] mt-1">
                            Columns used: {Object.entries(preview.store_columns || {}).map(([c, id]) => `${c} → ${id}`).join(", ")}
                        </div>
                        {preview.unknown_count > 0 && (
                            <div className="text-xs text-[#CC0033] mt-1">
                                {preview.unknown_count} ISBN(s) not found in the catalogue: {(preview.unknown_isbns || []).slice(0, 10).join(", ")}
                                {preview.unknown_count > 10 ? "…" : ""}
                            </div>
                        )}
                        <div className="mt-3 flex gap-2">
                            <button
                                onClick={() => runImport(pendingFile.current, false)}
                                disabled={importing || !preview.books_updated}
                                data-testid="store-links-apply"
                                className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40"
                            >
                                Save these links
                            </button>
                            <button onClick={() => { setPreview(null); pendingFile.current = null; }} className="text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]">
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
