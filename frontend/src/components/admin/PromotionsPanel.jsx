import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, PartyPopper } from "lucide-react";
import { adminPromotions, adminSavePromotion, adminDeletePromotion, formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { canDelete } from "../../lib/rbac";

/**
 * Admin → Coupons & Promotions → Festive promotions (Oct 2026).
 *
 * A store-wide offer for an occasion — "Diwali Sale: 10% off every book, up
 * to ₹500, on orders over ₹999" — that starts and stops on its own (India
 * time). Taken off at the cart (book prices don't change); a customer with a
 * coupon gets whichever saves more, never both; gift hampers and pre-orders
 * don't earn it. Rules: backend/promotions_core.py.
 */
const BLANK = { label: "", message: "", kind: "percent", value: 10, max_discount: 0, min_order: 0, starts_at: "", ends_at: "", active: true, banner: true };
const STATUS = {
    live: ["Live now", "bg-[#DCFCE7] text-[#15803D]"],
    scheduled: ["Scheduled", "bg-[#E0F2FE] text-[#075985]"],
    ended: ["Ended", "bg-[#F3F4F6] text-[#6B7280]"],
    off: ["Off", "bg-[#F3F4F6] text-[#6B7280]"],
};
const IDEAS = ["Diwali Sale", "Republic Day Offer", "Independence Day Sale", "New Year Reads", "Holi Offer", "Book Lovers' Day", "Back to College"];
const show = (s) => (s ? s.replace("T", " ") : "—");

function preview(f) {
    const v = Number(f.value) || 0;
    let s = f.kind === "percent" ? `${v}% off every book` : `₹${v.toLocaleString("en-IN")} off your order`;
    if (f.kind === "percent" && Number(f.max_discount) > 0) s += `, up to ₹${Number(f.max_discount).toLocaleString("en-IN")}`;
    if (Number(f.min_order) > 0) s += ` on orders over ₹${Number(f.min_order).toLocaleString("en-IN")}`;
    return s;
}

function PromoForm({ initial, onClose, onSaved }) {
    const [f, setF] = useState({ ...BLANK, ...(initial || {}) });
    const [busy, setBusy] = useState(false);
    const set = (patch) => setF((x) => ({ ...x, ...patch }));
    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await adminSavePromotion({ ...f, value: Number(f.value), max_discount: Number(f.max_discount) || 0, min_order: Number(f.min_order) || 0 }, initial?.id);
            toast.success("Promotion saved.");
            onSaved();
            onClose();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(false);
        }
    };
    const inp = "w-full border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]";
    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" data-testid="promo-form">
            <form onSubmit={save} className="bg-white w-full max-w-2xl p-6 mt-10 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="font-serif text-2xl text-[#002B5C]">{initial?.id ? "Edit promotion" : "New festive promotion"}</h2>
                    <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
                </div>
                <label className="block text-sm">Occasion (shown to customers)
                    <input className={inp} value={f.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Diwali Sale" maxLength={40} required />
                </label>
                <div className="flex flex-wrap gap-1">
                    {IDEAS.map((x) => <button key={x} type="button" onClick={() => set({ label: x })} className="text-xs border border-[#E5E7EB] px-2 py-0.5 hover:border-[#F59E0B]">{x}</button>)}
                </div>
                <label className="block text-sm">Festive line (optional, on the banner)
                    <input className={inp} value={f.message} onChange={(e) => set({ message: e.target.value })} placeholder="e.g. Light up the season with a good book" maxLength={140} />
                </label>
                <div className="grid sm:grid-cols-3 gap-3">
                    <label className="block text-sm">Discount type
                        <select className={inp} value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
                            <option value="percent">% off</option>
                            <option value="flat">Flat ₹ off</option>
                        </select>
                    </label>
                    <label className="block text-sm">{f.kind === "percent" ? "Percent off" : "Rupees off"}
                        <input type="number" min="1" step="1" className={inp} value={f.value} onChange={(e) => set({ value: e.target.value })} required />
                    </label>
                    {f.kind === "percent" && (
                        <label className="block text-sm">Max discount ₹ (0 = no cap)
                            <input type="number" min="0" step="1" className={inp} value={f.max_discount} onChange={(e) => set({ max_discount: e.target.value })} />
                        </label>
                    )}
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                    <label className="block text-sm">Minimum order ₹ (0 = none)
                        <input type="number" min="0" step="1" className={inp} value={f.min_order} onChange={(e) => set({ min_order: e.target.value })} />
                    </label>
                    <label className="block text-sm">Starts (India time)
                        <input type="datetime-local" className={inp} value={(f.starts_at || "").slice(0, 16)} onChange={(e) => set({ starts_at: e.target.value })} required />
                    </label>
                    <label className="block text-sm">Ends (India time)
                        <input type="datetime-local" className={inp} value={(f.ends_at || "").slice(0, 16)} onChange={(e) => set({ ends_at: e.target.value })} required />
                    </label>
                </div>
                <div className="flex flex-wrap gap-5 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> Switched on</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={f.banner} onChange={(e) => set({ banner: e.target.checked })} /> Show the banner strip on every page</label>
                </div>
                <div className="border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm space-y-2">
                    <div className="text-xs text-[#6B7280]">What customers will see</div>
                    <div className="bg-[#002B5C] text-white text-[13px] text-center px-3 py-2">
                        <span className="font-semibold text-[#F59E0B]">{f.label || "Occasion"}</span> · {f.message ? `${f.message} — ` : ""}{preview(f)}
                    </div>
                    <div className="inline-flex gap-2 border border-[#F59E0B] bg-[#FFF8EB] px-3 py-1.5 text-[#002B5C]">
                        <b className="text-[#B45309]">{f.label || "Occasion"}</b> {preview(f)} — taken off at checkout
                    </div>
                    <p className="text-xs text-[#6B7280]">Book prices don't change. A customer with a coupon gets whichever saves more — never both. Gift hampers and pre-orders don't get the festive discount.</p>
                </div>
                <div className="flex gap-2 justify-end">
                    <button type="button" onClick={onClose} className="border px-4 py-2 text-sm">Cancel</button>
                    <button type="submit" disabled={busy} className="bg-[#002B5C] text-white px-4 py-2 text-sm">{busy ? "Saving…" : "Save promotion"}</button>
                </div>
            </form>
        </div>
    );
}

