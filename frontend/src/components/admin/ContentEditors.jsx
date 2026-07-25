import React, { useEffect, useRef, useState } from "react";
import { UploadCloud, ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { adminUploadMedia, fetchCollection, adminSaveCollection, mediaUrl } from "../../lib/api";

// Slug used as the anchor id so the tab bar can jump to each group.
export const pageGroupId = (title) =>
    "pg-" + String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function PageGroup({ title, path, children }) {
    return (
        <div id={pageGroupId(title)} className="mt-8 border border-[#E5E7EB] bg-white p-6 scroll-mt-24">
            <div className="flex items-baseline gap-3">
                <h3 className="font-serif text-xl text-[#002B5C]">{title}</h3>
                <span className="font-mono text-[11px] text-[#4B5563]">{path}</span>
            </div>
            <div className="mt-4">{children}</div>
        </div>
    );
}

export function SlotRow({ label, value, onSave }) {
    const [val, setVal] = useState(value || "");
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef(null);
    useEffect(() => setVal(value || ""), [value]);
    const changed = (val || "") !== (value || "");
    const save = async (override) => {
        const next = ((override ?? val) || "").trim();
        setSaving(true);
        try {
            await onSave(next);
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };
    const handleFiles = async (fileList) => {
        const f = Array.from(fileList || []).find((x) => x.type.startsWith("image/"));
        if (!f) return;
        setUploading(true);
        try {
            const m = await adminUploadMedia(f);
            setVal(m.url);
            await save(m.url); // auto-save this slot to the freshly uploaded image
        } catch {
            toast.error("Upload failed — object storage (S3) may not be configured yet.");
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };
    return (
        <div className="flex items-center gap-4 border border-[#E5E7EB] bg-white p-3">
            <label
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFiles(e.dataTransfer.files);
                }}
                title="Drag & drop an image here, or click to upload"
                className={`relative w-24 h-16 bg-[#F5F7FA] border overflow-hidden flex-shrink-0 cursor-pointer flex items-center justify-center ${
                    dragOver ? "border-[#002B5C] border-dashed bg-[#F5F7FA]" : "border-[#E5E7EB]"
                }`}
            >
                {val ? (
                    <img src={mediaUrl(val)} alt="" className="w-full h-full object-cover" />
                ) : (
                    <UploadCloud size={16} strokeWidth={1.5} className="text-[#4B5563]" />
                )}
                {uploading && (
                    <div className="absolute inset-0 bg-white/75 flex items-center justify-center text-[10px] font-medium text-[#002B5C]">
                        Uploading…
                    </div>
                )}
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFiles(e.target.files)}
                    className="hidden"
                />
            </label>
            <div className="flex-1 min-w-0">
                <div className="overline !text-[10px]">{label}</div>
                <input
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    placeholder="Drag an image onto the thumbnail, or paste a URL"
                    className="mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                />
            </div>
            <button onClick={() => save()} disabled={!changed || saving} className="text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] disabled:opacity-40 flex-shrink-0">
                {saving ? "…" : "Save"}
            </button>
        </div>
    );
}

/**
 * One editable site_content text slot.
 *
 * `defaultValue` is the copy the storefront falls back to when no override is
 * saved. Passing it makes an empty field self-explanatory: the built-in text
 * shows as a greyed placeholder with a "Using default" note, instead of the box
 * looking blank as though the section had no content at all. "Use default" loads
 * that text in so it can be edited, and clearing the field reverts to it.
 */
