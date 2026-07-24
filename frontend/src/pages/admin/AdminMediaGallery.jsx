import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2, Plus, ArrowUp, ArrowDown, Upload, Image as ImageIcon, Video } from "lucide-react";
import { fetchCollection, adminSaveCollection, adminUploadMedia, mediaUrl } from "../../lib/api";

function Row({ it, i, count, onChange, onMove, onRemove }) {
    const fileRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const isVideo = it.type === "video";

    const upload = async (file) => {
        if (!file || !file.type.startsWith("image/")) { toast.error("Choose an image."); return; }
        setBusy(true);
        try {
            const { url } = await adminUploadMedia(file, it.title || "");
            onChange(isVideo ? "poster" : "url", url);
            toast.success("Image uploaded — remember to Save.");
        } catch { toast.error("Upload failed."); } finally { setBusy(false); }
    };

    return (
        <div className={`border border-[#E5E7EB] p-3 flex gap-3 ${it.enabled === false ? "opacity-60 bg-[#F5F7FA]" : "bg-white"}`}>
            <div className="flex flex-col justify-center">
                <button type="button" onClick={() => onMove(-1)} disabled={i === 0} aria-label="Up" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25"><ArrowUp size={13} strokeWidth={1.5} /></button>
                <button type="button" onClick={() => onMove(1)} disabled={i === count - 1} aria-label="Down" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25"><ArrowDown size={13} strokeWidth={1.5} /></button>
            </div>

            {/* thumbnail / upload */}
            <div
                onClick={() => fileRef.current?.click()}
                className="relative w-20 h-16 flex-shrink-0 border border-[#E5E7EB] bg-[#F5F7FA] overflow-hidden cursor-pointer flex items-center justify-center"
                title="Click to upload an image (or poster for videos)"
            >
                {(isVideo ? it.poster : it.url) ? (
                    <img src={mediaUrl(isVideo ? it.poster : it.url) || (isVideo ? it.poster : it.url)} alt="" className="w-full h-full object-cover" />
                ) : (
                    <Upload size={15} strokeWidth={1.5} className="text-[#4B5563]" />
                )}
                {busy && <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-[10px] font-mono">…</div>}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </div>

            <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                    <div className="inline-flex border border-[#E5E7EB]">
                        <button type="button" onClick={() => onChange("type", "image")} className={`px-2 py-1 text-xs inline-flex items-center gap-1 ${!isVideo ? "bg-[#002B5C] text-white" : "text-[#4B5563]"}`}><ImageIcon size={12} /> Image</button>
                        <button type="button" onClick={() => onChange("type", "video")} className={`px-2 py-1 text-xs inline-flex items-center gap-1 ${isVideo ? "bg-[#002B5C] text-white" : "text-[#4B5563]"}`}><Video size={12} /> Video</button>
                    </div>
                </div>
                {isVideo ? (
                    <input value={it.url ?? ""} onChange={(e) => onChange("url", e.target.value)} placeholder="YouTube or Vimeo link" className="w-full border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C]" />
                ) : null}
                <div className="grid grid-cols-2 gap-1.5">
                    <input value={it.title ?? ""} onChange={(e) => onChange("title", e.target.value)} placeholder="Title (optional)" className="border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C]" />
                    <input value={it.caption ?? ""} onChange={(e) => onChange("caption", e.target.value)} placeholder="Caption (optional)" className="border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C]" />
                </div>
                <div className="flex items-center gap-2">
                    <label className="overline !text-[9px] text-[#4B5563]">Section</label>
                    <select value={it.section || "launches"} onChange={(e) => onChange("section", e.target.value)} className="border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C]">
                        <option value="launches">Book Launches</option>
                        <option value="presentations">Book Presentations</option>
                        <option value="events">Events</option>
                    </select>
                </div>
            </div>

            <div className="flex flex-col items-center gap-1.5">
                <button type="button" onClick={() => onChange("enabled", it.enabled === false)} aria-label="Toggle" className="p-1.5 text-[#4B5563] hover:text-[#002B5C]">
                    {it.enabled === false ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
                </button>
                <button type="button" onClick={onRemove} aria-label="Remove" className="p-1.5 text-[#4B5563] hover:text-[#CC0033]"><Trash2 size={15} strokeWidth={1.5} /></button>
            </div>
        </div>
    );
}

export default function AdminMediaGallery() {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchCollection("media_gallery").then((d) => setItems(d?.items || [])).catch(() => setItems([]));
    }, []);

    if (!items) return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;

    const upd = (i, k, v) => setItems((cur) => cur.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
    const add = () => setItems((cur) => [...cur, { id: `m-${Date.now()}`, type: "image", url: "", title: "", caption: "", section: "launches", enabled: true }]);
    const remove = (i) => setItems((cur) => cur.filter((_, idx) => idx !== i));
    const move = (i, dir) => {
        const j = i + dir; if (j < 0 || j >= items.length) return;
        const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; setItems(n);
    };

    const save = async () => {
        setSaving(true);
        try {
            const clean = items.filter((x) => x.url || x.poster);
            await adminSaveCollection("media_gallery", clean);
            toast.success("Gallery saved — live on /media.");
        } catch { toast.error("Could not save."); } finally { setSaving(false); }
    };

    return (
        <div data-testid="admin-media-gallery-page">
            <div className="overline">Page editor</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Media &amp; Gallery</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Curate the public gallery. Upload photos, or paste YouTube/Vimeo links for video.
                Reorder with the arrows, hide items with the eye, and Save.
            </p>

            <div className="mt-6 flex items-center gap-3">
                <button onClick={add} className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-4 py-2 text-sm hover:bg-[#001F42]"><Plus size={15} strokeWidth={1.5} /> Add item</button>
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm hover:bg-[#F5F7FA] disabled:opacity-60">{saving ? "Saving…" : "Save gallery"}</button>
            </div>

            <div className="mt-5 space-y-2 max-w-3xl">
                {items.map((it, i) => (
                    <Row key={it.id || i} it={it} i={i} count={items.length}
                        onChange={(k, v) => upd(i, k, v)} onMove={(d) => move(i, d)} onRemove={() => remove(i)} />
                ))}
                {items.length === 0 && <p className="text-sm text-[#4B5563]">No items yet — add a photo or video.</p>}
            </div>
        </div>
    );
}
