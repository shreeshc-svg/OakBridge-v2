import React, { useEffect, useMemo, useState } from "react";
import { Package, Plus, Trash2, X, Search, Copy, ArrowUp, ArrowDown, Eye, EyeOff, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
    adminListPacks, adminCreatePack, adminUpdatePack, adminDeletePack,
    adminDuplicatePack, adminReorderPacks, adminUploadCover, fetchBooks,
    fetchCategories, formatApiError, formatINR, mediaUrl,
} from "../../lib/api";
import { canDelete } from "../../lib/rbac";
import { useAuth } from "../../context/AuthContext";

/**
 * Admin → Packs.
 *
 * A pack is one shrink-wrapped product with its own ISBN, stock and price,
 * listing the 2–6 catalogue books inside it (see backend/packs.py). It has its
 * own screen, deliberately apart from Books, so a pack is never edited as if it
 * were a title — the Books tab filters packs out.
 *
 * Pricing: a fixed price, or a percentage off the pack's OWN MRP. The server
 * computes the stored price either way; the preview here mirrors that rule so
 * the admin sees the number before saving, and the server's answer wins.
 */

const BLANK = {
    title: "", subtitle: "", isbn: "", category: "", subject: "Pack",
    description: "", cover_image: "", original_price: "", pricing_mode: "fixed",
    pricing_value: "", stock: 0, enabled: true, pack_items: [],
};

/* Mirrors packs.compute_price. Returns { price } or { error }. */
function previewPrice(mrp, mode, value) {
    const m = Number(mrp), v = Number(value);
    if (!(m > 0)) return { error: "Enter the pack's MRP." };
    if (mode === "fixed") {
        if (!(v > 0)) return { error: "Enter the price." };
        if (v > m) return { error: "Price cannot be higher than the MRP." };
        return { price: v };
    }
    if (!(v > 0 && v < 100)) return { error: "Percentage must be between 0 and 100." };
    return { price: Math.round((m * (100 - v)) / 100) };
}

