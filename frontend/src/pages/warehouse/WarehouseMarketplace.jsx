import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, SkipForward, Upload } from "lucide-react";
import { whMpPreview, whMpConfirm, formatApiError } from "../../lib/api";

/**
 * Warehouse phone → "Upload Amazon / Flipkart sheet" (Nov 2026).
 * Server: backend/warehouse_marketplace.py — it reads the sheet, matches ISBNs,
 * works out what changes, and applies only the difference when the same
 * date's sheet is uploaded again. This screen just shows the check and asks
 * for one Confirm. Big text and plain words: it's used standing in the
 * warehouse.
 */
const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const CH = { AMAZON: { label: "Amazon", tone: "#B4750F", bg: "#FEF3C7" }, FLIPKART: { label: "Flipkart", tone: "#1D4ED8", bg: "#DBEAFE" } };

export default function MarketplaceSheet({ practice, onDone }) {
    const input = useRef(null);
    const [file, setFile] = useState(null);
    const [pv, setPv] = useState(null);
    const [askDate, setAskDate] = useState(false);
    const [date, setDate] = useState("");
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);

    const read = async (f, d = "") => {
        if (!f) return;
        setFile(f); setBusy(true); setPv(null);
        try { setPv(await whMpPreview(f, d)); setAskDate(false); }
        catch (e) {
            const msg = formatApiError(e);
            if (/date/i.test(msg)) setAskDate(true);
            toast.error(msg);
        } finally { setBusy(false); }
    };
    const confirm = async () => {
        setBusy(true);
        try { const r = await whMpConfirm(pv.id); setDone(r); toast.success("Done — stock updated."); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };

    if (done) {
        const out = done.changes.filter((c) => c.delta > 0).reduce((n, c) => n + c.delta, 0);
        const back = -done.changes.filter((c) => c.delta < 0).reduce((n, c) => n + c.delta, 0);
        return (
            <div className="bg-white border-2 border-[#15803D] p-6 text-center space-y-3" data-testid="wh-mp-done">
                <CheckCircle2 size={48} className="mx-auto text-[#15803D]" />
                <div className="text-xl font-medium text-[#002B5C]">Sheet for {fmtDate(done.date)} is in.</div>
                <p className="text-base text-[#374151]">{done.changes.length ? <>{out} copies taken out{back ? `, ${back} put back` : ""}.</> : "Nothing new — this sheet was already counted."}</p>
                <button type="button" onClick={onDone} className="w-full bg-[#002B5C] text-white py-3 text-lg">Back to home</button>
            </div>
        );
    }

    const changes = pv?.changes || [];
    const outN = changes.filter((c) => c.delta > 0).reduce((n, c) => n + c.delta, 0);
    const backN = -changes.filter((c) => c.delta < 0).reduce((n, c) => n + c.delta, 0);
    return (
        <div className="space-y-4" data-testid="wh-mp">
            <h2 className="text-xl font-medium text-[#002B5C] flex items-center gap-2"><FileSpreadsheet size={22} />Amazon / Flipkart sheet</h2>
            <p className="text-sm text-[#4B5563]">Upload today's Excel sheet. Only <b>AMAZON</b> and <b>FLIPKART</b> rows are counted; courier and Kindle rows are skipped. One book per row.</p>
            <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
            <button type="button" disabled={busy} onClick={() => input.current?.click()}
                className="w-full flex items-center justify-center gap-3 border-2 border-dashed border-[#002B5C] bg-white py-6 text-lg font-medium text-[#002B5C] disabled:opacity-50" data-testid="wh-mp-pick">
                <Upload size={24} />{busy ? "Reading…" : file ? `Change file (${file.name})` : "Choose the Excel sheet"}
            </button>
            {askDate && (
                <div className="bg-[#FFFBEB] border border-[#FDE68A] p-3 space-y-2">
                    <label className="block text-base">Which day is this sheet for?
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full border border-[#E5E7EB] px-3 py-2" /></label>
                    <button type="button" disabled={!date || busy} onClick={() => read(file, date)} className="w-full bg-[#002B5C] text-white py-3 disabled:opacity-50">Read the sheet</button>
                </div>
            )}

            {pv && (
                <>
                    <div className="bg-white border border-[#E5E7EB] p-4">
                        <div className="text-sm text-[#6B7280]">Sheet date</div>
                        <div className="text-lg font-medium text-[#002B5C]">{fmtDate(pv.date)}</div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                            {Object.entries(CH).map(([k, c]) => (
                                <div key={k} className="p-3" style={{ background: c.bg }}>
                                    <div className="text-xs uppercase tracking-wide" style={{ color: c.tone }}>Carton out – {c.label}</div>
                                    <div className="text-3xl font-semibold text-[#002B5C]">{pv.totals[c.label] || 0}</div>
                                    <div className="text-xs text-[#4B5563]">copies on this sheet</div>
                                </div>
                            ))}
                        </div>
                        {pv.already && <p className="mt-3 text-sm bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-2">This date was uploaded before. Only the <b>changes</b> below will be applied — nothing is counted twice.</p>}
                    </div>

                    {pv.errors.length > 0 && (
                        <Section icon={AlertTriangle} tone="#CC0033" title={`${pv.errors.length} row(s) to fix — not counted`}>
                            {pv.errors.map((e, i) => <Row key={i} n={e.line} title={e.title || e.isbn_raw} sub={e.why} bad />)}
                            <p className="text-xs text-[#6B7280] mt-2">Fix these in the Excel sheet and upload it again — the rest will not be counted twice.</p>
                        </Section>
                    )}

                    <Section icon={CheckCircle2} tone="#15803D" title={changes.length ? `${changes.length} change(s) to apply` : "Nothing new to apply"}>
                        {changes.map((c) => {
                            const ch = CH[c.channel];
                            return (
                                <div key={`${c.channel}-${c.book_id}`} className="flex items-center gap-3 py-2 border-b border-[#F3F4F6] last:border-0">
                                    <span className="text-[11px] font-semibold px-2 py-0.5" style={{ background: ch.bg, color: ch.tone }}>{ch.label}</span>
                                    <span className="flex-1 text-base text-[#111827]">{c.title}</span>
                                    <span className={`text-lg font-semibold ${c.delta > 0 ? "text-[#CC0033]" : "text-[#15803D]"}`}>{c.delta > 0 ? `−${c.delta}` : `+${-c.delta}`}</span>
                                </div>
                            );
                        })}
                        {pv.rows.filter((r) => r.warn).map((r, i) => <Row key={`w${i}`} n={r.line} title={r.book_title} sub={r.warn} />)}
                    </Section>

                    {pv.ignored.length > 0 && (
                        <Section icon={SkipForward} tone="#6B7280" title={`${pv.ignored.length} row(s) skipped`}>
                            {pv.ignored.map((e, i) => <Row key={i} n={e.line} title={e.title} sub={e.why} />)}
                        </Section>
                    )}

                    {practice ? (
                        <p className="bg-[#FEF3C7] p-3 text-base text-center">Practice mode — nothing is changed. Switch off Practice to apply.</p>
                    ) : (
                        <button type="button" disabled={busy || !changes.length} onClick={confirm} data-testid="wh-mp-confirm"
                            className="w-full bg-[#15803D] text-white py-4 text-lg font-medium disabled:opacity-50">
                            {busy ? "Saving…" : changes.length ? `Confirm — ${outN} out${backN ? `, ${backN} back` : ""}` : "Nothing to apply"}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

function Section({ icon: I, tone, title, children }) {
    return (
        <div className="bg-white border border-[#E5E7EB] p-4">
            <div className="flex items-center gap-2 font-medium mb-2" style={{ color: tone }}><I size={18} />{title}</div>
            {children}
        </div>
    );
}

function Row({ n, title, sub, bad = false }) {
    return (
        <div className="py-2 border-b border-[#F3F4F6] last:border-0">
            <div className="text-base text-[#111827]"><span className="text-xs text-[#9CA3AF] mr-1">Row {n}</span>{title}</div>
            <div className={`text-sm ${bad ? "text-[#CC0033]" : "text-[#B4750F]"}`}>{sub}</div>
        </div>
    );
}
