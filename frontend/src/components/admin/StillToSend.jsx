import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminOwed, adminOwedSent, adminOwedCancel, adminOwedRefundDone, formatApiError, formatINR } from "../../lib/api";

/**
 * Admin → Warehouse → Still to send. Parcels that went short ("label 9, only
 * 7 sent") leave an owed line here (backend/warehouse_shortship.py):
 *   Send the rest — the follow-up parcel went.
 *   Cancel        — won't be sent. A website order's copies go back into
 *                   stock and a refund reminder appears: refund it in
 *                   Razorpay, then tick "Refund done". The site moves no money.
 */
const VIEWS = [["open", "Still to send"], ["refund", "Refunds to do"], ["all", "History"]];
const STATUS = { open: ["Waiting", "#B4750F"], sent: ["Rest sent", "#15803D"], cancelled: ["Cancelled", "#6B7280"] };

export default function StillToSend() {
    const [view, setView] = useState("open");
    const [d, setD] = useState(null);
    const load = useCallback(() => adminOwed(view).then(setD).catch((e) => { toast.error(formatApiError(e)); setD({ rows: [] }); }), [view]);
    useEffect(() => { setD(null); load(); }, [load]);
    const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(formatApiError(e)); } };
    const cancel = (o) => {
        const money = o.kind === "website_order";
        if (!window.confirm(`Cancel the remaining ${o.owed} × “${o.title}”${o.order_number ? ` on ${o.order_number}` : ""}?\n\n` +
            (money ? `They go back into stock, the customer is emailed, and a refund reminder is added — refund it in Razorpay.` : "Nothing moves in stock — these copies never left."))) return;
        act(() => adminOwedCancel(o.id, money ? "Not sent — refund" : "Not sent"), money ? "Cancelled — copies back in stock; refund reminder added." : "Cancelled.");
    };
    const refunded = (o) => {
        const ref = window.prompt(`Refunded ${formatINR(o.refund_due)} for ${o.order_number} in Razorpay?\n\nRefund ID / note (optional):`, "");
        if (ref === null) return;
        act(() => adminOwedRefundDone(o.id, ref), "Refund marked done.");
    };
    return (
        <div className="mt-6" data-testid="wh-owed-admin">
            <div className="flex flex-wrap gap-2 mb-4">
                {VIEWS.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setView(k)}
                        className={`px-3 py-1.5 text-sm border ${view === k ? "bg-[#002B5C] border-[#002B5C] text-white" : "border-[#E5E7EB] bg-white"}`}>
                        {l}{k === "refund" && d?.refunds_pending ? ` (${d.refunds_pending})` : ""}
                    </button>
                ))}
            </div>
            {!d ? <p className="text-sm text-[#4B5563]">Loading…</p> : !d.rows.length ? (
                <p className="text-sm text-[#4B5563]">{view === "open" ? "Nothing waiting — every parcel went complete." : view === "refund" ? "No refunds to do." : "No short parcels yet."}</p>
            ) : (
                <table className="w-full text-sm bg-white border border-[#E5E7EB]">
                    <thead><tr className="text-left text-xs text-[#4B5563] border-b border-[#E5E7EB]">
                        <th className="p-3">Book</th><th>Parcel</th><th>Sent / label</th><th>Owed</th><th>Status</th><th /></tr></thead>
                    <tbody>{d.rows.map((o) => {
                        const [sl, tone] = STATUS[o.status] || [o.status, "#4B5563"];
                        return (
                            <tr key={o.id} className="border-b border-[#F3F4F6] align-top">
                                <td className="p-3"><div className="font-medium text-[#002B5C]">{o.title}</div><div className="text-xs font-mono text-[#6B7280]">{o.isbn}</div></td>
                                <td className="py-3">{o.kind_label}{o.order_number ? <span className="block font-mono text-xs">{o.order_number}</span> : null}<span className="block text-xs text-[#6B7280]">{o.party} · {new Date(o.created_at).toLocaleDateString("en-IN")}</span></td>
                                <td className="py-3 font-mono">{o.sent} / {o.ordered}</td>
                                <td className="py-3 font-mono font-semibold">{o.owed}</td>
                                <td className="py-3"><span style={{ color: tone }}>{sl}</span>
                                    {o.refund_due ? <span className={`block text-xs ${o.refund_done ? "text-[#15803D]" : "text-[#CC0033] font-medium"}`}>{o.refund_done ? "Refunded" : "Refund due"} {formatINR(o.refund_due)}</span> : null}
                                    {o.note && <span className="block text-xs text-[#6B7280]">{o.note}</span>}</td>
                                <td className="py-3 pr-3 text-right whitespace-nowrap space-x-2">
                                    {o.status === "open" && <>
                                        <button type="button" onClick={() => window.confirm(`The remaining ${o.owed} were sent?`) && act(() => adminOwedSent(o.id, "Office"), "Marked sent.")}
                                            className="text-xs bg-[#15803D] text-white px-2 py-1">Send the rest</button>
                                        <button type="button" onClick={() => cancel(o)} className="text-xs border border-[#CC0033] text-[#CC0033] px-2 py-1">Cancel</button>
                                    </>}
                                    {o.refund_due > 0 && !o.refund_done && <button type="button" onClick={() => refunded(o)} className="text-xs border border-[#002B5C] text-[#002B5C] px-2 py-1">Refund done</button>}
                                </td>
                            </tr>
                        );
                    })}</tbody>
                </table>
            )}
        </div>
    );
}
