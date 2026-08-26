import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { canDelete } from "../../lib/rbac";
import { Eye, EyeOff, Trash2, Plus, ArrowUp, ArrowDown, Upload, Save, X, UserPlus } from "lucide-react";
import {
    adminListAuthors,
    adminImportAuthors,
    adminCreateAuthor,
    adminUpdateAuthor,
    adminDeleteAuthor,
    adminReorderAuthors,
    adminSetAuthorOrderMode,
    adminUploadAuthorPhoto,
    fetchSettings,
    adminSetSetting,
    mediaUrl,
} from "../../lib/api";

// Category options for grouping. The first three match the storefront's default
// section order; blank = "Uncategorised" (falls into an "Other" section).
const CATEGORY_OPTIONS = [
    "Law, Tax & Professional",
    "Academic & Civil Services",
    "Business & General",
];

// A single author row: inline edit of name/specialty/affiliation/bio, photo
// drag-drop, show/hide, delete, and (in custom mode) reorder.
function AuthorRow({ a, index, count, mode, onChange, onSave, onDelete, onMove, dirty }) {
    const [drag, setDrag] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);

    const upload = async (file) => {
        if (!file || !file.type.startsWith("image/")) {
            toast.error("Please choose an image file.");
            return;
        }
        setUploading(true);
        try {
            const { url } = await adminUploadAuthorPhoto(file);
            onChange("photo", url);
            toast.success("Photo uploaded — remember to Save.");
        } catch {
            toast.error("Upload failed.");
        } finally {
            setUploading(false);
        }
    };

    return (
        <div
            data-testid={`admin-author-${a.id}`}
            className={`border border-[#E5E7EB] p-3 flex gap-3 ${a.enabled === false ? "opacity-60 bg-[#F5F7FA]" : "bg-white"}`}
        >
            {mode === "custom" && (
                <div className="flex flex-col justify-center">
                    <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25">
                        <ArrowUp size={14} strokeWidth={1.5} />
                    </button>
                    <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25">
                        <ArrowDown size={14} strokeWidth={1.5} />
                    </button>
                </div>
            )}

            {/* Photo drop zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
                onClick={() => fileRef.current?.click()}
                title="Click or drop an image"
                className={`relative w-20 h-20 flex-shrink-0 border ${drag ? "border-[#002B5C] border-dashed" : "border-[#E5E7EB]"} bg-[#F5F7FA] overflow-hidden cursor-pointer flex items-center justify-center`}
            >
                {a.photo ? (
                    <img src={mediaUrl(a.photo) || a.photo} alt={a.name} className="w-full h-full object-cover" />
                ) : (
                    <Upload size={16} strokeWidth={1.5} className="text-[#4B5563]" />
                )}
                {uploading && <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-[10px] font-mono">…</div>}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </div>

            {/* Fields */}
            <div className="flex-1 min-w-0 space-y-1.5">
                <input
                    value={a.name ?? ""}
                    onChange={(e) => onChange("name", e.target.value)}
                    placeholder="Author name"
                    className="w-full border border-[#E5E7EB] px-2 py-1.5 text-sm font-medium outline-none focus:border-[#002B5C]"
                />
                <div className="grid grid-cols-3 gap-1.5">
                    <select
                        value={a.category ?? ""}
                        onChange={(e) => onChange("category", e.target.value)}
                        title="Category (used for grouping)"
                        className="border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C] bg-white"
                    >
                        <option value="">Uncategorised</option>
                        {CATEGORY_OPTIONS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                    <input
                        value={a.specialty ?? ""}
                        onChange={(e) => onChange("specialty", e.target.value)}
                        placeholder="Specialty (e.g. Tax Law)"
                        className="border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C]"
                    />
                    <input
                        value={a.affiliation ?? ""}
                        onChange={(e) => onChange("affiliation", e.target.value)}
                        placeholder="Affiliation (optional)"
                        className="border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C]"
                    />
                </div>
                <textarea
                    value={a.bio ?? ""}
                    onChange={(e) => onChange("bio", e.target.value)}
                    placeholder="Short bio"
                    rows={2}
                    className="w-full border border-[#E5E7EB] px-2 py-1.5 text-xs outline-none focus:border-[#002B5C] resize-y"
                />
            </div>

            {/* Actions */}
            <div className="flex flex-col items-center gap-1.5">
                <button
                    type="button"
                    onClick={onSave}
                    disabled={!dirty}
                    aria-label="Save author"
                    title={dirty ? "Save changes" : "No changes"}
                    className={`p-1.5 ${dirty ? "text-[#002B5C] hover:text-[#CC0033]" : "text-[#E5E7EB]"}`}
                >
                    <Save size={16} strokeWidth={1.5} />
                </button>
                <button
                    type="button"
                    onClick={() => onChange("enabled", a.enabled === false)}
                    aria-label={a.enabled === false ? "Show" : "Hide"}
                    title={a.enabled === false ? "Hidden — click to show" : "Visible — click to hide"}
                    className="p-1.5 text-[#4B5563] hover:text-[#002B5C]"
                >
                    {a.enabled === false ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
                </button>
                {onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        aria-label="Delete author"
                        className="p-1.5 text-[#4B5563] hover:text-[#CC0033]"
                    >
                        <Trash2 size={15} strokeWidth={1.5} />
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * Add the authors we know are missing, without touching the ones we have.
 *
 * Deliberately not "Reseed authors" — that one empties the collection before it
 * reloads, so using it to add a few people would discard every bio, photo and
 * ordering change made on this screen since the last seed. This only inserts
 * ids we do not already hold; anything present is reported and left alone, so a
 * second run does nothing.
 *
 * Records whose bio could not be sourced are added blank on purpose. A name and
 * a working link is honest; an invented biography under a real person's name is
 * not.
 */
function ImportAuthorsDialog({ onClose, onDone }) {
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);

    const run = async (dryRun) => {
        setBusy(true);
        try {
            const res = await adminImportAuthors(!dryRun);
            setPreview(res);
            if (!dryRun) {
                toast.success(
                    `${res.added} added, ${res.updated} updated, ${res.photos_attached ?? 0} portrait(s) attached.`,
                );
                onDone?.();
            }
        } catch (err) {
            toast.error(err?.response?.data?.detail || err.message || "Could not import");
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        run(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /*
     * Adds AND updates. The endpoint gained the ability to patch an existing
     * record -- that is how a bio or a portrait reaches someone already on the
     * roster -- but this dialog still counted only inserts. So a run with
     * nothing to add and one photo to attach read "Nothing to add" and greyed
     * out Apply, hiding the only work there was to do.
     */
    const adds = preview ? (preview.dry_run ? preview.would_add : preview.added) : 0;
    const updates = preview ? (preview.dry_run ? preview.would_update : preview.updated) : 0;
    const n = adds + updates;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
            <div
                data-testid="import-authors-dialog"
                className="bg-white border border-[#002B5C] w-full max-w-2xl p-8 my-10"
            >
                <div className="overline">Roster</div>
                <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">Add missing authors</h2>
                <p className="text-sm text-[#4B5563] mt-3">
                    People credited on a book who have no author record, so their book&rsquo;s
                    About&nbsp;the&nbsp;Author section has nothing to show. Someone you already
                    have is matched by name — aliases included — and updated rather than
                    duplicated. A blank field in the file never overwrites what is there.
                </p>

                {!preview ? (
                    <p className="mt-6 font-mono text-xs text-[#4B5563]">Checking…</p>
                ) : (
                    <>
                        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="border border-[#E5E7EB] px-3 py-2">
                                <div className="overline !text-[9px]">In the file</div>
                                <div className="font-serif text-2xl text-[#002B5C]">{preview.in_file}</div>
                            </div>
                            <div className="border border-[#E5E7EB] px-3 py-2">
                                <div className="overline !text-[9px]">Will add</div>
                                {/* `adds`, not `n`. n is adds+updates and gates the
                                    button; this card counts inserts alone, and
                                    reading n here made a pure-update run report
                                    fourteen adds and fourteen updates at once. */}
                                <div className="font-serif text-2xl text-[#002B5C]">{adds}</div>
                            </div>
                            <div className="border border-[#E5E7EB] px-3 py-2">
                                <div className="overline !text-[9px]">Will update</div>
                                <div className="font-serif text-2xl text-[#002B5C]">{updates}</div>
                                <div className="text-[10px] text-[#4B5563] mt-0.5">Already on the site</div>
                            </div>
                            <div className="border border-[#E5E7EB] px-3 py-2">
                                <div className="overline !text-[9px]">Portraits</div>
                                <div className="font-serif text-2xl text-[#002B5C]">
                                    {preview.photos_attached ?? 0}
                                </div>
                                <div className="text-[10px] text-[#4B5563] mt-0.5">
                                    {preview.photos_found ?? 0} in storage
                                </div>
                            </div>
                        </div>

                        {preview.photos_matching_nobody?.length > 0 && (
                            /* Named, not counted: a portrait matching nobody is
                               almost always a misspelt file name, and the only
                               way to fix it is to see which one. */
                            <p className="text-[11px] text-[#B4750F] mt-3">
                                <strong>{preview.photos_matching_nobody.length}</strong> photo(s)
                                match no author:{" "}
                                {preview.photos_matching_nobody.join(", ")}
                            </p>
                        )}

                        {preview.without_bio > 0 && (
                            <p className="text-[11px] text-[#4B5563] mt-3">
                                <strong>{preview.without_bio}</strong> are added with an empty bio —
                                their book credits them alongside others, so the master&rsquo;s
                                &ldquo;About the Author&rdquo; text covers the whole group and cannot
                                be split per person without reading it. Write those here and they
                                appear on the book page immediately.
                            </p>
                        )}

                        {(preview.names?.length > 0 || preview.updating?.length > 0) && (
                            <div className="mt-4 border border-[#E5E7EB] max-h-56 overflow-y-auto">
                                {preview.names?.map((nm) => (
                                    <div
                                        key={`a-${nm}`}
                                        className="px-3 py-1.5 text-[12px] text-[#002B5C] border-b border-[#E5E7EB] last:border-0"
                                    >
                                        <span className="font-mono text-[9px] uppercase tracking-wider text-[#3D9970] mr-2">
                                            new
                                        </span>
                                        {nm}
                                    </div>
                                ))}
                                {preview.updating?.map((nm) => (
                                    <div
                                        key={`u-${nm}`}
                                        className="px-3 py-1.5 text-[12px] text-[#002B5C] border-b border-[#E5E7EB] last:border-0"
                                    >
                                        <span className="font-mono text-[9px] uppercase tracking-wider text-[#4B5563] mr-2">
                                            update
                                        </span>
                                        {nm}
                                    </div>
                                ))}
                            </div>
                        )}
                        {n === 0 && (
                            <p className="mt-5 text-sm text-[#4B5563]">
                                Nothing to do — every author in the file is already here, with
                                everything the file carries.
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
                        data-testid="import-authors-apply"
                        className="bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                    >
                        {busy
                            ? "Working…"
                            : n === 0
                              ? "Nothing to do"
                              : [adds && `Add ${adds}`, updates && `Update ${updates}`]
                                    .filter(Boolean)
                                    .join(" · ")}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AdminAuthors() {
    // Deleting is admin-only; the server refuses it either way, this just
    // keeps a button off the screen that would only say no.
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);
    const [authors, setAuthors] = useState(null);
    const [importOpen, setImportOpen] = useState(false);
    const [mode, setMode] = useState("alpha");
    const [dirty, setDirty] = useState({});   // id -> true when edited but unsaved
    const [q, setQ] = useState("");
    const [cfg, setCfg] = useState({});        // layout + carousel settings

    const load = () =>
        adminListAuthors()
            .then((d) => {
                setAuthors(d.authors || []);
                setMode(d.order_mode || "alpha");
            })
            .catch(() => toast.error("Could not load authors."));

    useEffect(() => {
        load();
        fetchSettings().then(setCfg).catch(() => {});
    }, []);

    const saveCfg = async (key, value) => {
        setCfg((c) => ({ ...c, [key]: value }));
        try {
            await adminSetSetting(key, value);
            toast.success("Layout updated — live on the Authors page.");
        } catch {
            toast.error("Could not save layout.");
        }
    };

    if (!authors) return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;

    const grouped = cfg.authors_layout === "grouped";
    const autoplay = cfg.authors_carousel_autoplay !== false;
    const seconds = Number(cfg.authors_carousel_seconds) || 4;

    const change = (id, k, v) => {
        setAuthors((cur) => cur.map((a) => (a.id === id ? { ...a, [k]: v } : a)));
        setDirty((d) => ({ ...d, [id]: true }));
    };

    const saveOne = async (a) => {
        try {
            await adminUpdateAuthor(a.id, {
                name: a.name, bio: a.bio, photo: a.photo,
                affiliation: a.affiliation, specialty: a.specialty,
                category: a.category, enabled: a.enabled,
            });
            setDirty((d) => { const n = { ...d }; delete n[a.id]; return n; });
            toast.success(`Saved ${a.name}.`);
        } catch {
            toast.error("Save failed.");
        }
    };

    const del = async (a) => {
        if (!window.confirm(`Delete ${a.name}? This can't be undone.`)) return;
        try {
            await adminDeleteAuthor(a.id);
            setAuthors((cur) => cur.filter((x) => x.id !== a.id));
            toast.success("Author deleted.");
        } catch {
            toast.error("Delete failed.");
        }
    };

    const add = async () => {
        try {
            const created = await adminCreateAuthor({ name: "New author", enabled: false });
            setAuthors((cur) => [created, ...cur]);
            toast.success("Draft author added (hidden) — fill it in and Save.");
        } catch {
            toast.error("Could not add author.");
        }
    };

    const move = async (index, dir) => {
        const j = index + dir;
        if (j < 0 || j >= authors.length) return;
        const next = [...authors];
        [next[index], next[j]] = [next[j], next[index]];
        setAuthors(next);
        try {
            await adminReorderAuthors(next.map((a) => a.id));
        } catch {
            toast.error("Could not save order.");
        }
    };

    const switchMode = async (m) => {
        setMode(m);
        try {
            if (m === "custom") await adminReorderAuthors(authors.map((a) => a.id));
            else await adminSetAuthorOrderMode("alpha");
            toast.success(m === "custom" ? "Custom order on — drag with the arrows." : "Sorted A–Z.");
            load();
        } catch {
            toast.error("Could not change order.");
        }
    };

    const shown = authors.filter((a) => !q || (a.name || "").toLowerCase().includes(q.toLowerCase()));
    const hiddenCount = authors.filter((a) => a.enabled === false).length;

    return (
        <div data-testid="admin-authors-page">
            <div className="overline">Page editor</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Authors</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Add, edit, hide or remove authors, drag-and-drop a photo, and choose how the
                Authors page is ordered. Each row saves on its own — edit, then click the save
                icon. {authors.length} authors{hiddenCount ? `, ${hiddenCount} hidden` : ""}.
            </p>

            {/* ---- Layout & carousel ---- */}
            <div className="mt-6 border border-[#E5E7EB] bg-white p-5 max-w-3xl" data-testid="authors-layout-controls">
                <h2 className="font-serif text-lg text-[#002B5C]">Page layout</h2>
                <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4">
                    <div>
                        <label className="overline !text-[10px] block mb-1.5">Layout</label>
                        <div className="inline-flex border border-[#E5E7EB]">
                            <button
                                onClick={() => saveCfg("authors_layout", "grid")}
                                className={`px-3 py-1.5 text-sm ${!grouped ? "bg-[#002B5C] text-white" : "text-[#4B5563] hover:bg-[#F5F7FA]"}`}
                            >
                                One grid
                            </button>
                            <button
                                onClick={() => saveCfg("authors_layout", "grouped")}
                                className={`px-3 py-1.5 text-sm ${grouped ? "bg-[#002B5C] text-white" : "text-[#4B5563] hover:bg-[#F5F7FA]"}`}
                            >
                                Grouped by category
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="overline !text-[10px] block mb-1.5">Carousel auto-rotate</label>
                        <button
                            onClick={() => saveCfg("authors_carousel_autoplay", !autoplay)}
                            className={`px-3 py-1.5 text-sm border ${autoplay ? "bg-[#002B5C] text-white border-[#002B5C]" : "text-[#4B5563] border-[#E5E7EB] hover:bg-[#F5F7FA]"}`}
                        >
                            {autoplay ? "On" : "Off"}
                        </button>
                    </div>

                    <div>
                        <label className="overline !text-[10px] block mb-1.5">Rotate every (seconds)</label>
                        <input
                            type="number"
                            min="2"
                            max="30"
                            value={seconds}
                            disabled={!autoplay}
                            onChange={(e) => setCfg((c) => ({ ...c, authors_carousel_seconds: e.target.value }))}
                            onBlur={(e) => saveCfg("authors_carousel_seconds", Math.max(2, Number(e.target.value) || 4))}
                            className="w-24 border border-[#E5E7EB] px-3 py-1.5 text-sm outline-none focus:border-[#002B5C] disabled:opacity-50"
                        />
                    </div>
                </div>
                <p className="text-[11px] text-[#4B5563] mt-3">
                    {grouped
                        ? "Grouped: one auto-rotating row per category, using each author’s Category below. Set the category on every author you want to appear in a section."
                        : "One grid of authors with an auto-rotating carousel for the overflow."}
                </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                    onClick={add}
                    data-testid="admin-author-add"
                    className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-4 py-2 text-sm hover:bg-[#001F42]"
                >
                    <Plus size={15} strokeWidth={1.5} /> Add author
                </button>

                <button
                    onClick={() => setImportOpen(true)}
                    data-testid="admin-import-authors-button"
                    title="Add the authors credited on a book but missing from the roster"
                    className="inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm hover:bg-[#F5F7FA]"
                >
                    <UserPlus size={15} strokeWidth={1.5} /> Add missing
                </button>

                <div className="inline-flex border border-[#E5E7EB]">
                    <button
                        onClick={() => switchMode("alpha")}
                        className={`px-3 py-2 text-sm ${mode === "alpha" ? "bg-[#002B5C] text-white" : "text-[#4B5563] hover:bg-[#F5F7FA]"}`}
                    >
                        A–Z
                    </button>
                    <button
                        onClick={() => switchMode("custom")}
                        className={`px-3 py-2 text-sm ${mode === "custom" ? "bg-[#002B5C] text-white" : "text-[#4B5563] hover:bg-[#F5F7FA]"}`}
                    >
                        Custom order
                    </button>
                </div>

                <div className="relative ml-auto">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Filter by name"
                        className="border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C] w-48"
                    />
                    {q && (
                        <button onClick={() => setQ("")} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#4B5563]">
                            <X size={14} strokeWidth={1.5} />
                        </button>
                    )}
                </div>
            </div>

            {mode === "alpha" && (
                <p className="text-[11px] text-[#4B5563] mt-3">
                    Sorted A–Z. Switch to <strong>Custom order</strong> to drag authors into your
                    own sequence.
                </p>
            )}

            <div className="mt-5 space-y-2 max-w-3xl">
                {shown.map((a, i) => (
                    <AuthorRow
                        key={a.id}
                        a={a}
                        index={authors.indexOf(a)}
                        count={authors.length}
                        mode={q ? "alpha" : mode}
                        dirty={!!dirty[a.id]}
                        onChange={(k, v) => change(a.id, k, v)}
                        onSave={() => saveOne(a)}
                        onDelete={mayDelete ? () => del(a) : null}
                        onMove={(dir) => move(authors.indexOf(a), dir)}
                    />
                ))}
                {shown.length === 0 && (
                    <div className="text-sm text-[#4B5563] border border-dashed border-[#E5E7EB] p-6 text-center">
                        No authors match “{q}”.
                    </div>
                )}
            </div>
            {importOpen && (
                <ImportAuthorsDialog
                    onClose={() => setImportOpen(false)}
                    onDone={load}
                />
            )}
        </div>
    );
}
