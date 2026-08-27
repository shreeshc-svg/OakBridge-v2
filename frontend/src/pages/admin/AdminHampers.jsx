import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Plus, Trash2, GripVertical, X, Search, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import {
    adminListHampers,
    adminCreateHamper,
    adminUpdateHamper,
    adminDeleteHamper,
    adminReorderHampers,
    adminHamperDefaults,
    fetchBooks,
    fetchSiteContent,
    adminSetSiteContent,
    formatINR,
    formatApiError,
    mediaUrl,
    adminUploadCover,
} from "../../lib/api";

/**
 * Admin → Gift Hampers. Full SCRUD, plus the two things around a hamper that
 * are not the hamper: the photo banner and the /gifting page copy.
 *
 * The contents builder is the reason this screen exists rather than a couple of
 * extra fields on Admin → Books. A hamper line either points at a catalogue
 * title — in which case its cover, author and price are read live and cannot go
 * stale — or it is a free-text good like a bookmark set. Those are different
 * enough that a single "items" textarea would get filled in wrong.
 */

const BLANK = {
    title: "", subtitle: "", description: "", price: 0, cover_image: "",
    gallery: [], sku: "", stock: 0, occasion: "", order_by: "",
    hamper_items: [], hamper_copy: {}, gift_message_enabled: true,
    bulk_enquiry: true, enabled: true, order: 0,
};

function Field({ label, hint, children }) {
    return (
        <label className="block">
            <span className="overline !text-[10px]">{label}</span>
            {hint && <span className="block text-[11px] text-[#9CA3AF] mt-0.5">{hint}</span>}
            <div className="mt-1.5">{children}</div>
        </label>
    );
}

const input =
    "w-full border border-[#E5E7EB] px-3 py-2.5 text-base md:text-sm outline-none focus:border-[#002B5C]";

/** Upload a picture and hand back its stored path. */
function ImagePicker({ value, onChange, label, hint }) {
    const [busy, setBusy] = useState(false);
    const pick = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const res = await adminUploadCover(file);
            onChange(res.url);
            toast.success("Image uploaded.");
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Field label={label} hint={hint}>
            <div className="flex items-start gap-3">
                <div className="w-24 h-24 border border-[#E5E7EB] bg-[#F5F7FA] flex items-center justify-center overflow-hidden shrink-0">
                    {value ? (
                        <img src={mediaUrl(value)} alt={label} className="w-full h-full object-cover" />
                    ) : (
                        <ImageIcon size={18} className="text-[#9CA3AF]" strokeWidth={1.5} />
                    )}
                </div>
                <div className="flex-1">
                    <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => pick(e.target.files?.[0])}
                        className="text-xs"
                    />
                    {busy && <div className="text-xs text-[#4B5563] mt-1">Uploading…</div>}
                    {value && (
                        <button
                            onClick={() => onChange("")}
                            className="block text-xs text-[#CC0033] mt-2 hover:underline"
                        >
                            Remove
                        </button>
                    )}
                </div>
            </div>
        </Field>
    );
}

