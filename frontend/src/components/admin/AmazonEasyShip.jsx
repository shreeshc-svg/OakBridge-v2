import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { esStatus, esPreview, esOrders, esRefreshListings, esRun, esSaveSettings, esSkuPush, formatApiError } from "../../lib/api";

/**
 * Amazon Easy Ship (backend/amazon_easyship.py): our own shelf, sold on
 * Amazon.in too — we pack, Amazon delivers. Shown inside the Amazon panel on
 * Admin → Warehouse → Inventory.
 *
 * Order of trust, on purpose: "Refresh listings" only READS Amazon; the
 * preview shows exactly what would be set; only then can a super admin switch
 * the sync on. Switching on is the moment from which Amazon orders take
 * copies off website stock (older orders were already in the stock sheet).
 */
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const STAGE = { new: "Waiting", taking: "Taking…", taken: "Stock taken", restoring: "Putting back…", restored: "Cancelled — stock back",
    skipped: "Cancelled before sync", before_start: "Before sync started (no change)" };

export default function AmazonEasyShip({ onChanged }) {
    const [st, setSt] = useState(null);
    const [busy, setBusy] = useState("");
    const [plan, setPlan] = useState(null);
    const [orders, setOrders] = useState(null);
    const load = useCallback(() => esStatus().then(setSt).catch(() => setSt(null)), []);
    useEffect(() => { load(); }, [load]);
    if (!st) return null;

    const act = async (name, fn, okMsg) => {
        setBusy(name);
        try { const r = await fn(); if (okMsg) toast.success(okMsg(r)); await load(); onChanged?.(); return r; }
        catch (e) { toast.error(formatApiError(e)); return null; }
        finally { setBusy(""); }
    };
    const showPlan = async () => { if (plan) { setPlan(null); return; } setPlan(await esPreview().catch((e) => { toast.error(formatApiError(e)); return null; })); };
    const showOrders = async () => { if (orders) { setOrders(null); return; } setOrders(await esOrders().catch(() => [])); };
    const toggle = async () => {
        const on = !st.on;
        const msg = on
            ? "Switch Easy Ship sync ON?\n\nEvery 15 minutes the site will SET your Amazon quantities (website stock minus the buffer) and take Amazon orders off website stock. Orders placed before now are not touched."
            : "Switch Easy Ship sync OFF? Amazon quantities stay as they are now and Amazon orders stop being taken off website stock.";
        if (!window.confirm(msg)) return;
        await act("toggle", () => esSaveSettings({ on }), () => (on ? "Easy Ship sync is ON." : "Easy Ship sync is off."));
    };
    const ll = st.last_listings, lp = st.last_pull, lpu = st.last_push;
    const toPush = plan ? plan.rows.filter((r) => r.push).length : 0;

    return (
        <div className="mt-4 border-t border-[#E5E7EB] pt-3" data-testid="wh-amazon-easyship">
            <div className="flex flex-wrap items-center gap-3">
                <b className="text-[#002B5C]">Easy Ship</b>
                <span className={`text-[11px] px-2 py-0.5 border ${st.on ? "border-[#047857] text-[#047857]" : "border-[#9CA3AF] text-[#6B7280]"}`}>{st.on ? "Sync ON" : "Sync off"}</span>
                <span className="text-xs text-[#4B5563]">Your shelf on Amazon — you pack, Amazon delivers.</span>
                {st.ready && (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-[#4B5563]" title="Copies held back for oakbridge.in so both shops can't sell the last copy">Buffer
                            <input type="number" min={0} max={50} defaultValue={st.buffer} className="w-14 border border-[#E5E7EB] px-1 py-0.5"
                                onBlur={(e) => Number(e.target.value) !== st.buffer && act("buffer", () => esSaveSettings({ buffer: Number(e.target.value) || 0 }), () => "Buffer saved.")} />
                        </label>
                        <button type="button" disabled={!!busy} onClick={() => act("listings", esRefreshListings, (r) => `Listings read: ${r.easy_ship} Easy Ship SKUs, ${r.linked} linked to books.`)}
                            className="h-8 border border-[#002B5C] text-[#002B5C] px-3 text-xs disabled:opacity-50">{busy === "listings" ? "Reading… (1–3 min)" : "Refresh listings"}</button>
                        <button type="button" onClick={showPlan} className="h-8 border border-[#002B5C] text-[#002B5C] px-3 text-xs">{plan ? "Hide preview" : "Preview quantities"}</button>
                        {st.on && (
                            <button type="button" disabled={!!busy} onClick={() => act("run", esRun, (r) => `Done: ${r.orders?.taken ?? 0} order(s) taken, ${r.push?.pushed ?? 0} quantity update(s) sent.`)}
                                className="h-8 border border-[#002B5C] text-[#002B5C] px-3 text-xs disabled:opacity-50">{busy === "run" ? "Running…" : "Run now"}</button>
                        )}
                        <button type="button" disabled={!!busy || (!st.on && !ll)} onClick={toggle}
                            title={!st.on && !ll ? "Refresh listings and check the preview first" : ""}
                            className={`h-8 px-3 text-xs text-white disabled:opacity-50 ${st.on ? "bg-[#6B7280]" : "bg-[#002B5C]"}`}>{st.on ? "Switch off" : "Switch on"}</button>
                    </div>
                )}
            </div>
            {!st.ready ? (
                <p className="text-xs text-[#6B7280] mt-1">
                    {st.seller_id ? "Amazon keys missing." : "Add SPAPI_SELLER_ID (your merchant token) in Render, with the Product Listing role on the app, to use Easy Ship sync."}
                </p>
            ) : (
                <div className="text-[11px] text-[#4B5563] mt-1 space-y-0.5">
                    <div>Listings: {ll ? `${when(ll.at)} · ${ll.easy_ship} Easy Ship SKUs · ${ll.linked} linked` : "not read yet"}
                        {st.on && <> · Orders: {lp ? `${when(lp.at)} · ${lp.taken} taken, ${lp.restored} cancelled` : "—"} · Quantities: {lpu ? `${when(lpu.at)} · ${lpu.pushed} sent${lpu.failed?.length ? `, ${lpu.failed.length} failed` : ""}` : "—"}</>}
                        {st.orders_from && <> · Orders counted from {when(st.orders_from)}</>}
                        {" · "}<button type="button" className="underline" onClick={showOrders}>{orders ? "Hide Amazon orders" : "Amazon orders"}</button>
                        {st.attention ? <span className="text-[#CC0033]"> · {st.attention} need attention</span> : null}
                    </div>
                    {st.last_error && <div className="text-[#CC0033]">Last error ({when(st.last_error_at)}): {st.last_error}</div>}
                    {lpu?.failed?.length ? <div className="text-[#CC0033]">Not accepted by Amazon: {lpu.failed.join(" · ")}</div> : null}
                </div>
            )}

            {plan && (
                <div className="mt-3 overflow-x-auto">
                    <p className="text-xs text-[#4B5563] mb-1">{toPush} of {plan.rows.length} Easy Ship SKU(s) would change on Amazon (buffer {plan.buffer}). FBA listings are never changed.</p>
                    <table className="w-full text-xs">
                        <thead className="text-left text-[#6B7280]"><tr>
                            <th className="py-1 pr-2">SKU</th><th className="py-1 pr-2">Book</th><th className="py-1 pr-2 text-right">Our stock</th>
                            <th className="py-1 pr-2 text-right">Amazon now</th><th className="py-1 pr-2 text-right">Will set</th><th className="py-1 pr-2">Why</th><th className="py-1">Sync</th>
                        </tr></thead>
                        <tbody>
                            {plan.rows.map((r) => (
                                <tr key={r.sku} className={`border-t border-[#F3F4F6] ${r.push ? "bg-[#FFFBEB]" : ""}`}>
                                    <td className="py-1 pr-2 font-mono">{r.sku}</td>
                                    <td className="py-1 pr-2 max-w-[16rem] truncate" title={r.book_title || r.title}>{r.book_title || <span className="text-[#B45309]">not linked</span>}</td>
                                    <td className="py-1 pr-2 text-right font-mono">{r.stock ?? "—"}</td>
                                    <td className="py-1 pr-2 text-right font-mono">{r.amazon_qty ?? "--"}</td>
                                    <td className="py-1 pr-2 text-right font-mono font-semibold">{r.target ?? "—"}</td>
                                    <td className="py-1 pr-2 text-[#6B7280]">{r.why}</td>
                                    <td className="py-1">
                                        {r.book_id && (
                                            <input type="checkbox" defaultChecked={r.why !== "sync switched off for this SKU"} aria-label={`Sync ${r.sku}`}
                                                onChange={(e) => esSkuPush(r.sku, e.target.checked).then(() => esPreview().then(setPlan)).catch((er) => toast.error(formatApiError(er)))} />
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {!plan.rows.length && <tr><td colSpan={7} className="py-2 text-[#6B7280]">No Easy Ship listings yet — press Refresh listings.</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}

            {orders && (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-left text-[#6B7280]"><tr>
                            <th className="py-1 pr-2">Amazon order</th><th className="py-1 pr-2">Placed</th><th className="py-1 pr-2">Ship by</th>
                            <th className="py-1 pr-2">Amazon status</th><th className="py-1 pr-2">Books</th><th className="py-1">Our stock</th>
                        </tr></thead>
                        <tbody>
                            {orders.map((o) => (
                                <tr key={o.amazon_order_id} className={`border-t border-[#F3F4F6] ${o.needs_attention ? "bg-[#FEF2F2]" : ""}`}>
                                    <td className="py-1 pr-2 font-mono">{o.amazon_order_id}</td>
                                    <td className="py-1 pr-2">{when(o.purchase_date)}</td>
                                    <td className="py-1 pr-2">{when(o.latest_ship_date)}</td>
                                    <td className="py-1 pr-2">{o.status}{o.easyship_status ? ` · ${o.easyship_status}` : ""}</td>
                                    <td className="py-1 pr-2">{(o.lines || []).map((l) => `${l.title || l.sku} × ${l.qty}${l.book_id ? "" : " (not linked)"}`).join("; ")}</td>
                                    <td className="py-1">{STAGE[o.stage] || o.stage}{o.short?.length ? <span className="text-[#CC0033]"> — short: {o.short.join("; ")}</span> : null}</td>
                                </tr>
                            ))}
                            {!orders.length && <tr><td colSpan={6} className="py-2 text-[#6B7280]">No Amazon orders synced yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
