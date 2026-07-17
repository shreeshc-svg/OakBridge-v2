import React, { useEffect, useMemo, useState } from "react";
import { MailCheck, FileDown } from "lucide-react";
import {
    adminListOrders,
    adminResendReceipt,
    adminDownloadInvoice,
    adminUpdateOrder,
    formatApiError,
    formatINR,
} from "../../lib/api";
import { toast } from "sonner";
import AdminToolbar from "../../components/AdminToolbar";

const STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];

export default function AdminOrders() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [resending, setResending] = useState(null);
    const [downloading, setDownloading] = useState(null);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState("all");
    const [sort, setSort] = useState("newest");

    const load = () => {
        setLoading(true);
        adminListOrders()
            .then(setOrders)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const onStatusChange = async (id, status) => {
        try {
            await adminUpdateOrder(id, status);
            toast.success("Order status updated.");
            setOrders((prev) =>
                prev.map((o) => (o.id === id ? { ...o, status } : o)),
            );
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const onResend = async (id) => {
        setResending(id);
        try {
            const res = await adminResendReceipt(id);
            if (res.ok) {
                toast.success(`Receipt re-sent to ${res.to}`);
            } else {
                toast.error("Email could not be sent — check server logs.");
            }
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setResending(null);
        }
    };

    const onDownload = async (id, orderNumber) => {
        setDownloading(id);
        try {
            await adminDownloadInvoice(id, orderNumber);
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setDownloading(null);
        }
    };

    const view = useMemo(() => {
        const needle = q.trim().toLowerCase();
        let a = orders.filter(
            (o) =>
                !needle ||
                `${o.order_number || ""} ${o.full_name || ""} ${o.email || ""}`
                    .toLowerCase()
                    .includes(needle),
        );
        if (status !== "all") a = a.filter((o) => o.status === status);
        const t = (o) => new Date(o.created_at || 0).getTime();
        a = [...a].sort((x, y) => {
            if (sort === "oldest") return t(x) - t(y);
            if (sort === "total_desc") return (y.total || 0) - (x.total || 0);
            if (sort === "total_asc") return (x.total || 0) - (y.total || 0);
            return t(y) - t(x);
        });
        return a;
    }, [orders, q, status, sort]);

    return (
        <div data-testid="admin-orders-page">
            <div className="overline">Fulfilment</div>
            <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                Orders ({orders.length})
            </h1>
            <AdminToolbar
                query={q}
                onQuery={setQ}
                placeholder="Search order #, customer or email…"
                filter={status}
                onFilter={setStatus}
                filterOptions={[
                    { value: "all", label: "All statuses" },
                    ...STATUSES.map((s) => ({ value: s, label: s })),
                ]}
                sort={sort}
                onSort={setSort}
                sortOptions={[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                    { value: "total_desc", label: "Total: high → low" },
                    { value: "total_asc", label: "Total: low → high" },
                ]}
                count={view.length}
                total={orders.length}
            />

            <div className="mt-6 bg-white border border-[#E5E7EB] overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-[#F5F7FA] text-[10px] font-mono uppercase tracking-widest text-[#4B5563]">
                        <tr>
                            <th className="text-left px-4 py-3">Order #</th>
                            <th className="text-left px-4 py-3">Customer</th>
                            <th className="text-left px-4 py-3">Placed</th>
                            <th className="text-right px-4 py-3">Items</th>
                            <th className="text-right px-4 py-3">Total</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={7} className="px-4 py-10 text-center text-[#4B5563]">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && view.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-10 text-center text-[#4B5563]">
                                    {orders.length === 0 ? "No orders yet." : "No orders match your search."}
                                </td>
                            </tr>
                        )}
                        {view.map((o) => (
                            <tr
                                key={o.id}
                                data-testid={`admin-order-row-${o.id}`}
                                className="border-t border-[#E5E7EB]"
                            >
                                <td className="px-4 py-3 font-mono text-xs text-[#002B5C]">
                                    {o.order_number}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="font-serif text-[#002B5C]">
                                        {o.full_name}
                                    </div>
                                    <div className="text-xs text-[#4B5563]">
                                        {o.email}
                                    </div>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-[#4B5563]">
                                    {new Date(o.created_at).toLocaleString("en-IN")}
                                </td>
                                <td className="px-4 py-3 text-right text-[#4B5563]">
                                    {o.items.length}
                                </td>
                                <td className="px-4 py-3 text-right font-serif text-xl text-[#002B5C]">
                                    {formatINR(o.total)}
                                </td>
                                <td className="px-4 py-3">
                                    <select
                                        value={o.status}
                                        onChange={(e) =>
                                            onStatusChange(o.id, e.target.value)
                                        }
                                        data-testid={`order-status-${o.id}`}
                                        className="border border-[#E5E7EB] bg-white px-2 py-1 text-xs outline-none focus:border-[#002B5C]"
                                    >
                                        {STATUSES.map((s) => (
                                            <option key={s} value={s}>
                                                {s}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => onResend(o.id)}
                                            disabled={resending === o.id}
                                            data-testid={`order-resend-${o.id}`}
                                            title="Re-send the order receipt (with invoice) to the customer"
                                            className="inline-flex items-center gap-1.5 border border-[#E5E7EB] hover:border-[#002B5C] text-[#002B5C] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                                        >
                                            <MailCheck size={12} strokeWidth={1.5} />
                                            {resending === o.id ? "Sending…" : "Resend"}
                                        </button>
                                        <button
                                            onClick={() => onDownload(o.id, o.order_number)}
                                            disabled={downloading === o.id}
                                            data-testid={`order-invoice-${o.id}`}
                                            title="Download the tax invoice PDF"
                                            className="inline-flex items-center gap-1.5 border border-[#E5E7EB] hover:border-[#002B5C] text-[#002B5C] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                                        >
                                            <FileDown size={12} strokeWidth={1.5} />
                                            {downloading === o.id ? "…" : "Invoice"}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
