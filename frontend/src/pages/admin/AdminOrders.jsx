import React, { useEffect, useMemo, useState } from "react";
import { MailCheck, FileDown, Send } from "lucide-react";
import PaymentBadge from "../../components/admin/PaymentBadge";
import {
    adminListOrders,
    adminResendReceipt,
    adminSendPaymentLink,
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
    const [linking, setLinking] = useState(null);
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


    // Only offered on unpaid orders. An order row exists before the customer
    // reaches Razorpay, so "pending" means they never finished paying — and
    // nothing else in the app ever chases that. The link reopens this exact
    // order rather than sending them back to a checkout that reads their cart.
    const onSendPaymentLink = async (id) => {
        setLinking(id);
        try {
            const res = await adminSendPaymentLink(id);
            if (res.ok) {
                toast.success(`Payment link sent to ${res.to}`);
                setOrders((prev) =>
                    prev.map((o) =>
                        o.id === id
                            ? { ...o, payment_link_sent_at: new Date().toISOString() }
                            : o,
                    ),
                );
            } else {
                toast.error("Email could not be sent — check server logs.");
            }
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setLinking(null);
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
                // Searchable across contact details, city/pincode and the titles
                // ordered — so dispatch can find an order from a phone call or a
                // customer asking about a specific book.
                `${o.order_number || ""} ${o.full_name || ""} ${o.email || ""} ${o.phone || ""} ${o.city || ""} ${o.pincode || ""} ${(o.items || []).map((i) => `${i.title} ${i.isbn || ""} ${i.author || ""}`).join(" ")}`
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
                placeholder="Search order #, customer, email, phone, pincode or book title…"
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
                            <th className="text-left px-4 py-3">Deliver to</th>
                            <th className="text-left px-4 py-3">Placed</th>
                            <th className="text-left px-4 py-3">Items</th>
                            <th className="text-right px-4 py-3">Total</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={8} className="px-4 py-10 text-center text-[#4B5563]">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && view.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-4 py-10 text-center text-[#4B5563]">
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
                                    {/* Directly under the order number, because
                                        that is what someone reads first when
                                        they are about to act on an order. */}
                                    <div className="mt-1.5">
                                        <PaymentBadge status={o.payment_status} />
                                    </div>
                                    {o.payment_link_sent_at && (
                                        <div className="mt-1 text-[10px] text-[#4B5563]">
                                            link sent{" "}
                                            {new Date(o.payment_link_sent_at).toLocaleDateString("en-IN")}
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3 align-top">
                                    <div className="font-serif text-[#002B5C]">
                                        {o.full_name}
                                    </div>
                                    <div className="text-xs text-[#4B5563] break-all">
                                        <a href={`mailto:${o.email}`} className="hover:text-[#002B5C]">{o.email}</a>
                                    </div>
                                    {o.phone && (
                                        <div className="font-mono text-xs text-[#002B5C] mt-0.5">
                                            <a href={`tel:${o.phone}`} className="hover:text-[#CC0033]">{o.phone}</a>
                                        </div>
                                    )}
                                </td>
                                {/* Dispatch needs the delivery address and phone; before this they
                                    were stored on the order but shown nowhere in the admin. */}
                                <td className="px-4 py-3 align-top text-xs text-[#4B5563] max-w-[220px]">
                                    {o.address_line1 ? (
                                        <>
                                            <div>{o.address_line1}</div>
                                            {o.address_line2 && <div>{o.address_line2}</div>}
                                            <div>
                                                {[o.city, o.state].filter(Boolean).join(", ")}
                                                {o.pincode ? ` — ${o.pincode}` : ""}
                                            </div>
                                        </>
                                    ) : (
                                        <span className="text-[#9CA3AF]">—</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 align-top font-mono text-xs text-[#4B5563] whitespace-nowrap">
                                    {new Date(o.created_at).toLocaleString("en-IN")}
                                </td>
                                {/* Title, author, ISBN and edition — everything needed to pick
                                    the right stock. ISBN/edition are joined from the catalogue
                                    server-side, since order items only snapshot title/author. */}
                                <td className="px-4 py-3 align-top text-xs max-w-[300px]">
                                    {o.items.map((it, i) => (
                                        <div key={i} className="leading-snug mb-2 last:mb-0">
                                            <div className="text-[#002B5C]">
                                                <span className="font-mono text-[#4B5563]">{it.quantity}×</span>{" "}
                                                {it.title}
                                                {it.edition && Number(it.edition) > 1 && (
                                                    <span className="text-[#4B5563]"> ({it.edition}/e)</span>
                                                )}
                                            </div>
                                            {it.author && (
                                                <div className="text-[10px] text-[#4B5563]">{it.author}</div>
                                            )}
                                            {it.isbn && (
                                                <div className="font-mono text-[10px] text-[#4B5563]">
                                                    ISBN {it.isbn}
                                                </div>
                                            )}
                                            {(it.binding || it.size) && (
                                                <div className="text-[10px] text-[#4B5563]">
                                                    {[it.binding, it.size].filter(Boolean).join(" · ")}
                                                </div>
                                            )}
                                        </div>
                                    ))}
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
                                        {o.payment_status !== "paid" && (
                                            <button
                                                onClick={() => onSendPaymentLink(o.id)}
                                                disabled={linking === o.id}
                                                data-testid={`order-paylink-${o.id}`}
                                                title="Email this customer a link to finish paying for this order"
                                                className="inline-flex items-center gap-1.5 border border-[#F59E0B] text-[#854F0B] bg-[#FAEEDA] hover:bg-[#F6E3C4] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                                            >
                                                <Send size={12} strokeWidth={1.5} />
                                                {linking === o.id ? "Sending…" : "Payment link"}
                                            </button>
                                        )}
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
