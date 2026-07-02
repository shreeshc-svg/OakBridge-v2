import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Tag } from "lucide-react";
import {
    adminCreateCoupon,
    adminDeleteCoupon,
    adminListCoupons,
    adminUpdateCoupon,
    formatApiError,
    formatINR,
} from "../../lib/api";
import { toast } from "sonner";

const BLANK = {
    code: "",
    kind: "percent",
    value: 10,
    min_order: 0,
    max_uses: 0,
    active: true,
    description: "",
    expires_at: "",
};

function CouponForm({ initial, onClose, onSaved }) {
    const [form, setForm] = useState({ ...BLANK, ...(initial || {}) });
    const [saving, setSaving] = useState(false);
    const isEdit = !!initial?.id;

    const onChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm((f) => ({
            ...f,
            [name]: type === "checkbox" ? checked : value,
        }));
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                ...form,
                code: form.code.toUpperCase(),
                value: Number(form.value),
                min_order: Number(form.min_order),
                max_uses: Number(form.max_uses),
                expires_at: form.expires_at || null,
            };
            if (isEdit) {
                // Do not allow code change on update
                const { code, ...rest } = payload;
                void code;
                await adminUpdateCoupon(initial.id, rest);
                toast.success("Coupon updated.");
            } else {
                await adminCreateCoupon(payload);
                toast.success("Coupon created.");
            }
            onSaved();
            onClose();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <form
                onSubmit={onSubmit}
                data-testid="coupon-form"
                className="bg-white border border-[#002B5C] w-full max-w-lg p-8"
            >
                <div className="flex items-start justify-between">
                    <div>
                        <div className="overline">
                            {isEdit ? "Edit Coupon" : "New Coupon"}
                        </div>
                        <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">
                            {isEdit ? form.code : "Create coupon"}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        data-testid="coupon-form-close"
                        className="p-2 hover:bg-[#F5F7FA]"
                    >
                        <X size={18} strokeWidth={1.5} />
                    </button>
                </div>
                <div className="mt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="overline !text-[10px] block mb-2">Code</label>
                            <input
                                type="text"
                                name="code"
                                required
                                disabled={isEdit}
                                value={form.code}
                                onChange={onChange}
                                data-testid="coupon-code"
                                className="w-full uppercase border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C] disabled:bg-[#F5F7FA]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">Type</label>
                            <select
                                name="kind"
                                value={form.kind}
                                onChange={onChange}
                                data-testid="coupon-kind"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            >
                                <option value="percent">Percent off</option>
                                <option value="flat">Flat amount off</option>
                            </select>
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                {form.kind === "percent" ? "Percent (%)" : "Amount (₹)"}
                            </label>
                            <input
                                type="number"
                                name="value"
                                required
                                min={0}
                                value={form.value}
                                onChange={onChange}
                                data-testid="coupon-value"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">Min Order (₹)</label>
                            <input
                                type="number"
                                name="min_order"
                                min={0}
                                value={form.min_order}
                                onChange={onChange}
                                data-testid="coupon-min-order"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">Max Uses (0 = ∞)</label>
                            <input
                                type="number"
                                name="max_uses"
                                min={0}
                                value={form.max_uses}
                                onChange={onChange}
                                data-testid="coupon-max-uses"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">Expires (optional)</label>
                            <input
                                type="date"
                                name="expires_at"
                                value={(form.expires_at || "").slice(0, 10)}
                                onChange={onChange}
                                data-testid="coupon-expires"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="overline !text-[10px] block mb-2">Description</label>
                        <input
                            type="text"
                            name="description"
                            value={form.description}
                            onChange={onChange}
                            data-testid="coupon-description"
                            className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                        />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            name="active"
                            checked={!!form.active}
                            onChange={onChange}
                            data-testid="coupon-active"
                        />
                        Active
                    </label>
                </div>
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-3 text-sm border border-[#E5E7EB]"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        data-testid="coupon-save"
                        className="px-8 py-3 text-sm bg-[#002B5C] text-[#FFFFFF] hover:bg-[#001F42] disabled:opacity-60"
                    >
                        {saving ? "Saving…" : isEdit ? "Save" : "Create"}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default function AdminCoupons() {
    const [items, setItems] = useState([]);
    const [editing, setEditing] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = () => {
        setLoading(true);
        adminListCoupons()
            .then(setItems)
            .finally(() => setLoading(false));
    };
    useEffect(() => {
        load();
    }, []);

    const onDelete = async (id, code) => {
        if (!window.confirm(`Delete coupon "${code}"?`)) return;
        try {
            await adminDeleteCoupon(id);
            toast.success("Coupon deleted.");
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    return (
        <div data-testid="admin-coupons-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Promotions</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                        Coupons ({items.length})
                    </h1>
                </div>
                <button
                    onClick={() => setEditing("new")}
                    data-testid="admin-new-coupon-button"
                    className="inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-4 py-2 text-sm hover:bg-[#001F42]"
                >
                    <Plus size={14} strokeWidth={1.5} /> New Coupon
                </button>
            </div>

            <div className="mt-8 bg-white border border-[#E5E7EB]">
                {loading && (
                    <div className="p-8 text-center text-sm text-[#4B5563]">Loading…</div>
                )}
                {!loading && items.length === 0 && (
                    <div className="p-16 text-center">
                        <Tag size={32} strokeWidth={1} className="mx-auto text-[#4B5563]" />
                        <h3 className="font-serif text-2xl mt-4 text-[#002B5C]">
                            No coupons yet.
                        </h3>
                    </div>
                )}
                {items.map((c) => (
                    <div
                        key={c.id}
                        data-testid={`admin-coupon-${c.code}`}
                        className="flex flex-wrap items-center gap-4 p-5 border-b border-[#E5E7EB] last:border-b-0"
                    >
                        <div className="flex-1 min-w-[200px]">
                            <div className="flex items-center gap-3">
                                <span className="font-mono text-lg text-[#002B5C] bg-[#F59E0B]/20 px-3 py-1">
                                    {c.code}
                                </span>
                                <span
                                    className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 ${c.active ? "bg-[#002B5C] text-white" : "bg-[#E5E7EB] text-[#4B5563]"}`}
                                >
                                    {c.active ? "active" : "inactive"}
                                </span>
                            </div>
                            <div className="mt-2 text-sm text-[#4B5563]">
                                {c.kind === "percent" ? `${c.value}% off` : `${formatINR(c.value)} off`}
                                {c.min_order > 0 && ` · min ${formatINR(c.min_order)}`}
                                {c.max_uses > 0 && ` · ${c.used_count}/${c.max_uses} used`}
                            </div>
                            {c.description && (
                                <div className="text-xs text-[#4B5563] mt-1 italic">
                                    {c.description}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setEditing(c)}
                                data-testid={`edit-coupon-${c.code}`}
                                className="inline-flex items-center gap-1 text-xs px-3 py-2 border border-[#E5E7EB] hover:bg-[#F5F7FA]"
                            >
                                <Pencil size={12} strokeWidth={1.5} /> Edit
                            </button>
                            <button
                                onClick={() => onDelete(c.id, c.code)}
                                data-testid={`delete-coupon-${c.code}`}
                                className="inline-flex items-center gap-1 text-xs px-3 py-2 border border-[#E5E7EB] hover:bg-[#F5F7FA] text-[#CC0033]"
                            >
                                <Trash2 size={12} strokeWidth={1.5} /> Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {editing && (
                <CouponForm
                    initial={editing === "new" ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={load}
                />
            )}
        </div>
    );
}