export function TextSlotRow({ label, value, onSave, multiline, defaultValue = "" }) {
    const [val, setVal] = useState(value || "");
    const [saving, setSaving] = useState(false);
    useEffect(() => setVal(value || ""), [value]);
    const changed = (val || "") !== (value || "");
    const usingDefault = !(value || "").trim() && !!defaultValue;
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
    const box =
        "mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C] placeholder:text-[#9CA3AF] placeholder:italic";
    return (
        <div className="flex items-start gap-3 border border-[#E5E7EB] bg-white p-3">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="overline !text-[10px]">{label}</div>
                    {usingDefault && (
                        <span className="font-mono text-[9px] uppercase tracking-widest text-[#4B5563] bg-[#F5F7FA] border border-[#E5E7EB] px-1.5 py-0.5">
                            Using default
                        </span>
                    )}
                </div>
                {multiline ? (
                    <textarea
                        value={val}
                        onChange={(e) => setVal(e.target.value)}
                        rows={3}
                        placeholder={defaultValue}
                        className={box}
                    />
                ) : (
                    <input
                        value={val}
                        onChange={(e) => setVal(e.target.value)}
                        placeholder={defaultValue}
                        className={box}
                    />
                )}
                {defaultValue && (
                    <div className="mt-1.5 flex items-start gap-3">
                        <button
                            type="button"
                            onClick={() => setVal(defaultValue)}
                            className="flex-shrink-0 text-[10px] font-mono uppercase tracking-widest text-[#002B5C] border-b border-[#002B5C]/40 hover:border-[#CC0033] hover:text-[#CC0033]"
                        >
                            Use default
                        </button>
                        {(val || "").trim() !== defaultValue && (
                            <span className="text-[10px] text-[#4B5563] whitespace-pre-line line-clamp-2">
                                Default: {defaultValue}
                            </span>
                        )}
                    </div>
                )}
            </div>
            <button onClick={save} disabled={!changed || saving} className="mt-5 text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] disabled:opacity-40 flex-shrink-0">
                {saving ? "…" : "Save"}
            </button>
        </div>
    );
}

// Reusable editor for "hero + cards" storefront pages (What We Do, Digital Solutions, Academy…).