export default function PromotionsPanel() {
    const { user } = useAuth();
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => adminPromotions().then(setRows).catch((e) => { toast.error(formatApiError(e)); setRows([]); }), []);
    useEffect(() => { load(); }, [load]);
    const toggle = async (p) => {
        if (!window.confirm(`${p.active ? "Switch off" : "Switch on"} “${p.label}”?`)) return;
        try { await adminSavePromotion({ ...p, active: !p.active }, p.id); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const remove = async (p) => {
        if (!window.confirm(`Delete “${p.label}”? Past orders keep their discount.`)) return;
        try { await adminDeletePromotion(p.id); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <section className="border border-[#F59E0B]/50 bg-[#FFFCF5] p-5 mt-6" data-testid="promotions-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-[#002B5C]"><PartyPopper size={18} /><h2 className="font-serif text-2xl">Festive promotions</h2></div>
                    <p className="text-sm text-[#4B5563] mt-1 max-w-2xl">A store-wide % or flat ₹ off for an occasion, with its name shown to customers on a banner, the book pages, the cart and the invoice. Starts and stops on its own.</p>
                </div>
                <button type="button" onClick={() => setEditing("new")} className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-4 py-2 text-sm" data-testid="promo-new">
                    <Plus size={14} /> New promotion
                </button>
            </div>
            {rows === null ? <p className="text-sm text-[#6B7280] mt-3">Loading…</p> : !rows.length ? (
                <p className="text-sm text-[#6B7280] mt-3">No promotions yet.</p>
            ) : (
                <div className="overflow-x-auto mt-4">
                    <table className="w-full text-sm">
                        <thead><tr className="text-left text-[#4B5563]"><th className="py-2 pr-4">Occasion</th><th className="pr-4">Offer</th><th className="pr-4 whitespace-nowrap">When (India time)</th><th className="pr-4">Status</th><th className="px-3 text-right">Paid orders</th><th /></tr></thead>
                        <tbody>
                            {rows.map((p) => {
                                const st = STATUS[p.status] || STATUS.off;
                                return (
                                    <tr key={p.id} className="border-t border-[#E5E7EB] align-top">
                                        <td className="py-2 pr-4"><b className="text-[#002B5C]">{p.label}</b>{p.message && <div className="text-xs text-[#6B7280]">{p.message}</div>}</td>
                                        <td className="pr-4">{p.offer}</td>
                                        <td className="pr-4 text-xs whitespace-nowrap">{show(p.starts_at)}<br />→ {show(p.ends_at)}</td>
                                        <td className="pr-4"><span className={`px-2 py-0.5 text-xs ${st[1]}`}>{st[0]}</span></td>
                                        <td className="px-3 text-right tabular-nums">{p.paid_orders}</td>
                                        <td className="text-right whitespace-nowrap">
                                            <button type="button" className="text-xs underline mr-3" onClick={() => toggle(p)}>{p.active ? "Switch off" : "Switch on"}</button>
                                            <button type="button" aria-label="Edit" className="mr-2" onClick={() => setEditing(p)}><Pencil size={14} /></button>
                                            {canDelete(user) && <button type="button" aria-label="Delete" onClick={() => remove(p)} className="text-[#CC0033]"><Trash2 size={14} /></button>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {editing && <PromoForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
            <p className="text-[11px] text-[#6B7280] mt-3">Each order and invoice shows the festive discount on a line named after the occasion; "Paid orders" counts the paid orders that got it.</p>
        </section>
    );
}
