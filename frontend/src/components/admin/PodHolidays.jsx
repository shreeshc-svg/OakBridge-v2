import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminPodHolidays, adminSavePodHolidays, adminPodSettings, adminSavePodSettings, formatApiError } from "../../lib/api";

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
    const [st, setSt] = useState(null);
    useEffect(() => { if (open && rows === null) adminPodHolidays().then(setRows).catch(() => setRows([])); }, [open, rows]);
    useEffect(() => { if (open && st === null) adminPodSettings().then(setSt).catch(() => setSt({ show_new: true, new_until: "", explore_strip: true })); }, [open, st]);
    const saveSt = async (patch) => {
        const next = { ...st, ...patch };
        setSt(next);
        try { setSt(await adminSavePodSettings(next)); toast.success("Saved — the storefront updates on the next page load."); }
        catch (e) { toast.error(formatApiError(e)); }
    };
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
                <span><b>Print on demand — settings &amp; holidays</b> <span className="text-[#6B7280]">— “NEW” labels, Bookstore strip, and days skipped in the 5–7 working-day dates</span></span>
                <span>{open ? "−" : "+"}</span>
            </button>
            {open && st && (
                <div className="px-4 pb-3 mb-2 border-b border-[#E5E7EB] space-y-2 text-sm" data-testid="pod-settings">
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!st.show_new} onChange={(e) => saveSt({ show_new: e.target.checked })} />
                        Show the “NEW” labels (book page, tiles, Bookstore tab)
                    </label>
                    {st.show_new && (
                        <label className="flex flex-wrap items-center gap-2 pl-6 text-xs text-[#4B5563]">
                            …and hide them automatically after
                            <input type="date" value={st.new_until || ""} onChange={(e) => saveSt({ new_until: e.target.value })} className="border px-2 py-0.5" />
                            {st.new_until && <button type="button" className="underline" onClick={() => saveSt({ new_until: "" })}>no end date</button>}
                        </label>
                    )}
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={!!st.explore_strip} onChange={(e) => saveSt({ explore_strip: e.target.checked })} />
                        Show the “Explore Print on Demand” strip in the Bookstore
                    </label>
                    <p className="text-[11px] text-[#6B7280]">The Print on Demand tab and the books' “Print on demand” button stay either way — these only control the “new service” announcements.</p>
                </div>
            )}
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