export function PageCardsEditor({ collectionKey, iconOptions = [], defaults = [] }) {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    const norm = (arr) =>
        arr.map((it) => ({ ...it, bullets: Array.isArray(it.bullets) ? it.bullets.join("\n") : it.bullets || "" }));
    useEffect(() => {
        fetchCollection(collectionKey)
            .then((d) => setItems(norm(d?.items?.length ? d.items : defaults)))
            .catch(() => setItems(norm(defaults)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionKey]);
    if (!items) return null;

    const update = (i, k, v) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
    const move = (i, dir) =>
        setItems((a) => {
            const j = i + dir;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });
    const add = () =>
        setItems((a) => [
            ...a,
            { id: "card-" + Date.now(), icon: iconOptions[0] || "", kicker: "", title: "New card", lede: "", bullets: "", cta_label: "Learn more", cta_to: "/contact", coming_soon: false, image: "" },
        ]);
    const remove = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
    const uploadImg = async (i, fileList) => {
        const file = Array.from(fileList || []).find((x) => x.type.startsWith("image/"));
        if (!file) return;
        try {
            const m = await adminUploadMedia(file);
            update(i, "image", m.url);
            toast.success("Image uploaded — click Save cards.");
        } catch {
            toast.error("Upload failed — object storage (S3) may not be configured.");
        }
    };
    const save = async () => {
        setSaving(true);
        try {
            const payload = items.map((it) => ({
                ...it,
                bullets: String(it.bullets || "").split("\n").map((b) => b.trim()).filter(Boolean),
                coming_soon: !!it.coming_soon,
            }));
            await adminSaveCollection(collectionKey, payload);
            toast.success("Cards saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-[#4B5563]">Reorder with the arrows — order here is the order on the page.</p>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]"><Plus size={12} strokeWidth={1.5} /> Add card</button>
                    <button onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">{saving ? "…" : "Save cards"}</button>
                </div>
            </div>
            <div className="mt-4 space-y-4">
                {items.map((it, i) => (
                    <div key={i} className="border border-[#E5E7EB] bg-white p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="overline !text-[10px] !text-[#002B5C]">#{i + 1}</div>
                            <div className="flex gap-1">
                                <button onClick={() => move(i, -1)} disabled={i === 0} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={12} /></button>
                                <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={12} /></button>
                                <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={12} /></button>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <label
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => { e.preventDefault(); uploadImg(i, e.dataTransfer.files); }}
                                title="Drag & drop or click to upload"
                                className="w-28 h-20 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden flex-shrink-0 cursor-pointer flex items-center justify-center"
                            >
                                {it.image ? <img src={mediaUrl(it.image)} alt="" className="w-full h-full object-cover" /> : <UploadCloud size={16} strokeWidth={1.5} className="text-[#4B5563]" />}
                                <input type="file" accept="image/*" onChange={(e) => uploadImg(i, e.target.files)} className="hidden" />
                            </label>
                            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input value={it.kicker || ""} onChange={(e) => update(i, "kicker", e.target.value)} placeholder="Kicker (e.g. 01 · Publishing)" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                                <input value={it.title || ""} onChange={(e) => update(i, "title", e.target.value)} placeholder="Title" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            </div>
                        </div>
                        <textarea value={it.lede || ""} onChange={(e) => update(i, "lede", e.target.value)} placeholder="Description" rows={2} className="mt-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <textarea value={it.bullets || ""} onChange={(e) => update(i, "bullets", e.target.value)} placeholder="Bullet points — one per line" rows={3} className="mt-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {iconOptions.length > 0 && (
                                <select value={it.icon || ""} onChange={(e) => update(i, "icon", e.target.value)} className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]">
                                    {iconOptions.map((ic) => (<option key={ic} value={ic}>{ic}</option>))}
                                </select>
                            )}
                            <input value={it.cta_label || ""} onChange={(e) => update(i, "cta_label", e.target.value)} placeholder="Button label" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            <input value={it.cta_to || ""} onChange={(e) => update(i, "cta_to", e.target.value)} placeholder="Button link (/path)" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm font-mono outline-none focus:border-[#002B5C]" />
                        </div>
                        <label className="mt-2 inline-flex items-center gap-2 text-sm text-[#4B5563]">
                            <input type="checkbox" checked={!!it.coming_soon} onChange={(e) => update(i, "coming_soon", e.target.checked)} />
                            Show “Coming Soon” badge
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ListEditor({ collectionKey, defaults = [], fields = [], iconOptions = [], blank = {} }) {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        fetchCollection(collectionKey)
            .then((d) => setItems(d?.items?.length ? d.items : defaults))
            .catch(() => setItems(defaults));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionKey]);
    if (!items) return null;

    const update = (i, k, v) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
    const move = (i, dir) =>
        setItems((a) => {
            const j = i + dir;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });
    const add = () => setItems((a) => [...a, { ...blank }]);
    const remove = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
    const save = async () => {
        setSaving(true);
        try {
            await adminSaveCollection(collectionKey, items);
            toast.success("Saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-[#4B5563]">Order here is the order on the page.</p>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]"><Plus size={12} strokeWidth={1.5} /> Add</button>
                    <button onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">{saving ? "…" : "Save"}</button>
                </div>
            </div>
            <div className="mt-3 space-y-2">
                {items.map((it, i) => (
                    <div key={i} className="border border-[#E5E7EB] bg-white p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="overline !text-[10px] !text-[#002B5C]">#{i + 1}</div>
                            <div className="flex gap-1">
                                <button onClick={() => move(i, -1)} disabled={i === 0} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={12} /></button>
                                <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={12} /></button>
                                <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={12} /></button>
                            </div>
                        </div>
                        {iconOptions.length > 0 && (
                            <select value={it.icon || ""} onChange={(e) => update(i, "icon", e.target.value)} className="mb-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]">
                                {iconOptions.map((ic) => (<option key={ic} value={ic}>{ic}</option>))}
                            </select>
                        )}
                        {fields.map((fl) =>
                            fl.type === "textarea" ? (
                                <textarea key={fl.key} value={it[fl.key] || ""} onChange={(e) => update(i, fl.key, e.target.value)} placeholder={fl.label} rows={2} className="mb-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            ) : (
                                <input key={fl.key} value={it[fl.key] || ""} onChange={(e) => update(i, fl.key, e.target.value)} placeholder={fl.label} className="mb-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            ),
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

const SPEAKER_FIELDS = [
    { key: "name", label: "Name" },
    { key: "role", label: "Role / title" },
    { key: "photo", label: "Photo URL" },
];

export function CollectionEditor({ label, collectionKey }) {
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
