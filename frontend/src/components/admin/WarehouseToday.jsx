import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminWhCountToday, adminWhReprint, formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin } from "../../lib/rbac";
import BindingBadge from "../BindingBadge";
import { AdjustPanel, StockStatus } from "./WarehouseInventory";

/*
 * Admin → Warehouse → Today (Nov 2026): two short lists so the stock stays
 * right without a big stock-take (backend/warehouse_cycle.py has the rules).
 *   Count today   ~10 books, each with WHY it's on the list; "Count" opens
 *                 the same Adjust form as the Stock page.
 *   Reprint soon  books that run out within N days at the last 60 days' pace.
 */
const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "never");

export function CountToday() {
    const { user } = useAuth();
    const [d, setD] = useState(null);
    const [open, setOpen] = useState(null);
    const load = useCallback(() => adminWhCountToday(10).then(setD).catch((e) => { toast.error(formatApiError(e)); setD({ rows: [] }); }), []);
    useEffect(() => { load(); }, [load]);
    if (!d) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    return (
        <div className="space-y-3" data-testid="wh-count-today">
            <p className="text-sm text-[#4B5563] max-w-3xl">
                Count these on the shelf today. Never-counted and below-zero books first, then books where the website and shelf disagree,
                then the busiest titles not counted in the last 30 days. A count also puts the website right.
            </p>
            {!d.rows.length && <p className="bg-white border border-[#E5E7EB] p-5 text-sm text-[#15803D]">Nothing to count today — every busy title was counted recently. ✓</p>}
            <div className="bg-white border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
                {d.rows.map((b, i) => (
                    <div key={b.id} className="p-3">
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="font-mono text-xs text-[#6B7280] w-5">{i + 1}</span>
                            <div className="flex-1 min-w-[220px]">
                                <div className="text-[#002B5C]"><BindingBadge binding={b.binding} />{b.plain_title || b.title}</div>
                                <div className="text-xs text-[#6B7280]">{b.why} · last counted {when(b.last_counted)} · ISBN {b.isbn}</div>
                            </div>
                            <span className="font-mono text-sm w-14 text-right" title="On shelf">{b.wh_stock ?? "—"}</span>
                            <StockStatus b={b} threshold={d.threshold} />
                            <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} className="text-xs border border-[#002B5C] px-3 py-1" data-testid="wh-count-today-open">
                                {open === b.id ? "Close" : "Count"}
                            </button>
                        </div>
                        {open === b.id && (
                            <div className="mt-3 bg-[#F9FAFB] p-3">
                                <AdjustPanel b={b} live={d.mode === "live"} canFix={isSuperadmin(user?.role)} onDone={() => { setOpen(null); load(); }} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ReprintSoon() {
    const [within, setWithin] = useState(45);
    const [d, setD] = useState(null);
    useEffect(() => { adminWhReprint(within).then(setD).catch((e) => { toast.error(formatApiError(e)); setD({ rows: [] }); }); }, [within]);
    return (
        <div className="space-y-3" data-testid="wh-reprint">
            <div className="flex flex-wrap items-center gap-3 text-sm text-[#4B5563]">
                <span>Books that run out within</span>
                <select value={within} onChange={(e) => setWithin(Number(e.target.value))} className="border border-[#E5E7EB] px-2 py-1 bg-white">
                    {[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}
                </select>
                <span>at the pace of the last 60 days (website, Amazon, Flipkart, dealers, samples — everything that left the shelf).</span>
            </div>
            {!d ? <p className="text-sm text-[#4B5563]">Loading…</p> : !d.rows.length ? (
                <p className="bg-white border border-[#E5E7EB] p-5 text-sm text-[#15803D]">No book runs out within {within} days at the current pace. ✓</p>
            ) : (
                <table className="w-full text-sm bg-white border border-[#E5E7EB]">
                    <thead><tr className="text-left text-xs text-[#6B7280] border-b border-[#E5E7EB]">
                        <th className="p-2">Book</th><th className="p-2 text-right">On shelf</th><th className="p-2 text-right">Going out / month</th><th className="p-2 text-right">Days left</th>
                    </tr></thead>
                    <tbody>
                        {d.rows.map((b) => (
                            <tr key={b.id} className="border-t border-[#F3F4F6]">
                                <td className="p-2"><div className="text-[#002B5C]"><BindingBadge binding={b.binding} />{b.plain_title || b.title}</div><div className="text-xs font-mono text-[#6B7280]">{b.isbn}</div></td>
                                <td className="p-2 text-right font-mono">{Math.max(0, b.wh_stock ?? 0)}</td>
                                <td className="p-2 text-right font-mono">{b.per_month}</td>
                                <td className={`p-2 text-right font-mono font-semibold ${b.days_left <= 15 ? "text-[#CC0033]" : b.days_left <= 30 ? "text-[#B45309]" : "text-[#002B5C]"}`}>{b.days_left}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