function PackEditor({ initial, categories, catalogue, onClose, onSaved }) {
    const isEdit = Boolean(initial?.id);
    const [f, setF] = useState(() => ({
        ...BLANK,
        ...(initial || {}),
        pricing_mode: initial?.pack_pricing?.mode || "fixed",
        pricing_value: initial?.pack_pricing?.value ?? initial?.price ?? "",
        pack_items: (initial?.pack_items || []).map((x) => x.book_id),
    }));
    const [q, setQ] = useState("");
    const [busy, setBusy] = useState(false);
    const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

    const byId = useMemo(() => Object.fromEntries(catalogue.map((b) => [b.id, b])), [catalogue]);
    const matches = useMemo(() => {
        const n = q.trim().toLowerCase();
        if (n.length < 2) return [];
        return catalogue
            .filter((b) => !f.pack_items.includes(b.id))
            .filter((b) => `${b.title} ${b.author} ${b.isbn}`.toLowerCase().includes(n))
            .slice(0, 8);
    }, [q, catalogue, f.pack_items]);

    const pv = previewPrice(f.original_price, f.pricing_mode, f.pricing_value);
    const move = (i, d) =>
        setF((s) => {
            const a = [...s.pack_items];
            const j = i + d;
            if (j < 0 || j >= a.length) return s;
            [a[i], a[j]] = [a[j], a[i]];
            return { ...s, pack_items: a };
        });

    const upload = async (file) => {
        if (!file) return;
        try {
            const r = await adminUploadCover(file);
            set("cover_image", r.url);
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };

    const save = async () => {
        if (f.pack_items.length < 2) return toast.error("A pack needs at least 2 books.");
        if (pv.error) return toast.error(pv.error);
        setBusy(true);
        const payload = {
            title: f.title.trim(), subtitle: (f.subtitle || "").trim() || null,
            isbn: (f.isbn || "").trim(), category: f.category, subject: f.subject || "Pack",
            description: f.description || "", cover_image: f.cover_image || "",
            original_price: Number(f.original_price), pricing_mode: f.pricing_mode,
            pricing_value: Number(f.pricing_value), stock: Number(f.stock) || 0,
            enabled: Boolean(f.enabled), pack_items: f.pack_items,
        };
        try {
            if (isEdit) await adminUpdatePack(initial.id, payload);
            else await adminCreatePack(payload);
            toast.success(isEdit ? "Pack saved." : "Pack created.");
            onSaved();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };

    const input = "w-full border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]";
    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" data-testid="pack-editor">
            <div className="w-full max-w-2xl bg-white h-full overflow-y-auto p-6">
                <div className="flex items-center justify-between">
                    <h2 className="font-serif text-2xl text-[#002B5C]">{isEdit ? "Edit pack" : "New pack"}</h2>
                    <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4">
                    <label className="col-span-2 text-xs text-[#4B5563]">Title *
                        <input className={input} value={f.title} onChange={(e) => set("title", e.target.value)} data-testid="pack-title" />
                    </label>
                    <label className="col-span-2 text-xs text-[#4B5563]">Subtitle
                        <input className={input} value={f.subtitle || ""} onChange={(e) => set("subtitle", e.target.value)} />
                    </label>
                    <label className="text-xs text-[#4B5563]">Pack ISBN * <span className="text-[#4B5563]/70">(the pack's own)</span>
                        <input className={input} value={f.isbn} onChange={(e) => set("isbn", e.target.value)} data-testid="pack-isbn" />
                    </label>
                    <label className="text-xs text-[#4B5563]">Category *
                        <select className={input} value={f.category} onChange={(e) => set("category", e.target.value)} data-testid="pack-category">
                            <option value="">Choose…</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </label>
                    <label className="col-span-2 text-xs text-[#4B5563]">Description
                        <textarea rows={3} className={input} value={f.description} onChange={(e) => set("description", e.target.value)} />
                    </label>
                </div>

                {/* Books in the pack */}
                <div className="mt-6">
                    <div className="overline !text-[10px]">Books in this pack ({f.pack_items.length}) — 2 to 6</div>
                    <ul className="mt-2 border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                        {f.pack_items.length === 0 && <li className="p-3 text-xs text-[#4B5563]">No books yet — search below.</li>}
                        {f.pack_items.map((id, i) => {
                            const b = byId[id];
                            return (
                                <li key={id} className="flex items-center gap-3 p-2" data-testid={`pack-item-row-${id}`}>
                                    <span className="w-8 h-11 bg-[#F5F7FA] border border-[#E5E7EB] shrink-0 overflow-hidden">
                                        {b?.cover_image && <img src={mediaUrl(b.cover_image)} alt={b.title} className="w-full h-full object-contain" />}
                                    </span>
                                    <span className="flex-1 min-w-0 text-sm text-[#002B5C] truncate">
                                        {b ? b.title : `Missing book (${id})`}
                                        {b && <span className="block text-xs text-[#4B5563] truncate">{b.author} · {b.isbn}</span>}
                                    </span>
                                    <button type="button" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0} className="p-1 disabled:opacity-30"><ArrowUp size={13} /></button>
                                    <button type="button" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === f.pack_items.length - 1} className="p-1 disabled:opacity-30"><ArrowDown size={13} /></button>
                                    <button type="button" onClick={() => set("pack_items", f.pack_items.filter((x) => x !== id))} aria-label="Remove" className="p-1 text-[#CC0033]"><X size={14} /></button>
                                </li>
                            );
                        })}
                    </ul>
                    {f.pack_items.length < 6 && (
                        <div className="mt-2 relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                            <input className={`${input} pl-8`} placeholder="Add a book — search title, author or ISBN" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pack-book-search" />
                            {matches.length > 0 && (
                                <ul className="absolute z-10 left-0 right-0 bg-white border border-[#E5E7EB] shadow max-h-64 overflow-y-auto">
                                    {matches.map((b) => (
                                        <li key={b.id}>
                                            <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-[#F5F7FA]"
                                                onClick={() => { set("pack_items", [...f.pack_items, b.id]); setQ(""); }}>
                                                {b.title}<span className="block text-xs text-[#4B5563]">{b.author} · {b.isbn}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                {/* Pricing */}
                <div className="mt-6 grid grid-cols-2 gap-4">
                    <label className="text-xs text-[#4B5563]">Pack MRP (₹) *
                        <input type="number" min="0" className={input} value={f.original_price} onChange={(e) => set("original_price", e.target.value)} data-testid="pack-mrp" />
                    </label>
                    <div className="text-xs text-[#4B5563]">Pricing
                        <div className="flex gap-4 mt-2">
                            <label className="flex items-center gap-1.5"><input type="radio" checked={f.pricing_mode === "fixed"} onChange={() => set("pricing_mode", "fixed")} /> Fixed price</label>
                            <label className="flex items-center gap-1.5"><input type="radio" checked={f.pricing_mode === "percent"} onChange={() => set("pricing_mode", "percent")} /> % off MRP</label>
                        </div>
                    </div>
                    <label className="text-xs text-[#4B5563]">{f.pricing_mode === "fixed" ? "Selling price (₹) *" : "Percentage off *"}
                        <input type="number" min="0" className={input} value={f.pricing_value} onChange={(e) => set("pricing_value", e.target.value)} data-testid="pack-pricing-value" />
                    </label>
                    <div className="text-xs self-end pb-2" data-testid="pack-price-preview">
                        {pv.error ? <span className="text-[#CC0033]">{pv.error}</span> : (
                            <span className="text-[#002B5C]">
                                Customer pays <strong>{formatINR(pv.price)}</strong>
                                {Number(f.original_price) > pv.price && (
                                    <> · MRP {formatINR(f.original_price)} · {Math.round(100 - (pv.price / Number(f.original_price)) * 100)}% off</>
                                )}
                            </span>
                        )}
                    </div>
                    <p className="col-span-2 text-[11px] text-[#4B5563]">
                        % off is applied to the pack's own MRP, never to the sum of the books inside. From 1 Jan 2027 a
                        struck-through price must be one the pack actually sold at.
                    </p>
                    <label className="text-xs text-[#4B5563]">Stock (packs) *
                        <input type="number" min="0" className={input} value={f.stock} onChange={(e) => set("stock", e.target.value)} data-testid="pack-stock" />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[#002B5C] self-end pb-2">
                        <input type="checkbox" checked={Boolean(f.enabled)} onChange={(e) => set("enabled", e.target.checked)} /> Live on the site
                    </label>
                </div>

                {/* Cover */}
                <div className="mt-6">
                    <div className="overline !text-[10px]">Pack cover</div>
                    <div className="mt-2 flex items-center gap-4">
                        <span className="w-16 h-24 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden">
                            {f.cover_image && <img src={mediaUrl(f.cover_image)} alt="Pack cover" className="w-full h-full object-contain" />}
                        </span>
                        <input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} className="text-xs" />
                    </div>
                </div>

                <div className="mt-8 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[#E5E7EB]">Cancel</button>
                    <button type="button" onClick={save} disabled={busy} data-testid="pack-save"
                        className="px-5 py-2 text-sm bg-[#002B5C] text-white disabled:opacity-50">
                        {busy ? "Saving…" : isEdit ? "Save pack" : "Create pack"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AdminPacks() {
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);
    const [rows, setRows] = useState(null);
    const [q, setQ] = useState("");
    const [enabled, setEnabled] = useState("all");
    const [sort, setSort] = useState("order");
    const [editing, setEditing] = useState(null); // null | {} | pack
    const [categories, setCategories] = useState([]);
    const [catalogue, setCatalogue] = useState([]);

    const load = () =>
        adminListPacks({ q, enabled, sort })
            .then((d) => setRows(d?.packs || []))
            .catch((e) => { toast.error(formatApiError(e)); setRows([]); });

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [q, enabled, sort]);
    useEffect(() => {
        fetchCategories().then((c) => setCategories(c || [])).catch(() => {});
        // The picker offers books only — never a pack or a hamper inside a pack.
        fetchBooks({ limit: 1000 })
            .then((l) => setCatalogue((l || []).filter((b) => !["pack", "hamper"].includes(b.product_type))))
            .catch(() => {});
    }, []);

    const act = async (fn, ok) => {
        try { await fn(); if (ok) toast.success(ok); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const reorder = (i, d) => {
        const a = [...rows];
        const j = i + d;
        if (j < 0 || j >= a.length) return;
        [a[i], a[j]] = [a[j], a[i]];
        setRows(a);
        act(() => adminReorderPacks(a.map((r) => r.id)));
    };

    return (
        <div data-testid="admin-packs">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-serif text-3xl text-[#002B5C] flex items-center gap-2"><Package size={24} /> Packs</h1>
                    <p className="text-sm text-[#4B5563] mt-1">
                        Shrink-wrapped sets of 2–6 books with their own ISBN, price and stock. Listed in the bookstore and search.
                    </p>
                </div>
                <button type="button" onClick={() => setEditing({})} data-testid="pack-new"
                    className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-4 py-2 text-sm"><Plus size={15} /> New pack</button>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 items-center">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, ISBN, author"
                        className="border border-[#E5E7EB] pl-8 pr-3 py-2 text-sm w-64" data-testid="packs-search" />
                </div>
                <select value={enabled} onChange={(e) => setEnabled(e.target.value)} className="border border-[#E5E7EB] px-3 py-2 text-sm" data-testid="packs-filter">
                    <option value="all">All</option><option value="on">Live</option><option value="off">Hidden</option>
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="border border-[#E5E7EB] px-3 py-2 text-sm" data-testid="packs-sort">
                    <option value="order">Display order</option><option value="title">Title A–Z</option>
                    <option value="price_asc">Price: low → high</option><option value="price_desc">Price: high → low</option>
                    <option value="stock">Stock: low → high</option><option value="newest">Newest</option>
                </select>
                {sort !== "order" && <span className="text-xs text-[#4B5563]">Reordering is available in Display order.</span>}
            </div>

            <div className="mt-4 border border-[#E5E7EB]">
                {rows === null && <p className="p-5 text-sm text-[#4B5563]">Loading…</p>}
                {rows && rows.length === 0 && <p className="p-5 text-sm text-[#4B5563]">No packs yet.</p>}
                {(rows || []).map((p, i) => (
                    <div key={p.id} className={`flex items-center gap-4 px-4 py-3 border-b border-[#E5E7EB] last:border-b-0 ${p.enabled === false ? "bg-[#F5F7FA]" : ""}`} data-testid={`pack-row-${p.id}`}>
                        {sort === "order" && (
                            <div className="flex flex-col">
                                <button type="button" onClick={() => reorder(i, -1)} disabled={i === 0} aria-label="Move up" className="p-0.5 disabled:opacity-30"><ArrowUp size={12} /></button>
                                <button type="button" onClick={() => reorder(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" className="p-0.5 disabled:opacity-30"><ArrowDown size={12} /></button>
                            </div>
                        )}
                        <span className="w-10 h-14 bg-[#F5F7FA] border border-[#E5E7EB] shrink-0 overflow-hidden">
                            {p.cover_image && <img src={mediaUrl(p.cover_image)} alt={p.title} className="w-full h-full object-contain" />}
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#002B5C] truncate">{p.title}</div>
                            <div className="text-xs text-[#4B5563] truncate">
                                {p.isbn || <span className="text-[#CC0033]">No ISBN</span>} · {(p.pack_items || []).length} books · {p.category}
                            </div>
                        </div>
                        <div className="text-right text-sm shrink-0">
                            <div className="text-[#002B5C]">{formatINR(p.price)}</div>
                            {p.original_price > p.price && <div className="text-xs text-[#4B5563] line-through">{formatINR(p.original_price)}</div>}
                        </div>
                        <div className={`text-xs w-16 text-right shrink-0 ${p.stock <= 0 ? "text-[#CC0033] font-medium" : "text-[#4B5563]"}`}>
                            {p.stock <= 0 ? "Out of stock" : `${p.stock} in stock`}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button type="button" title={p.enabled === false ? "Hidden — click to make live" : "Live — click to hide"}
                                onClick={() => act(() => adminUpdatePack(p.id, { enabled: p.enabled === false }), p.enabled === false ? "Pack is live." : "Pack hidden.")}
                                className="p-1.5 text-[#4B5563] hover:text-[#002B5C]">
                                {p.enabled === false ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                            <button type="button" title="Edit" onClick={() => setEditing(p)} className="p-1.5 text-[#4B5563] hover:text-[#002B5C]"><Pencil size={15} /></button>
                            <button type="button" title="Duplicate (hidden, no ISBN)" onClick={() => act(() => adminDuplicatePack(p.id), "Copy created — hidden until you give it an ISBN.")} className="p-1.5 text-[#4B5563] hover:text-[#002B5C]"><Copy size={15} /></button>
                            {mayDelete && (
                                <button type="button" title="Delete"
                                    onClick={() => window.confirm(`Delete the pack “${p.title}”? The books inside are not affected. This cannot be undone.`) && act(() => adminDeletePack(p.id), "Pack deleted.")}
                                    className="p-1.5 text-[#4B5563] hover:text-[#CC0033]"><Trash2 size={15} /></button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {editing && (
                <PackEditor
                    initial={editing.id ? editing : null}
                    categories={categories}
                    catalogue={catalogue}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); }}
                />
            )}
        </div>
    );
}
