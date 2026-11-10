import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { hrmPhotoBlob, hrmUploadPhoto, hrmRemovePhoto, formatApiError } from "../../lib/api";

/* ---------------------------------------------------------------- photos --- */
/* The photo endpoint needs the sign-in token, so it is fetched as a blob
   (a plain <img src> sends no Authorization header). */
export function Avatar({ p, size = 36, bust = "" }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let gone = false;
        let u = "";
        if (p?.photo_at) hrmPhotoBlob(p.id).then((b) => { if (!gone) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => {});
        else setUrl("");
        return () => { gone = true; if (u) URL.revokeObjectURL(u); };
    }, [p?.id, p?.photo_at, bust]);
    const initials = (p?.name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    return url
        ? <img src={url} alt={p.name} width={size} height={size} className="object-cover border border-[#E5E7EB] shrink-0" style={{ width: size, height: size }} />
        : <span className="inline-flex items-center justify-center bg-[#E8EEF6] text-[#002B5C] font-medium shrink-0" style={{ width: size, height: size, fontSize: size / 2.8 }} aria-hidden="true">{initials}</span>;
}

export function PhotoPicker({ p, onChanged }) {
    const pick = useRef(null);
    const [busy, setBusy] = useState(false);
    const up = async (file) => {
        if (!file) return;
        if (!/^image\//.test(file.type)) { toast.error("Choose a photo (JPEG or PNG)."); return; }
        setBusy(true);
        try { const r = await hrmUploadPhoto(p.id, file); toast.success("Photo saved."); onChanged(r.photo_at); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!window.confirm("Remove this photo?")) return;
        try { await hrmRemovePhoto(p.id); onChanged(null); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <span className="inline-flex items-center gap-2 text-xs">
            <button type="button" disabled={busy} onClick={() => pick.current?.click()} className="inline-flex items-center gap-1 underline disabled:opacity-50">
                <Camera size={12} />{busy ? "Uploading…" : p.photo_at ? "Change photo" : "Add photo"}
            </button>
            {p.photo_at && <button type="button" onClick={remove} className="underline text-[#CC0033]">Remove</button>}
            <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { up(e.target.files?.[0]); e.target.value = ""; }} />
        </span>
    );
}

export function SelfPhoto({ p }) {
    const [cur, setCur] = useState(p);
    return (
        <div className="flex flex-col items-center gap-1">
            <Avatar p={cur} size={72} />
            <PhotoPicker p={cur} onChanged={(at) => setCur({ ...cur, photo_at: at })} />
        </div>
    );
}


/* A progress ring (leave left, goals done). */
export function Ring({ value, max, color, size = 72, label, track = "#F3F4F6" }) {
    const r = size / 2 - 6;
    const c = 2 * Math.PI * r;
    const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth="7" />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size / 4.2} fontFamily="Georgia, serif" fill="#002B5C">{label}</text>
        </svg>
    );
}