/** Pick a catalogue title, or type a free-text good. */
function ContentsBuilder({ items, onChange, books }) {
    const [q, setQ] = useState("");
    const matches = useMemo(() => {
        const n = q.trim().toLowerCase();
        if (!n) return [];
        return books.filter((b) => (b.title || "").toLowerCase().includes(n)).slice(0, 6);
    }, [q, books]);

    const set = (i, patch) =>
        onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    const remove = (i) => onChange(items.filter((_, j) => j !== i));

    return (
        <div>
            <div className="overline !text-[10px] mb-2">What's inside</div>

            {items.length === 0 && (
                <p className="text-xs text-[#4B5563] mb-3">
                    Nothing added yet. A hamper with no contents still sells — it just shows
                    no list.
                </p>
            )}

            <div className="border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                {items.map((it, i) => (
                    <div key={i} className="p-3 flex gap-3 items-start">
                        <div className="flex-1 grid sm:grid-cols-[1fr_110px_80px] gap-2">
                            <input
                                value={it.label || ""}
                                onChange={(e) => set(i, { label: e.target.value })}
                                placeholder={it.book_id ? "(title from the catalogue)" : "e.g. Brass bookmarks, set of 4"}
                                disabled={Boolean(it.book_id)}
                                data-testid={`hamper-item-label-${i}`}
                                className={`${input} ${it.book_id ? "bg-[#F5F7FA] text-[#4B5563]" : ""}`}
                            />
                            <input
                                type="number"
                                value={it.value ?? 0}
                                onChange={(e) => set(i, { value: Number(e.target.value) })}
                                placeholder="Value ₹"
                                className={input}
                            />
                            <input
                                type="number"
                                min={1}
                                value={it.qty ?? 1}
                                onChange={(e) => set(i, { qty: Math.max(1, Number(e.target.value)) })}
                                placeholder="Qty"
                                className={input}
                            />
                            {!it.book_id && (
                                <input
                                    value={it.note || ""}
                                    onChange={(e) => set(i, { note: e.target.value })}
                                    placeholder="Short description (optional)"
                                    className={`${input} sm:col-span-3`}
                                />
                            )}
                            {it.book_id && (
                                <div className="sm:col-span-3 text-[11px] text-[#4B5563]">
                                    Linked to a catalogue title — cover, author and price come from
                                    the book record, and each sale takes {it.qty ?? 1} copy off its
                                    stock.
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => remove(i)}
                            aria-label="Remove this item"
                            data-testid={`hamper-item-remove-${i}`}
                            className="text-[#CC0033] hover:opacity-70 mt-2.5"
                        >
                            <Trash2 size={15} strokeWidth={1.5} />
                        </button>
                    </div>
                ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 items-start">
                <div className="relative flex-1 min-w-[240px]">
                    <Search size={14} className="absolute left-3 top-3 text-[#9CA3AF]" strokeWidth={1.5} />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search a title to add…"
                        data-testid="hamper-book-search"
                        className={`${input} pl-9`}
                    />
                    {matches.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 bg-white border border-[#E5E7EB] shadow-lg">
                            {matches.map((b) => (
                                <button
                                    key={b.id}
                                    onClick={() => {
                                        onChange([...items, { book_id: b.id, label: b.title, qty: 1, value: 0 }]);
                                        setQ("");
                                    }}
                                    className="block w-full text-left px-3 py-2 text-sm hover:bg-[#F5F7FA]"
                                >
                                    {b.title}
                                    <span className="text-[#4B5563] text-xs"> · {formatINR(b.price)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <button
                    onClick={() => onChange([...items, { label: "", qty: 1, value: 0 }])}
                    data-testid="hamper-add-free-item"
                    className="border border-[#002B5C] text-[#002B5C] px-4 py-2.5 text-sm hover:bg-[#F5F7FA]"
                >
                    <Plus size={14} className="inline mr-1" strokeWidth={1.5} />
                    Add something that isn't a book
                </button>
            </div>
        </div>
    );
}

/** Every editable string, rendered from the server's defaults list. */
function CopyEditor({ copy, defaults, onChange }) {
    const keys = Object.keys(defaults || {}).filter((k) => k !== "assurances");
    return (
        <div>
            <p className="text-xs text-[#4B5563] mb-3 leading-relaxed">
                Leave a box empty to use the wording shown as a placeholder. Note that once
                you save a value here it wins permanently — changing the default in code
                will no longer move this page.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
                {keys.map((k) => (
                    <Field key={k} label={k.replace(/_/g, " ")}>
                        <input
                            value={copy[k] ?? ""}
                            onChange={(e) => onChange({ ...copy, [k]: e.target.value })}
                            placeholder={String(defaults[k] ?? "")}
                            data-testid={`hamper-copy-${k}`}
                            className={input}
                        />
                    </Field>
                ))}
            </div>
        </div>
    );
}

export default function AdminHampers() {
    const [rows, setRows] = useState([]);
    const [books, setBooks] = useState([]);
    const [defaults, setDefaults] = useState({ copy: {}, page: {}, banner: {} });
    const [editing, setEditing] = useState(null);
    const [tab, setTab] = useState("details");
    const [q, setQ] = useState("");
    const [banner, setBanner] = useState({});
    const [page, setPage] = useState({});
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await adminListHampers(q);
            setRows(res.hampers || []);
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setLoading(false);
        }
    }, [q]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        adminHamperDefaults().then(setDefaults).catch(() => {});
        // limit=500 because the default page is 60 and the picker searches the
        // whole catalogue. /books already excludes hampers, so a hamper cannot
        // be put inside another hamper.
        fetchBooks({ limit: 500 })
            .then((b) => setBooks(Array.isArray(b) ? b : b?.books || []))
            .catch(() => {});
        fetchSiteContent()
            .then((c) => {
                setBanner(c?.hamper_banner || {});
                setPage(c?.gifting_page || {});
            })
            .catch(() => {});
    }, []);

    const save = async () => {
        if (!editing.title?.trim()) return toast.error("A hamper needs a name.");
        try {
            if (editing.id) {
                await adminUpdateHamper(editing.id, editing);
                toast.success("Hamper updated.");
            } else {
                await adminCreateHamper(editing);
                toast.success("Hamper created.");
            }
            setEditing(null);
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const remove = async (h) => {
        if (!window.confirm(`Delete "${h.title}"? Orders already placed keep their own record and are not affected.`))
            return;
        try {
            await adminDeleteHamper(h.id);
            toast.success("Hamper deleted.");
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const move = async (i, dir) => {
        const next = [...rows];
        const j = i + dir;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        setRows(next);
        try {
            await adminReorderHampers(next.map((r) => r.id));
        } catch (err) {
            toast.error(formatApiError(err));
            load();
        }
    };

    const saveContent = async (key, value, label) => {
        try {
            await adminSetSiteContent(key, value);
            toast.success(`${label} saved.`);
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    return (
        <div data-testid="admin-hampers-page">
            <div className="overline">Catalogue</div>
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">Gift Hampers ({rows.length})</h1>
                <button
                    onClick={() => {
                        setEditing({ ...BLANK });
                        setTab("details");
                    }}
                    data-testid="admin-new-hamper"
                    className="mt-3 inline-flex items-center gap-2 bg-[#002B5C] text-white px-4 py-2 text-sm font-medium hover:bg-[#001F42]"
                >
                    <Gift size={15} strokeWidth={1.5} />
                    New hamper
                </button>
            </div>

            {/* ---------------- banner ---------------- */}
            <div className="mt-8 border border-[#E5E7EB] p-6">
                <div className="overline !text-[10px]">Homepage banner</div>
                <p className="text-xs text-[#4B5563] mt-1.5 mb-4 leading-relaxed">
                    A photograph you upload — no text is drawn over it. Upload a separate
                    mobile crop, or a wide banner will shrink until nothing on it is legible.
                </p>
                <div className="grid sm:grid-cols-2 gap-6">
                    <ImagePicker
                        label="Desktop image"
                        value={banner.image}
                        onChange={(v) => setBanner((b) => ({ ...b, image: v }))}
                    />
                    <ImagePicker
                        label="Mobile image"
                        hint="Optional — falls back to the desktop one"
                        value={banner.image_mobile}
                        onChange={(v) => setBanner((b) => ({ ...b, image_mobile: v }))}
                    />
                    <Field label="Alt text" hint="Read aloud by screen readers, and shown if the image fails">
                        <input
                            value={banner.alt || ""}
                            onChange={(e) => setBanner((b) => ({ ...b, alt: e.target.value }))}
                            placeholder="Oakbridge Rakhi gift hampers"
                            data-testid="banner-alt"
                            className={input}
                        />
                    </Field>
                    <Field label="Links to">
                        <input
                            value={banner.link || ""}
                            onChange={(e) => setBanner((b) => ({ ...b, link: e.target.value }))}
                            placeholder="/gifting"
                            className={input}
                        />
                    </Field>
                </div>
                <div className="flex items-center gap-4 mt-5">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                            type="checkbox"
                            checked={Boolean(banner.enabled)}
                            onChange={(e) => setBanner((b) => ({ ...b, enabled: e.target.checked }))}
                            data-testid="banner-enabled"
                            className="accent-[#002B5C] w-4 h-4"
                        />
                        Show on the homepage
                    </label>
                    <button
                        onClick={() => saveContent("hamper_banner", banner, "Banner")}
                        data-testid="banner-save"
                        className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42]"
                    >
                        Save banner
                    </button>
                    {banner.enabled && !banner.image && (
                        <span className="text-xs text-[#CC0033] flex items-center gap-1.5">
                            <AlertTriangle size={13} strokeWidth={1.5} />
                            Switched on but no image — nothing will show.
                        </span>
                    )}
                </div>
            </div>

            {/* ---------------- gifting page copy ---------------- */}
            <div className="mt-6 border border-[#E5E7EB] p-6">
                <div className="overline !text-[10px]">The /gifting page</div>
                <div className="grid sm:grid-cols-2 gap-4 mt-4">
                    {Object.keys(defaults.page || {}).map((k) => (
                        <Field key={k} label={k}>
                            <input
                                value={page[k] ?? ""}
                                onChange={(e) => setPage((p) => ({ ...p, [k]: e.target.value }))}
                                placeholder={String(defaults.page[k] ?? "")}
                                data-testid={`gifting-page-${k}`}
                                className={input}
                            />
                        </Field>
                    ))}
                </div>
                <button
                    onClick={() => saveContent("gifting_page", page, "Page copy")}
                    className="mt-5 bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42]"
                >
                    Save page copy
                </button>
            </div>

            {/* ---------------- list ---------------- */}
            <div className="mt-8 relative max-w-md">
                <Search size={15} className="absolute left-3 top-3 text-[#9CA3AF]" strokeWidth={1.5} />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search hampers…"
                    data-testid="hamper-search"
                    className={`${input} pl-9`}
                />
            </div>

            {loading ? (
                <p className="mt-6 text-sm text-[#4B5563]">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="mt-6 text-sm text-[#4B5563]">No hampers yet.</p>
            ) : (
                <div className="mt-4 border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                    {rows.map((h, i) => (
                        <div key={h.id} data-testid={`hamper-row-${h.id}`} className="p-4 flex gap-4 items-center">
                            <div className="flex flex-col text-[#9CA3AF]">
                                <button onClick={() => move(i, -1)} aria-label="Move up" className="hover:text-[#002B5C]">▲</button>
                                <GripVertical size={13} strokeWidth={1.5} />
                                <button onClick={() => move(i, 1)} aria-label="Move down" className="hover:text-[#002B5C]">▼</button>
                            </div>
                            <div className="w-14 h-14 border border-[#E5E7EB] bg-[#F5F7FA] shrink-0 overflow-hidden">
                                {h.cover_image && (
                                    <img src={mediaUrl(h.cover_image)} alt={h.title} className="w-full h-full object-cover" />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="font-medium text-[#002B5C]">
                                    {h.title}
                                    {!h.enabled && (
                                        <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-[#4B5563] border border-[#E5E7EB] px-1.5 py-0.5">
                                            Hidden
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-[#4B5563] mt-0.5">
                                    {formatINR(h.price)} · {h.stock} in stock · {h.hamper_items?.length || 0} items
                                    {h.occasion ? ` · ${h.occasion}` : ""}
                                </div>
                                {h.short_components?.length > 0 && (
                                    <div className="text-xs text-[#CC0033] mt-1 flex items-start gap-1.5">
                                        <AlertTriangle size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                                        Not enough stock to build every box: {h.short_components.join(", ")}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => {
                                    setEditing({ ...BLANK, ...h });
                                    setTab("details");
                                }}
                                data-testid={`hamper-edit-${h.id}`}
                                className="border border-[#002B5C] text-[#002B5C] px-3 py-1.5 text-sm hover:bg-[#F5F7FA]"
                            >
                                Edit
                            </button>
                            <button
                                onClick={() => remove(h)}
                                data-testid={`hamper-delete-${h.id}`}
                                className="border border-[#CC0033] text-[#CC0033] px-3 py-1.5 text-sm hover:bg-[#FEF2F2]"
                            >
                                <Trash2 size={14} strokeWidth={1.5} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* ---------------- editor ---------------- */}
            {editing && (
                <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto p-4 flex items-start justify-center">
                    <div className="bg-white border border-[#E5E7EB] w-full max-w-3xl my-8">
                        <div className="flex items-start justify-between gap-4 bg-[#002B5C] text-white px-6 py-4">
                            <h2 className="font-serif text-xl">
                                {editing.id ? "Edit hamper" : "New hamper"}
                            </h2>
                            <button onClick={() => setEditing(null)} aria-label="Close" className="text-white/70 hover:text-white">
                                <X size={18} strokeWidth={1.5} />
                            </button>
                        </div>

                        <div className="flex border-b border-[#E5E7EB]">
                            {["details", "contents", "wording"].map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setTab(t)}
                                    data-testid={`hamper-tab-${t}`}
                                    className={`px-5 py-3 text-sm capitalize ${
                                        tab === t
                                            ? "border-b-2 border-[#002B5C] text-[#002B5C] font-medium"
                                            : "text-[#4B5563]"
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>

                        <div className="p-6 space-y-5">
                            {tab === "details" && (
                                <>
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <Field label="Name"><input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} data-testid="hamper-title" className={input} /></Field>
                                        <Field label="SKU"><input value={editing.sku || ""} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} className={input} /></Field>
                                        <Field label="Subtitle"><input value={editing.subtitle || ""} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} className={input} /></Field>
                                        <Field label="Occasion" hint="Shown above the name"><input value={editing.occasion || ""} onChange={(e) => setEditing({ ...editing, occasion: e.target.value })} placeholder="Raksha Bandhan" className={input} /></Field>
                                        <Field label="Price ₹"><input type="number" value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} data-testid="hamper-price" className={input} /></Field>
                                        <Field label="Boxes available"><input type="number" value={editing.stock} onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value) })} data-testid="hamper-stock" className={input} /></Field>
                                        <Field label="Order-by date" hint="The page hides the deadline once it passes"><input type="date" value={(editing.order_by || "").slice(0, 10)} onChange={(e) => setEditing({ ...editing, order_by: e.target.value })} className={input} /></Field>
                                    </div>
                                    <Field label="Description">
                                        <textarea rows={4} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={`${input} resize-none`} />
                                    </Field>
                                    <ImagePicker label="Main photograph" value={editing.cover_image} onChange={(v) => setEditing({ ...editing, cover_image: v })} />
                                    <div className="flex flex-wrap gap-5">
                                        {[
                                            ["enabled", "Visible on the site"],
                                            ["gift_message_enabled", "Offer a gift message"],
                                            ["bulk_enquiry", "Show the bulk gifting block"],
                                        ].map(([k, label]) => (
                                            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                                                <input type="checkbox" checked={Boolean(editing[k])} onChange={(e) => setEditing({ ...editing, [k]: e.target.checked })} data-testid={`hamper-${k}`} className="accent-[#002B5C] w-4 h-4" />
                                                {label}
                                            </label>
                                        ))}
                                    </div>
                                </>
                            )}

                            {tab === "contents" && (
                                <ContentsBuilder
                                    items={editing.hamper_items || []}
                                    onChange={(v) => setEditing({ ...editing, hamper_items: v })}
                                    books={books}
                                />
                            )}

                            {tab === "wording" && (
                                <CopyEditor
                                    copy={editing.hamper_copy || {}}
                                    defaults={defaults.copy}
                                    onChange={(v) => setEditing({ ...editing, hamper_copy: v })}
                                />
                            )}
                        </div>

                        <div className="flex items-center gap-3 px-6 py-4 border-t border-[#E5E7EB]">
                            <button onClick={save} data-testid="hamper-save" className="bg-[#002B5C] text-white px-6 py-2.5 text-sm font-medium hover:bg-[#001F42]">
                                {editing.id ? "Save changes" : "Create hamper"}
                            </button>
                            <button onClick={() => setEditing(null)} className="text-sm text-[#4B5563] hover:text-[#002B5C]">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
