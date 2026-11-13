import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminWhMpSheets, adminWhMpUndo, formatApiError } from "../../lib/api";

/**
 * Admin → Warehouse → Amazon / Flipkart sheets. One row per date the
 * warehouse uploaded (backend/warehouse_marketplace.py). "Undo sheet" puts
 * every copy back and forgets the date, so the corrected sheet can be
 * uploaded fresh. Single lines aren't undone in Movements — the per-date
 * record would then disagree with the stock.
 */
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function MarketplaceSheets({ onOpen }) {
    const [rows, setRows] = useState(null);
    const load = useCallback(() => adminWhMpSheets().then(setRows).catch((e) => { toast.error(formatApiError(e)); setRows([]); }), []);
    useEffect(() => { load(); }, [load]);
    const undo = async (r) => {
        if (!window.confirm(`Undo the ${fmt(r.date)} sheet?\n\nAll ${r.Amazon + r.Flipkart} copies go back into stock and the date is forgotten — upload the corrected sheet afterwards.`)) return;
        try { const x = await adminWhMpUndo(r.date); toast.success(`Undone — ${x.reversed} movement(s) reversed.`); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!rows) return <p className="mt-6 text-sm text-[#4B5563]">Loading…</p>;
    return (
        <div className="mt-6" data-testid="wh-mp-sheets">
            <p className="text-sm text-[#4B5563] mb-4">Daily sheets the warehouse uploaded from the phone ("Upload Amazon / Flipkart sheet"). Re-uploading a date applies only the changes; Undo removes the whole date.</p>
            {!rows.length ? <p className="text-sm text-[#4B5563]">No sheets uploaded yet.</p> : (
                <table className="w-full text-sm bg-white border border-[#E5E7EB]">
                    <thead><tr className="text-left text-xs text-[#4B5563] border-b border-[#E5E7EB]"><th className="p-3">Date</th><th>Carton out – Amazon</th><th>Carton out – Flipkart</th><th>Titles</th><th>File</th><th /></tr></thead>
                    <tbody>{rows.map((r) => (
                        <tr key={r.date} className="border-b border-[#F3F4F6]">
                            <td className="p-3 font-medium text-[#002B5C]">{fmt(r.date)}</td>
                            <td>{r.Amazon}</td><td>{r.Flipkart}</td><td>{r.titles}</td>
                            <td className="text-xs text-[#6B7280]">{r.files.join(", ")}<div>{r.by}</div></td>
                            <td className="text-right pr-3 whitespace-nowrap">
                                <button type="button" onClick={() => onOpen(r.date)} className="text-xs underline mr-3">Movements</button>
                                <button type="button" onClick={() => undo(r)} className="text-xs border border-[#CC0033] text-[#CC0033] px-2 py-1">Undo sheet</button>
                            </td>
                        </tr>))}</tbody>
                </table>
            )}
        </div>
    );
}
