import React, { useEffect, useRef, useState } from "react";
import { UploadCloud, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { canDelete } from "../../lib/rbac";
import { adminListMedia, adminUploadMedia, adminDeleteMedia, mediaUrl } from "../../lib/api";

export default function AdminMedia() {
    // Deleting is admin-only; the server refuses it either way, this just
    // keeps a button off the screen that would only say no.
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);
    const [media, setMedia] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef(null);

    useEffect(() => {
        adminListMedia().then(setMedia).catch(() => {});
    }, []);

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

    return (
        <div data-testid="admin-media-page">
            <div className="overline">Content</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Media Library</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Upload and manage every image used across the site. Copy an image URL here, then
                paste it into any slot under Pages — or drag files straight onto a slot there.
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
                                        {mayDelete && (
                                            <button onClick={() => onDelete(m.id)} className="text-[#CC0033] hover:opacity-70 p-1" aria-label="Delete">
                                                <Trash2 size={14} strokeWidth={1.5} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
