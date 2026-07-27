import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2, Plus, Upload, Eye, EyeOff } from "lucide-react";
import {
    fetchCollection,
    adminSaveCollection,
    adminUploadMedia,
    adminUploadDoc,
    mediaUrl,
} from "../../lib/api";

/**
 * Repeatable-item editor for the Media & Gallery page.
 *
 * ListEditor already exists but only takes plain text fields, so images had to be
 * pasted as URLs and files were impossible. This adds real uploads, an
 * enable/disable toggle per row, and select fields — everything the new page's
 * carousels, albums, videos and downloads need.
 *
 * `fields` entries: { key, label, type?: text|textarea|image|file|select, options? }
 */
export default function MediaListEditor({
    collectionKey,
    fields,
    blank = {},
    addLabel = "Add item",
    help,
    max,
}) {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchCollection(collectionKey)
            .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
            .catch(() => setItems([]));
    }, [collectionKey]);

    if (!items) return <p className="font-mono text-xs text-[#4B5563]">Loading…</p>;

    const set = (i, k, v) => setItems((a) => a.map((it, x) => (x === i ? { ...it, [k]: v } : it)));
    const move = (i, d) =>
        setItems((a) => {
            const j = i + d;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });
    const add = () =>
        setItems((a) => [...a, { id: `m-${Date.now()}`, enabled: true, ...blank }]);
    const remove = (i) => setItems((a) => a.filter((_, x) => x !== i));

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

    const atMax = max ? items.length >= max : false;

    return (
        <div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] text-[#4B5563]">
                    {help || "Order here is the order on the page."}
                    {max ? ` Up to ${max}.` : ""}
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={add}
                        disabled={atMax}
                        className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1.5 hover:bg-[#F5F7FA] disabled:opacity-40"
                    >
                        <Plus size={12} strokeWidth={1.5} /> {addLabel}
                    </button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="text-xs font-medium border border-[#002B5C] px-4 py-1.5 hover:bg-[#F5F7FA] disabled:opacity-40"
                    >
                        {saving ? "…" : "Save"}
                    </button>
                </div>
            </div>

            <div className="mt-3 space-y-2">
                {items.length === 0 && (
                    <p className="text-sm text-[#4B5563] border border-dashed border-[#E5E7EB] p-4">
                        Nothing here yet — this section stays hidden on the site until you add one.
                    </p>
                )}
                {items.map((it, i) => (
                    <div
                        key={it.id || i}
                        className={`border border-[#E5E7EB] bg-white p-3 ${it.enabled === false ? "opacity-55" : ""}`}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="overline !text-[10px] !text-[#002B5C]">#{i + 1}</span>
                            <div className="flex gap-1">
                                <button onClick={() => set(i, "enabled", it.enabled === false)} className="border border-[#E5E7EB] p-1.5 hover:bg-[#F5F7FA]" aria-label="Show or hide">
                                    {it.enabled === false ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                                <button onClick={() => move(i, -1)} disabled={i === 0} className="border border-[#E5E7EB] p-1.5 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={13} /></button>
                                <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-1.5 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={13} /></button>
                                <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1.5 hover:bg-[#CC0033]/5" aria-label="Remove"><Trash2 size={13} /></button>
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-2">
                            {fields.map((f) => (
                                <Field
                                    key={f.key}
                                    field={f}
                                    value={it[f.key]}
                                    onChange={(v) => set(i, f.key, v)}
                                    onMeta={(k, v) => set(i, k, v)}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Field({ field, value, onChange, onMeta }) {
    const ref = useRef(null);
    const [busy, setBusy] = useState(false);
    const wide = field.type === "textarea" || field.type === "image" || field.type === "file";

    const upload = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            if (field.type === "image") {
                const { url } = await adminUploadMedia(file, field.label);
                onChange(url);
            } else {
                const res = await adminUploadDoc(file);
                onChange(res.url);
                // Stash the format so the page can show "PDF ↓" without guessing.
                onMeta("format", res.format);
            }
            toast.success("Uploaded.");
        } catch {
            toast.error("Upload failed.");
        } finally {
            setBusy(false);
        }
    };

    const box =
        "w-full border border-[#E5E7EB] bg-white px-2.5 py-2 text-sm outline-none focus:border-[#002B5C]";

    if (field.type === "image" || field.type === "file") {
        const isImg = field.type === "image";
        return (
            <div className={wide ? "sm:col-span-2" : ""}>
                <div className="overline !text-[9px] mb-1">{field.label}</div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => ref.current?.click()}
                        className="flex-shrink-0 border border-[#E5E7EB] hover:border-[#002B5C] overflow-hidden"
                        style={{ width: isImg ? 96 : 120, height: 60 }}
                        title={isImg ? "Click to upload an image" : "Click to upload a file"}
                    >
                        {value ? (
                            isImg ? (
                                <img src={mediaUrl(value) || value} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <span className="font-mono text-[10px] text-[#002B5C]">Replace</span>
                            )
                        ) : (
                            <span className="flex items-center justify-center w-full h-full text-[#4B5563]">
                                <Upload size={15} strokeWidth={1.5} />
                            </span>
                        )}
                    </button>
                    <input
                        ref={ref}
                        type="file"
                        accept={isImg ? "image/*" : ".pdf,.zip,.doc,.docx,.xls,.xlsx"}
                        className="hidden"
                        onChange={(e) => upload(e.target.files?.[0])}
                    />
                    <input
                        value={value || ""}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={busy ? "Uploading…" : isImg ? "…or paste an image URL" : "…or paste a file URL"}
                        className={box}
                    />
                </div>
            </div>
        );
    }

    if (field.type === "select") {
        return (
            <div>
                <div className="overline !text-[9px] mb-1">{field.label}</div>
                <select value={value || field.options?.[0]?.value || ""} onChange={(e) => onChange(e.target.value)} className={box}>
                    {(field.options || []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>
        );
    }

    if (field.type === "textarea") {
        return (
            <div className="sm:col-span-2">
                <div className="overline !text-[9px] mb-1">{field.label}</div>
                <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2} className={box} />
            </div>
        );
    }

    return (
        <div>
            <div className="overline !text-[9px] mb-1">{field.label}</div>
            <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || ""} className={box} />
        </div>
    );
}
