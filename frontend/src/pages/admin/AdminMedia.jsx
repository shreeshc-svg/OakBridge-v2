import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { UploadCloud, Trash2, Copy, ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import { toast } from "sonner";
import {
    adminListMedia,
    adminUploadMedia,
    adminDeleteMedia,
    fetchSiteContent,
    adminSetSiteContent,
    fetchCategories,
    adminUpdateCategoryImage,
    fetchCollection,
    adminSaveCollection,
    mediaUrl,
} from "../../lib/api";

export default function AdminMedia() {
    const [media, setMedia] = useState([]);
    const [cats, setCats] = useState([]);
    const [site, setSite] = useState({});
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef(null);

    const load = () => {
        adminListMedia().then(setMedia).catch(() => {});
        fetchCategories().then(setCats).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    };
    useEffect(load, []);

    const uploadFiles = async (fileList) => {
        const imgs = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return;
        setUploading(true);
        let ok = 0;
        for (const f of imgs) {
            try {
                const m = await adminUploadMedia(f);
                setMedia((prev) => [m, ...prev]);
                ok += 1;
            } catch {
                /* keep going */
            }
        }
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
        if (ok) toast.success(`${ok} image${ok > 1 ? "s" : ""} uploaded.`);
        else toast.error("Upload failed — object storage (S3) may not be configured yet.");
    };
    const onPick = (e) => uploadFiles(e.target.files);
    const onDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        uploadFiles(e.dataTransfer.files);
    };
    const onDelete = async (id) => {
        try {
            await adminDeleteMedia(id);
            setMedia((p) => p.filter((m) => m.id !== id));
            toast.success("Removed from library.");
        } catch {
            toast.error("Could not delete.");
        }
    };
    const copy = (u) => {
        navigator.clipboard?.writeText(mediaUrl(u));
        toast.success("URL copied to clipboard.");
    };
    const saveSite = async (key, value) => {
        await adminSetSiteContent(key, value);
        setSite((s) => ({ ...s, [key]: value }));
        toast.success("Saved — live on the site.");
    };
    const saveCat = async (id, image) => {
        await adminUpdateCategoryImage(id, image);
        setCats((cs) => cs.map((c) => (c.id === id ? { ...c, image } : c)));
        toast.success("Category image saved.");
    };

    return (
        <div data-testid="admin-media-page">
            <div className="overline">Content</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Media</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Master media library and site-wide image placements. Upload once, use anywhere —
                changes go live immediately.
            </p>

            {/* MASTER LIBRARY */}
            <section className="mt-10">
                <h2 className="font-serif text-2xl text-[#002B5C]">Media library ({media.length})</h2>
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    data-testid="media-dropzone"
                    className={`mt-4 border-2 border-dashed p-10 text-center transition-colors ${
                        dragOver ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#E5E7EB] bg-white"
                    }`}
                >
                    <UploadCloud size={28} strokeWidth={1.5} className="mx-auto text-[#4B5563]" />
                    <p className="mt-3 text-sm text-[#002B5C] font-medium">
                        {uploading ? "Uploading…" : "Drag & drop images here"}
                    </p>
                    <p className="text-xs text-[#4B5563] mt-1">
                        or{" "}
                        <label className="text-[#002B5C] border-b border-[#002B5C] cursor-pointer hover:text-[#CC0033]">
                            browse your files
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={onPick}
                                className="hidden"
                                data-testid="media-upload-input"
                            />
                        </label>
                    </p>
                    <p className="text-[11px] text-[#4B5563]/70 mt-2 font-mono">PNG · JPG · WEBP — up to 10 MB each</p>
                </div>

                {media.length > 0 && (
                    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {media.map((m) => (
                            <div key={m.id} data-testid={`media-${m.id}`} className="border border-[#E5E7EB] bg-white">
                                <div className="aspect-[4/3] bg-[#F5F7FA] overflow-hidden">
                                    <img src={mediaUrl(m.url)} alt={m.alt || m.filename} className="w-full h-full object-cover" loading="lazy" />
                                </div>
                                <div className="px-2 py-1.5">
                                    <div className="text-[11px] text-[#4B5563] truncate" title={m.filename}>{m.filename || "image"}</div>
                                    <div className="flex items-center justify-between gap-2 mt-1">
                                        <button onClick={() => copy(m.url)} className="inline-flex items-center gap-1 text-xs text-[#002B5C] hover:text-[#CC0033]">
                                            <Copy size={12} strokeWidth={1.5} /> Copy URL
                                        </button>
                                        <button onClick={() => onDelete(m.id)} className="text-[#CC0033] hover:opacity-70 p-1" aria-label="Delete">
                                            <Trash2 size={14} strokeWidth={1.5} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* PLACEMENTS BY PAGE */}
            <section className="mt-16 border-t border-[#E5E7EB] pt-12">
                <h2 className="font-serif text-2xl text-[#002B5C]">Place media on pages</h2>
                <p className="text-sm text-[#4B5563] mt-1 max-w-2xl">
                    Paste an image URL (copy one from the library above), or any external URL. Saves apply to the live storefront instantly.
                </p>

                <PageGroup title="Homepage" path="/">
                    <SlotRow label="Hero image" value={site.home_hero} onSave={(v) => saveSite("home_hero", v)} />
                </PageGroup>

                <PageGroup title="Bookstore — Product Listing (PLP)" path="/books">
                    <SlotRow label="Banner image" value={site.plp_banner} onSave={(v) => saveSite("plp_banner", v)} />
                    <div className="overline !text-[10px] mt-6 mb-2">Category images</div>
                    <div className="space-y-3">
                        {cats.map((c) => (
                            <SlotRow key={c.id} label={c.name} value={c.image} onSave={(v) => saveCat(c.id, v)} />
                        ))}
                    </div>
                </PageGroup>

                <PageGroup title="Book pages — Product Detail (PDP)" path="/books/:id">
                    <p className="text-sm text-[#4B5563]">
                        Each book's cover is set per title in{" "}
                        <Link to="/admin/books" className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]">Admin → Books</Link>.
                        Upload an image above, copy its URL, and paste it into the book's cover field.
                    </p>
                </PageGroup>

                <PageGroup title="What We Do" path="/what-we-do">
                    <div className="space-y-3">
                        <SlotRow label="Publishing" value={site["verticals_publishing"]} onSave={(v) => saveSite("verticals_publishing", v)} />
                        <SlotRow label="Events" value={site["verticals_events"]} onSave={(v) => saveSite("verticals_events", v)} />
                        <SlotRow label="Digital Solutions" value={site["verticals_digital-solutions"]} onSave={(v) => saveSite("verticals_digital-solutions", v)} />
                        <SlotRow label="Training & Certification" value={site["verticals_training"]} onSave={(v) => saveSite("verticals_training", v)} />
                    </div>
                </PageGroup>

                <PageGroup title="Solutions" path="/solutions/:slug">
                    <div className="space-y-3">
                        <SlotRow label="For Schools" value={site["solutions_schools"]} onSave={(v) => saveSite("solutions_schools", v)} />
                        <SlotRow label="For Colleges" value={site["solutions_higher-ed"]} onSave={(v) => saveSite("solutions_higher-ed", v)} />
                        <SlotRow label="For Educators" value={site["solutions_educators"]} onSave={(v) => saveSite("solutions_educators", v)} />
                    </div>
                </PageGroup>

                <PageGroup title="Events" path="/events">
                    <div className="overline !text-[10px] mb-2">Flagship banners (also power the rotating hero)</div>
                    <div className="space-y-3">
                        <SlotRow label="Vidhi Utsav banner" value={site["events_vidhi_banner"]} onSave={(v) => saveSite("events_vidhi_banner", v)} />
                        <SlotRow label="India Law, AI & Tech Summit banner" value={site["events_summit_banner"]} onSave={(v) => saveSite("events_summit_banner", v)} />
                    </div>
                    <CollectionEditor label="Vidhi Utsav speakers" collectionKey="events_vidhi_speakers" />
                    <CollectionEditor label="Summit speakers" collectionKey="events_summit_speakers" />
                </PageGroup>
            </section>
        </div>
    );
}

function PageGroup({ title, path, children }) {
    return (
        <div className="mt-8 border border-[#E5E7EB] bg-white p-6">
            <div className="flex items-baseline gap-3">
                <h3 className="font-serif text-xl text-[#002B5C]">{title}</h3>
                <span className="font-mono text-[11px] text-[#4B5563]">{path}</span>
            </div>
            <div className="mt-4">{children}</div>
        </div>
    );
}

function SlotRow({ label, value, onSave }) {
    const [val, setVal] = useState(value || "");
    const [saving, setSaving] = useState(false);
    useEffect(() => setVal(value || ""), [value]);
    const changed = (val || "") !== (value || "");
    const save = async () => {
        setSaving(true);
        try {
            await onSave((val || "").trim());
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="flex items-center gap-4 border border-[#E5E7EB] bg-white p-3">
            <div className="w-24 h-16 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden flex-shrink-0">
                {val ? <img src={mediaUrl(val)} alt="" className="w-full h-full object-cover" /> : null}
            </div>
            <div className="flex-1 min-w-0">
                <div className="overline !text-[10px]">{label}</div>
                <input
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    placeholder="Image URL"
                    className="mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                />
            </div>
            <button onClick={save} disabled={!changed || saving} className="text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] disabled:opacity-40 flex-shrink-0">
                {saving ? "…" : "Save"}
            </button>
        </div>
    );
}

const SPEAKER_FIELDS = [
    { key: "name", label: "Name" },
    { key: "role", label: "Role / title" },
    { key: "photo", label: "Photo URL" },
];

function CollectionEditor({ label, collectionKey }) {
    const [items, setItems] = useState([]);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        fetchCollection(collectionKey).then((d) => setItems(d.items || [])).catch(() => {});
    }, [collectionKey]);

    const update = (i, key, val) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
    const add = () => setItems((arr) => [...arr, { name: "", role: "", photo: "" }]);
    const remove = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));
    const move = (i, dir) =>
        setItems((arr) => {
            const j = i + dir;
            if (j < 0 || j >= arr.length) return arr;
            const copy = [...arr];
            [copy[i], copy[j]] = [copy[j], copy[i]];
            return copy;
        });
    const save = async () => {
        setSaving(true);
        try {
            await adminSaveCollection(collectionKey, items);
            toast.success(`${label} saved.`);
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between">
                <div className="overline !text-[10px]">{label} ({items.length})</div>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]">
                        <Plus size={12} strokeWidth={1.5} /> Add
                    </button>
                    <button onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">
                        {saving ? "…" : "Save all"}
                    </button>
                </div>
            </div>
            <div className="mt-3 space-y-3">
                {items.map((it, i) => (
                    <div key={i} className="flex items-start gap-3 border border-[#E5E7EB] bg-white p-3">
                        <div className="w-16 h-16 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden flex-shrink-0">
                            {it.photo ? <img src={mediaUrl(it.photo)} alt="" className="w-full h-full object-cover" /> : null}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                            {SPEAKER_FIELDS.map((f) => (
                                <input
                                    key={f.key}
                                    value={it[f.key] || ""}
                                    onChange={(e) => update(i, f.key, e.target.value)}
                                    placeholder={f.label}
                                    className="w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]"
                                />
                            ))}
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                            <button onClick={() => move(i, -1)} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA]" aria-label="Move up"><ArrowUp size={12} /></button>
                            <button onClick={() => move(i, 1)} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA]" aria-label="Move down"><ArrowDown size={12} /></button>
                            <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={12} /></button>
                        </div>
                    </div>
                ))}
                {items.length === 0 && <p className="text-sm text-[#4B5563]">No entries. Click "Add" to create one.</p>}
            </div>
        </div>
    );
}
