import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { hrmCalendar, hrmSaveCalendar, leaveTeam, formatApiError } from "../../lib/api";

/**
 * HRM → Calendar (Nov 2026): a real month calendar for the leave year.
 *
 * Colours: company holiday (navy), optional holiday (amber), weekly off
 * (grey), leave (green dot — managers see their team, HR everyone). Click
 * any day for what it is; HR can add / remove a holiday right there, and it
 * saves at once. Weekly offs follow HRM → Settings (Sunday + 2nd Saturday).
 */
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th"];
const fyOf = (d) => { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(-2)}`; };

export function weeklyOffReason(d, w) {
    const wd = (d.getDay() + 6) % 7;      // Mon = 0 … Sun = 6 (same as the server)
    if ((w?.weekdays || []).includes(wd)) return `Weekly off (${DOW[wd] === "Sun" ? "Sunday" : DOW[wd]})`;
    const nth = Math.floor((d.getDate() - 1) / 7) + 1;
    if (wd === 5 && (w?.saturdays || []).includes(nth)) return `Weekly off (${ORD[nth]} Saturday)`;
    return "";
}

export default function HrmCalendar({ hr, manager }) {
    const today = useMemo(() => new Date(), []);
    const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
    const [cal, setCal] = useState(null);
    const [leave, setLeave] = useState([]);
    const [sel, setSel] = useState(iso(today));
    const fy = fyOf(month);

    const load = useCallback(() => hrmCalendar(fy).then(setCal).catch((e) => toast.error(formatApiError(e))), [fy]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!(hr || manager)) return;
        const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
        leaveTeam(iso(month), iso(end)).then((r) => setLeave(r.rows || [])).catch(() => setLeave([]));
    }, [month, hr, manager]);

    const byDate = useMemo(() => Object.fromEntries((cal?.rows || []).map((r) => [r.date, r])), [cal]);
    const cells = useMemo(() => {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const lead = (first.getDay() + 6) % 7;
        const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
    }, [month]);
    const onLeave = (ds) => leave.filter((r) => r.start <= ds && ds <= r.end);

    const save = async (rows) => {
        try { await hrmSaveCalendar(fy, rows); toast.success("Calendar saved."); load(); }
        catch (e) { toast.error(formatApiError(e)); }
    };
    if (!cal) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    const selD = parse(sel);
    const selHol = byDate[sel];
    const selOff = weeklyOffReason(selD, cal.weekly_off);
    const inYear = sel >= cal.start && sel <= cal.end;
    const monthHols = (cal.rows || []).filter((r) => r.date.slice(0, 7) === iso(month).slice(0, 7));

    return (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="hrm-calendar">
            <section className="bg-white border border-[#E5E7EB] p-4">
                <div className="flex items-center gap-2 mb-3">
                    <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" className="p-1.5 border border-[#E5E7EB]"><ChevronLeft size={16} /></button>
                    <h2 className="font-serif text-2xl text-[#002B5C] flex-1 text-center">
                        {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                        <span className="block text-[11px] font-sans text-[#6B7280]">Leave year {fy}</span>
                    </h2>
                    <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" className="p-1.5 border border-[#E5E7EB]"><ChevronRight size={16} /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wider text-[#6B7280] mb-1">
                    {DOW.map((d) => <div key={d}>{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Month">
                    {cells.map((d, i) => {
                        if (!d) return <div key={`b${i}`} />;
                        const ds = iso(d);
                        const h = byDate[ds];
                        const off = weeklyOffReason(d, cal.weekly_off);
                        const lv = onLeave(ds);
                        const base = h?.kind === "national" ? "bg-[#002B5C] text-white" : h?.kind === "optional" ? "bg-[#FDF3D9] text-[#7A4E00] border-[#E7B64B]"
                            : off ? "bg-[#F3F4F6] text-[#9CA3AF]" : "bg-white text-[#002B5C]";
                        return (
                            <button key={ds} type="button" onClick={() => setSel(ds)} aria-pressed={sel === ds}
                                title={h ? h.name : off || "Working day"}
                                className={`relative min-h-[64px] sm:min-h-[76px] border text-left p-1.5 transition-shadow ${base} ${sel === ds ? "ring-2 ring-[#F5B841]" : "border-[#E5E7EB]"} ${ds === iso(today) ? "outline outline-2 outline-[#15803D]" : ""}`}>
                                <span className="text-sm font-medium">{d.getDate()}</span>
                                {h && <span className="block text-[10px] leading-tight mt-0.5 line-clamp-2">{h.name}</span>}
                                {lv.length > 0 && (
                                    <span className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-[#15803D] bg-white/90 px-1">
                                        ● {lv.length}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-[#4B5563]">
                    <Key className="bg-[#002B5C]" label="Company holiday" />
                    <Key className="bg-[#FDF3D9] border border-[#E7B64B]" label="Optional (pick 1 a year)" />
                    <Key className="bg-[#F3F4F6]" label="Weekly off" />
                    {(hr || manager) && <span><span className="text-[#15803D]">●</span> people on leave</span>}
                    <span><span className="inline-block w-3 h-3 align-middle outline outline-2 outline-[#15803D] mr-1" />today</span>
                </div>
            </section>

            <aside className="space-y-4">
                <section className="bg-white border border-[#E5E7EB] p-4" data-testid="hrm-day-info">
                    <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">{selD.toLocaleDateString("en-IN", { weekday: "long" })}</div>
                    <div className="font-serif text-2xl text-[#002B5C]">{selD.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div>
                    <p className="mt-2 text-sm">
                        {selHol ? (
                            <><b>{selHol.name}</b> — {selHol.kind === "optional" ? "optional holiday: anyone may take it as their 1 optional holiday this year." : "company holiday: office closed."}</>
                        ) : selOff ? <>{selOff} — nobody works.</> : <>Working day.</>}
                    </p>
                    {(hr || manager) && (
                        <div className="mt-3">
                            <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">On leave</div>
                            {onLeave(sel).length ? (
                                <ul className="mt-1 text-sm space-y-1">
                                    {onLeave(sel).map((r) => <li key={r.id}>{r.name} <span className="text-[#6B7280]">· {r.label}{r.status === "pending" ? " (waiting approval)" : ""}</span></li>)}
                                </ul>
                            ) : <p className="text-sm text-[#6B7280]">Nobody.</p>}
                        </div>
                    )}
                    {hr && inYear && <DayEditor key={sel} date={sel} holiday={selHol} rows={cal.rows} onSave={save} />}
                </section>
                <section className="bg-white border border-[#E5E7EB] p-4">
                    <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">This month</div>
                    {monthHols.length ? (
                        <ul className="mt-1 text-sm divide-y divide-[#F3F4F6]">
                            {monthHols.map((r) => (
                                <li key={r.date} className="py-1.5 flex justify-between gap-2 cursor-pointer" onClick={() => setSel(r.date)}>
                                    <span>{r.name}{r.kind === "optional" && <span className="ml-1 text-[10px] text-[#B4750F]">optional</span>}</span>
                                    <span className="text-[#6B7280]">{parse(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="mt-1 text-sm text-[#6B7280]">No holidays.</p>}
                    <p className="mt-3 text-[11px] text-[#6B7280]">Leave year {fy}: {cal.working_days} working days · {(cal.rows || []).filter((r) => r.kind === "national").length} company holidays.</p>
                </section>
            </aside>
        </div>
    );
}

function DayEditor({ date, holiday, rows, onSave }) {
    const [name, setName] = useState(holiday?.name || "");
    const [kind, setKind] = useState(holiday?.kind || "national");
    const others = rows.filter((r) => r.date !== date);
    return (
        <div className="mt-4 border-t border-[#E5E7EB] pt-3 space-y-2" data-testid="hrm-day-editor">
            <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">{holiday ? "Edit holiday" : "Make this a holiday"}</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Holiday name" className="w-full border border-[#E5E7EB] px-2 py-1.5 text-sm" aria-label="Holiday name" />
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full border border-[#E5E7EB] px-2 py-1.5 text-sm" aria-label="Kind">
                <option value="national">Company holiday (office closed)</option>
                <option value="optional">Optional holiday (pick 1 a year)</option>
            </select>
            <div className="flex gap-2">
                <button type="button" disabled={!name.trim()} onClick={() => onSave([...others, { date, name: name.trim(), kind }])}
                    className="inline-flex items-center gap-1 bg-[#002B5C] text-white px-3 py-1.5 text-sm disabled:opacity-50"><Plus size={14} />{holiday ? "Save" : "Add"}</button>
                {holiday && (
                    <button type="button" onClick={() => window.confirm(`Remove ${holiday.name}?`) && onSave(others)}
                        className="inline-flex items-center gap-1 border border-[#CC0033] text-[#CC0033] px-3 py-1.5 text-sm"><Trash2 size={14} />Remove</button>
                )}
            </div>
        </div>
    );
}

function Key({ className, label }) {
    return <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-3 h-3 ${className}`} />{label}</span>;
}
