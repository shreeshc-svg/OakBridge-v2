import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminPodHolidays, adminSavePodHolidays, formatApiError } from "../../lib/api";

/**
 * Admin → Orders → Print-on-demand holidays. Days listed here (plus every
 * Saturday and Sunday) are skipped when the 5–7 working-day dispatch dates
 * are worked out for print-on-demand orders (backend/pod_core.py).
 */
// Fixed-date national holidays only; festival dates (Holi, Diwali…) move
// every year, so the office adds those itself.
const y = new Date().getFullYear();
const FIXED = [[`${y}-12-25`, "Christmas"], [`${y + 1}-01-26`, "Republic Day"], [`${y + 1}-08-15`, "Independence Day"], [`${y + 1}-10-02`, "Gandhi Jayanti"]];

export default function PodHolidays() {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open && rows === null) adminPodHolidays().then(setRows).catch(() => setRows([])); }, [open, rows]);
    const save = async () => {
        setBusy(true);
        try { setRows(await adminSavePodHolidays(rows.filter((r) => r.date))); toast.success("Holidays saved — dispatch dates now skip them."); }
        catch (e) { toast.error(formatApiError(e)); }
        finally { setBusy(false); }
    };
    const today = new Date().toISOString().slice(0, 10);
    return (
        <div className="mt-4 border border-[#E5E7EB] bg-white" data-testid="pod-holidays">
            <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 text-sm text-[#002B5C] flex justify-between">
                <span><b>Print-on-demand holidays</b> <span className="text-[#6B7280]">— skipped (with weekends) in the 5–7 working-day dispatch dates</span></span>
                <span>{open ? "−" : "+"}</span>
            </button>
            {open && (
                <div className="px-4 pb-4 space-y-2 text-sm">
                    {rows === null ? <p className="text-[#6B7280]">Loading…</p> : (
                        <>
                            {rows.map((r, i) => (
                                <div key={i} className={`flex flex-wrap gap-2 items-center ${r.date && r.date < today ? "opacity-50" : ""}`}>
                                    <input type="date" value={r.date} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, date: e.target.value } : x)))} className="border px-2 py-1" />
                                    <input value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="e.g. Diwali" className="border px-2 py-1 flex-1 min-w-[10rem]" />
                                    <button type="button" className="text-[#CC0033] text-xs underline" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove</button>
                                </div>
                            ))}
                            <div className="flex flex-wrap gap-3 items-center">
                                <button type="button" className="text-xs underline" onClick={() => setRows([...rows, { date: "", name: "" }])}>+ Add a holiday</button>
                                {!rows.length && (
                                    <button type="button" className="text-xs underline" onClick={() => setRows(FIXED.map(([date, name]) => ({ date, name })))}>
                                        Add the fixed national holidays (then add festivals)
                                    </button>
                                )}
                                <button type="button" disabled={busy} onClick={save} className="ml-auto bg-[#002B5C] text-white px-3 py-1.5 text-xs">{busy ? "Saving…" : "Save holidays"}</button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
