import React, { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import {
    adminListMedia,
    adminUploadMedia,
    adminDeleteMedia,
    fetchSiteContent,
    adminSetSiteContent,
    fetchCategories,
    adminUpdateCategoryImage,
    mediaUrl,
} from "../../lib/api";

export default function AdminMedia() {
    const [media, setMedia] = useState([]);
    const [cats, setCats] = useState([]);
    const [site, setSite] = useState({});
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);

    const load = () => {
        adminListMedia().then(setMedia).catch(() => {});
        fetchCategories().then(setCats).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    };
    useEffect(load, []);

    const onUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const m = await adminUploadMedia(file);
            setMedia((prev) => [m, ...prev]);
            toast.success("Image uploaded.");
        } catch (err) {
            toast.error("Upload failed — object storage (S3) may not be configured yet.");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
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
        toast.success("Saved.");
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

            <section className="mt-10">
                <h2 className="font-serif text-2xl text-[#002B5C]">Site images</h2>
                <p className="text-sm text-[#4B5563] mt-1">
                    Set the hero and banner images shown on the storefront. Paste an image URL, or
                    copy one from the Media Library below.
                </p>
                <div className="mt-6 space-y-4">
                    <SlotRow label="Homepage hero" value={site.home_hero} onSave={(v) => saveSite("home_hero", v)} />
                    <SlotRow label="Bookstore banner (PLP)" value={site.plp_banner} onSave={(v) => saveSite("plp_banner", v)} />
                </div>

                <h3 className="font-serif text-xl text-[#002B5C] mt-10">Category images</h3>
                <div className="mt-4 space-y-4">
                    {cats.map((c) => (
                        <SlotRow key={c.id} label={c.name} value={c.image} onSave={(v) => saveCat(c.id, v)} />
                    ))}
                </div>
            </section>

            <section className="mt-16 border-t border-[#E5E7EB] pt-12">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 className="font-serif text-2xl text-[#002B5C]">
                            Media library ({media.length})
                        </h2>
                        <p className="text-sm text-[#4B5563] mt-1">
                            Upload images, then copy a URL to use on covers, heroes, or anywhere.
                        </p>
                    </div>
                    <label className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] cursor-pointer">
                        <Upload size={16} strokeWidth={1.5} />
                        {uploading ? "Uploading…" : "Upload image"}
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            onChange={onUpload}
                            className="hidden"
                            data-testid="media-upload-input"
                        />
                    </label>
                </div>

                {media.length === 0 ? (
                    <p className="mt-8 text-sm text-[#4B5563]">
                        No media yet. Upload an image to get started. (Uploads require object
                        storage / S3 to be configured.)
                    </p>
                ) : (
                    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {media.map((m) => (
                            <div
                                key={m.id}
                                data-testid={`media-${m.id}`}
                                className="border border-[#E5E7EB] bg-white"
                            >
                                <div className="aspect-[4/3] bg-[#F5F7FA] overflow-hidden">
                                    <img
                                        src={mediaUrl(m.url)}
                                        alt={m.alt || m.filename}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                </div>
                                <div className="p-2 flex items-center justify-between gap-2">
                                    <button
                                        onClick={() => copy(m.url)}
                                        className="inline-flex items-center gap-1 text-xs text-[#002B5C] hover:text-[#CC0033]"
                                    >
                                        <Copy size={12} strokeWidth={1.5} /> Copy URL
                                    </button>
                                    <button
                                        onClick={() => onDelete(m.id)}
                                        className="text-[#CC0033] hover:opacity-70 p-1"
                                        aria-label="Delete"
                                    >
                                        <Trash2 size={14} strokeWidth={1.5} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
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
            <button
                onClick={save}
                disabled={!changed || saving}
                className="text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] disabled:opacity-40 flex-shrink-0"
            >
                {saving ? "…" : "Save"}
            </button>
        </div>
    );
}
