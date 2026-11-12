import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, Download } from "lucide-react";
import { Ring } from "./HrmBits";
import LeavePolicy from "./HrmLeavePolicy";
import {
    leaveSummary, leaveApply, leaveCancel, leaveApprovals, leaveDecide, leaveAdjust, leaveAdjustments, leaveExport, leaveSetBalance,
    hrmPeople, saveBlob, formatApiError,
} from "../../lib/api";

/**
 * HRM → Leave (release 2). The rules live on the server (backend/
 * hr_leave_core.py — the Oakbridge leave policy); this screen asks, shows
 * balances and the server's answer. Nothing here decides who may take what.
 */
export const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const span = (r) => (r.start === r.end ? fmt(r.start) : `${fmt(r.start)} – ${fmt(r.end)}`);
const n = (x) => (Number.isInteger(x) ? String(x) : (Math.round(x * 2) / 2).toFixed(1));
const FLAG = {
    medical_certificate_needed: "Medical certificate needed (over 3 days)",
    short_notice: "Less than the recommended 5 days' notice — your manager may still approve",
    reported_after_first_day: "Reported after the first day of absence",
    over_lop_cap: "Over the 10-day loss-of-pay limit — HR must approve",
    applied_less_than_a_month_ahead: "Applied less than a month ahead",
    eligibility_days_short: "Fewer working days than the eligibility rule — HR to check",
    asked_after_working: "Asked after working the day (policy: prior approval)",
};
const STATUS = { pending: "text-[#B4750F]", approved: "text-[#15803D]", rejected: "text-[#CC0033]", cancelled: "text-[#6B7280]" };
const LABEL = { CL: "Casual", SL: "Sick", EL: "Earned", MAT: "Maternity", PAT: "Paternity", BER: "Bereavement", OPT: "Optional holiday",
    COMP: "Comp-off", LOP: "Loss of pay", COMP_EARN: "Comp-off earned", WFH: "Work from home" };

/* Balance tiles — also on the Home dashboard. */
/* Balance cards — also on Home. A ring per leave type shows what's LEFT of
   the year's allowance, each type in its own colour so they read at a glance. */
const KIND = [
    ["CL", "Casual", "#0EA5A4"], ["SL", "Sick", "#E11D48"], ["EL", "Earned", "#D97706"],
    ["OPT", "Optional holiday", "#7C3AED"], ["COMP", "Comp-off", "#0284C7"],
];
export function BalanceCards({ s }) {
    if (!s) return null;
    const b = s.balances;
    const confirmed = !!s.emp.confirmed_on;
    const of = { CL: b.CL.entitled, SL: b.SL.entitled, EL: Math.max(b.EL.available, b.EL.carried + b.EL.earned + (b.EL.adjusted || 0)), OPT: b.OPT.entitled, COMP: b.COMP.available };
    const left = { CL: b.CL.available, SL: b.SL.available, EL: Math.max(0, b.EL.available), OPT: b.OPT.available, COMP: b.COMP.available };
    const sub = { CL: `of ${n(of.CL)} this year`, SL: `of ${n(of.SL)} this year`, EL: `${n(b.EL.carried)} carried + ${n(b.EL.earned)} earned`,
        OPT: "1 a year, from the list", COMP: b.COMP.available ? "use within 2 months" : "earned by working a day off" };
    return (
        <div>
            {!confirmed && (
                <div className="mb-3 border-l-4 border-[#F5B841] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
                    You're on probation — paid leave starts once you're confirmed. Until then time off is loss of pay (bereavement excepted).
                </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="hrm-balances">
                {KIND.map(([k, label, color]) => (
                    <div key={k} className="bg-white border border-[#E5E7EB] p-3 flex flex-col items-center text-center hover:shadow-sm transition-shadow">
                        <Ring value={left[k]} max={of[k] || (left[k] ? left[k] : 1)} color={color} size={76} label={n(k === "EL" ? Math.floor(left[k] * 2) / 2 : left[k])} />
                        <div className="mt-1.5 text-sm font-medium text-[#002B5C]">{label}</div>
                        <div className="text-[11px] text-[#6B7280] leading-tight">{sub[k]}</div>
                    </div>
                ))}
                <div className="bg-[#F9FAFB] border border-[#E5E7EB] p-3 flex flex-col items-center justify-center text-center">
                    <div className="font-serif text-3xl text-[#4B5563]">{n(b.LOP.used)}</div>
                    <div className="text-sm font-medium text-[#4B5563]">Loss of pay</div>
                    <div className="text-[11px] text-[#6B7280] leading-tight">days used · HR approves past {b.LOP.cap}</div>
                </div>
            </div>
        </div>
    );
}

export default function LeaveTab({ me }) {
    const [s, setS] = useState(null);
    const load = useCallback(() => (me.me ? leaveSummary().then(setS).catch((e) => toast.error(formatApiError(e))) : Promise.resolve()), [me]);
    useEffect(() => { load(); }, [load]);
    // Three views instead of one long page: your own leave, what you approve,
    // and (HR) the setup tools — each person sees only the views they use.
    const views = [...(me.me ? [["mine", "My leave"]] : []), ...((me.hr || me.manager) ? [["approve", "Approvals"]] : []),
        ...(me.hr ? [["tools", "HR tools"]] : []), ["policy", "Leave policy"]];   // the policy: everyone can read it here
    const [view, setView] = useState(views[0]?.[0] || "mine");
    return (
        <div className="space-y-6">
            {views.length > 1 && (
                <div className="inline-flex border border-[#E5E7EB] bg-white" role="tablist" data-testid="hrm-leave-views">
                    {views.map(([k, l]) => (
                        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                            className={`px-4 py-2 text-sm ${view === k ? "bg-[#002B5C] text-white" : "text-[#002B5C] hover:bg-[#F5F7FA]"}`}>{l}</button>
                    ))}
                </div>
            )}
            {view === "mine" && me.me && (
                <>
                    <button type="button" onClick={() => setView("policy")} className="text-sm text-[#002B5C] underline" data-testid="hrm-read-policy">Not sure what you can take? Read the leave policy</button>
                    <BalanceCards s={s} />
                    {s && <ApplyForm s={s} onDone={load} />}
                    {s && <MyRequests rows={s.requests} onChange={load} />}
                </>
            )}
            {view === "approve" && (me.hr || me.manager) && <Approvals hr={me.hr} onChange={load} />}
            {view === "policy" && <LeavePolicy />}
            {view === "tools" && me.hr && <HrTools superadmin={me.superadmin} />}
        </div>
    );
}

function ApplyForm({ s, onDone }) {
    const confirmed = !!s.emp.confirmed_on;
    const g = s.emp.gender;
    const types = [
        ...(confirmed ? [["CL", "Casual leave (5 days' notice recommended)"], ["SL", "Sick leave"], ["EL", "Earned leave"], ["OPT", "Optional holiday"],
            ["COMP", "Use a comp-off"], ["COMP_EARN", "Comp-off: I'm working a day off"]] : []),
        ...(confirmed && g === "male" ? [["PAT", "Paternity leave"]] : []),
        ...(g === "female" ? [["MAT", "Maternity leave"]] : []),
        ["BER", "Bereavement leave"], ["LOP", "Loss of pay (unpaid)"],
        ["WFH", "Work from home (not leave)"],
    ];
    const blank = { type: types[0][0], start: "", end: "", reason: "", child_birth: "", expected_delivery: "" };
    const [f, setF] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [pv, setPv] = useState(null);       // server's answer to "what would this do?"
    const set = (k) => (e) => { setErr(""); setF({ ...f, [k]: e.target.value }); };
    const bodyOf = (x) => ({ type: x.type, reason: x.reason, start: x.start, end: x.type === "OPT" ? x.start : x.end || x.start,
        ...(x.type === "COMP_EARN" ? { worked_on: x.start } : {}), ...(x.type === "PAT" ? { child_birth: x.child_birth } : {}),
        ...(x.type === "MAT" ? { expected_delivery: x.expected_delivery } : {}) });
    // Ask the server (same rules as applying) once the dates are in, so the
    // person sees what it will cost — or why not — BEFORE pressing Apply.
    useEffect(() => {
        setPv(null);
        if (!f.start || (f.type === "PAT" && !f.child_birth) || (f.type === "MAT" && !f.expected_delivery)) return undefined;
        const t = setTimeout(() => {
            leaveApply({ ...bodyOf(f), preview: true }).then((r) => setPv({ ok: true, ...r })).catch((e) => setPv({ ok: false, msg: formatApiError(e) }));
        }, 350);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [f.type, f.start, f.end, f.child_birth, f.expected_delivery]);
    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        const body = bodyOf(f);
        try {
            const r = await leaveApply(body);
            toast.success(f.type === "COMP_EARN" || f.type === "WFH" ? "Sent to your manager for approval." : `Applied: ${r.days} day(s). Your manager has been emailed.`);
            setF(blank); onDone();
        } catch (er) { setErr(formatApiError(er)); } finally { setBusy(false); }
    };
    const inp = "mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm bg-white";
    const single = f.type === "OPT" || f.type === "COMP_EARN";
    // Optional holiday: the list comes from HR's calendar for this year. An
    // empty list used to show an empty "Choose…" box with no explanation.
    const optList = s.optional_list || (s.optional_days || []).map((d) => ({ date: d, name: "" }));
    const optNone = !optList.length;
    const optUsed = (s.balances?.OPT?.available ?? 1) <= 0;
    const optBlocked = f.type === "OPT" && (optNone || optUsed);
    const todayIso = new Date().toLocaleDateString("en-CA");
    return (
        <form onSubmit={submit} className="bg-white border border-[#E5E7EB] p-4" data-testid="hrm-apply">
            <h2 className="font-serif text-xl text-[#002B5C] mb-3">Apply for leave or work from home</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <label className="lg:col-span-2">Type<select value={f.type} onChange={set("type")} className={inp}>{types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                {f.type === "OPT" ? (
                    optNone ? (
                        <p className="lg:col-span-2 self-end border border-[#E7B64B] bg-[#FFFBEB] px-3 py-2 text-sm" data-testid="hrm-no-optional">
                            No optional holidays are set for FY {s.fy} yet. HR adds them in <b>Calendar</b> (click the day → kind “Optional holiday”).
                        </p>
                    ) : optUsed ? (
                        <p className="lg:col-span-2 self-end border border-[#E5E7EB] bg-[#F5F7FA] px-3 py-2 text-sm" data-testid="hrm-optional-used">
                            You've already {s.balances.OPT.pending ? "applied for" : "taken"} your optional holiday for FY {s.fy} (1 a year).
                        </p>
                    ) : (
                        <label className="lg:col-span-2">Which optional holiday
                            <select required value={f.start} onChange={set("start")} className={inp}>
                                <option value="">Choose…</option>
                                {optList.map((o) => <option key={o.date} value={o.date}>{o.name ? `${o.name} — ` : ""}{fmt(o.date)}{o.date < todayIso ? " (passed)" : ""}</option>)}
                            </select>
                        </label>
                    )
                ) : (
                    <>
                        <label>{f.type === "COMP_EARN" ? "Day you'll work" : "From"}<input required type="date" value={f.start} onChange={set("start")} className={inp} /><Words d={f.start} /></label>
                        {!single && <label>To <span className="text-[11px] text-[#6B7280]">(blank = one day)</span><input type="date" value={f.end} min={f.start} onChange={set("end")} className={inp} /><Words d={f.end} /></label>}
                    </>
                )}
                {f.type === "PAT" && <label>Child's date of birth<input required type="date" value={f.child_birth} onChange={set("child_birth")} className={inp} /><Words d={f.child_birth} /></label>}
                {f.type === "MAT" && <label>Expected delivery<input required type="date" value={f.expected_delivery} onChange={set("expected_delivery")} className={inp} /><Words d={f.expected_delivery} /></label>}
                <label className="sm:col-span-2 lg:col-span-4">Reason<input value={f.reason} onChange={set("reason")} maxLength={500} className={inp} placeholder="Optional" /></label>
            </div>
            {pv && !err && (
                pv.ok ? (
                    <p className="mt-3 border-l-4 border-[#15803D] bg-[#F0FDF4] px-3 py-2 text-sm text-[#14532D]" data-testid="hrm-apply-preview">
                        {f.type === "COMP_EARN"
                            ? <>Asks {pv.approver} to approve a comp-off for working that day.</>
                            : f.type === "WFH"
                            ? <>Asks <b>{pv.approver}</b> to approve <b>{pv.days} working day{pv.days === 1 ? "" : "s"}</b> from home. Not leave — no balance is used.</>
                            : <>This will use <b>{pv.days} day{pv.days === 1 ? "" : "s"}</b> of {(LABEL[f.type] || f.type).toLowerCase()}
                                {pv.left_after != null && f.type !== "LOP" && <> ({n(pv.left_after)} left after)</>}
                                {f.type === "LOP" && pv.left_after != null && <> — unpaid; {n(pv.left_after)} of the yearly 10 left before HR must approve</>}
                                . Goes to <b>{pv.approver}</b>{pv.needs_hr ? ", then HR" : ""}.</>}
                        {(pv.flags || []).map((fl) => <span key={fl} className="block text-[#92400E] mt-0.5">⚠ {FLAG[fl] || fl}</span>)}
                    </p>
                ) : <p className="mt-3 border-l-4 border-[#CC0033] bg-[#FEF2F2] px-3 py-2 text-sm text-[#991B1B]" data-testid="hrm-apply-preview">{pv.msg}</p>
            )}
            {err && <p role="alert" className="mt-3 border border-[#CC0033] bg-[#FEF2F2] text-[#CC0033] px-3 py-2 text-sm">{err}</p>}
            <div className="mt-3 flex items-center gap-3">
                <button type="submit" disabled={busy || optBlocked || (pv && !pv.ok)} className="bg-[#002B5C] text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? "Sending…" : "Apply"}</button>
                <span className="text-xs text-[#6B7280]">Weekly offs and holidays aren't counted (loss of pay and maternity count every day).</span>
            </div>
        </form>
    );
}

function Words({ d }) {
    return d ? <span className="block mt-0.5 text-[11px] text-[#15803D]">= {fmt(d)}</span> : null;
}

function MyRequests({ rows, onChange }) {
    const cancel = async (r) => {
        if (!window.confirm(`Withdraw ${LABEL[r.type]} ${span(r)}?`)) return;
        try { await leaveCancel(r.id); toast.success("Withdrawn."); onChange(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const today = new Date().toISOString().slice(0, 10);
    return (
        <section className="bg-white border border-[#E5E7EB]">
            <h2 className="font-serif text-xl text-[#002B5C] px-4 pt-4">My requests</h2>
            {!rows.length ? <p className="px-4 py-4 text-sm text-[#6B7280]">None this year.</p> : (
                <ul className="divide-y divide-[#F3F4F6] mt-2">
                    {rows.map((r) => (
                        <li key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
                            <span className="w-36 font-medium text-[#002B5C]">{LABEL[r.type]}</span>
                            <span className="flex-1 min-w-[160px]">{r.type === "COMP_EARN" ? `worked ${fmt(r.worked_on)}` : `${span(r)} · ${r.days} day(s)`}</span>
                            <span className={`capitalize ${STATUS[r.status] || ""}`}>{r.status}{r.status === "pending" && r.stage === "hr" ? " (with HR)" : ""}</span>
                            {(r.status === "pending" || (r.status === "approved" && r.start > today)) && (
                                <button type="button" onClick={() => cancel(r)} className="text-xs underline text-[#4B5563]">Withdraw</button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export function Approvals({ hr, onChange, compact = false }) {
    const [rows, setRows] = useState(null);
    const load = useCallback(() => leaveApprovals().then(setRows).catch(() => setRows([])), []);
    useEffect(() => { load(); }, [load]);
    const [panel, setPanel] = useState(null);   // {id, approve}: the inline confirm under that request
    const decide = async (r, body) => {
        try {
            const res = await leaveDecide(r.id, body);
            toast.success(res.stage === "hr" ? "Approved — now with HR for the final OK." : body.approve ? "Approved." : "Rejected.");
            setPanel(null); load(); onChange?.();
        } catch (e) { toast.error(formatApiError(e)); }
    };
    // Approve straight away unless something must be confirmed first
    // (certificate seen, bereavement days) — then the inline panel opens.
    const approve = (r) => ((r.flags || []).includes("medical_certificate_needed") || (hr && r.type === "BER") ? setPanel({ id: r.id, approve: true }) : decide(r, { approve: true }));
    if (!rows) return null;
    if (compact && !rows.length) return <p className="text-sm text-[#6B7280]">Nothing waiting for you.</p>;
    return (
        <section className={compact ? "" : "bg-white border border-[#E5E7EB]"} data-testid="hrm-approvals">
            {!compact && <h2 className="font-serif text-xl text-[#002B5C] px-4 pt-4">Waiting for your approval</h2>}
            {!rows.length ? <p className="px-4 py-4 text-sm text-[#6B7280]">Nothing waiting.</p> : (
                <ul className={`divide-y divide-[#F3F4F6] ${compact ? "" : "mt-2"}`}>
                    {rows.slice(0, compact ? 5 : 200).map((r) => (
                        <li key={r.id} className={`${compact ? "py-2" : "px-4 py-3"} text-sm`}>
                            <div className="flex flex-wrap items-center gap-2">
                                <b className="text-[#002B5C]">{r.name}</b>
                                <span>{r.label}</span>
                                <span className="text-[#4B5563]">{r.type === "COMP_EARN" ? `working ${fmt(r.worked_on)}` : `${span(r)} · ${r.days} day(s)`}</span>
                                {r.stage === "hr" && <span className="text-[10px] uppercase tracking-wider text-[#B4750F]">HR step</span>}
                                <span className="ml-auto flex gap-2">
                                    <button type="button" onClick={() => approve(r)} className="inline-flex items-center gap-1 bg-[#15803D] text-white px-2.5 py-1 text-xs"><Check size={12} />Approve</button>
                                    <button type="button" onClick={() => setPanel({ id: r.id, approve: false })} className="inline-flex items-center gap-1 border border-[#CC0033] text-[#CC0033] px-2.5 py-1 text-xs"><X size={12} />Reject</button>
                                </span>
                            </div>
                            {r.reason && <div className="text-xs text-[#6B7280] mt-0.5">“{r.reason}”</div>}
                            {(r.flags || []).map((fl) => <div key={fl} className="text-xs text-[#B4750F] mt-0.5">⚠ {FLAG[fl] || fl}</div>)}
                            {panel?.id === r.id && <DecidePanel r={r} hr={hr} approve={panel.approve} onCancel={() => setPanel(null)} onSubmit={(body) => decide(r, body)} />}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function SetBalance({ people }) {
    const [f, setF] = useState({ emp_id: "", type: "EL", to: "", note: "" });
    const [cur, setCur] = useState(null);
    useEffect(() => { setCur(null); if (f.emp_id) leaveSummary(f.emp_id).then(setCur).catch(() => {}); }, [f.emp_id]);
    const now = cur ? { CL: cur.balances.CL.available, SL: cur.balances.SL.available, EL: cur.balances.EL.available,
        OPT: cur.balances.OPT.available, COMP: cur.balances.COMP.available }[f.type] : null;
    const save = async (e) => {
        e.preventDefault();
        if (!window.confirm(`Set ${LABEL[f.type]} left to ${f.to} (now ${n(now ?? 0)})?`)) return;
        try { const r = await leaveSetBalance({ ...f, to: Number(f.to) }); toast.success("Balance set."); setCur({ ...cur, balances: r.balances }); setF({ ...f, to: "", note: "" }); }
        catch (er) { toast.error(formatApiError(er)); }
    };
    const inp = "mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm bg-white";
    return (
        <form onSubmit={save} className="bg-white border border-[#002B5C] p-4 text-sm lg:col-span-2" data-testid="hrm-set-balance">
            <h2 className="font-serif text-xl text-[#002B5C]">Set a balance <span className="text-xs font-sans text-[#6B7280]">(super admin)</span></h2>
            <p className="text-xs text-[#6B7280] mt-1">Set exactly how many days someone has LEFT — to match the paper register, zero it, or grant extra. Recorded with your reason. Per-person weekly offs are in People → Edit; special days off for a team or person in Calendar.</p>
            <div className="grid sm:grid-cols-4 gap-2 mt-3">
                <label className="sm:col-span-2">Person<select required value={f.emp_id} onChange={(e) => setF({ ...f, emp_id: e.target.value })} className={inp}>
                    <option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.emp_code ? ` (${p.emp_code})` : ""}</option>)}
                </select></label>
                <label>Leave<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={inp}>
                    <option value="EL">Earned</option><option value="CL">Casual</option><option value="SL">Sick</option><option value="OPT">Optional holiday</option><option value="COMP">Comp-off</option>
                </select></label>
                <label>Set left to {now !== null && <span className="text-[11px] text-[#6B7280]">(now {n(now)})</span>}<input required type="number" min="0" step={f.type === "COMP" ? "1" : "0.5"} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={inp} /></label>
                <label className="sm:col-span-4">Reason<input required minLength={5} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} /></label>
            </div>
            <button type="submit" className="mt-3 bg-[#002B5C] text-white px-4 py-2">Set balance</button>
        </form>
    );
}

/* Inline instead of browser pop-ups (much better on phones): the reason for a
   rejection, "certificate seen" for long sick leave, days for bereavement. */
function DecidePanel({ r, hr, approve, onCancel, onSubmit }) {
    const [note, setNote] = useState("");
    const [cert, setCert] = useState(false);
    const [days, setDays] = useState(r.days);
    const needCert = approve && (r.flags || []).includes("medical_certificate_needed");
    const ber = approve && hr && r.type === "BER";
    const ok = approve ? (!needCert || cert) && (!ber || (days >= 1 && days <= 30)) : note.trim().length >= 3;
    return (
        <div className={`mt-2 border-l-4 px-3 py-2 space-y-2 ${approve ? "border-[#15803D] bg-[#F0FDF4]" : "border-[#CC0033] bg-[#FEF2F2]"}`} data-testid="hrm-decide-panel">
            {!approve && (
                <label className="block text-xs">Why? <span className="text-[#6B7280]">(they'll see this)</span>
                    <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1 text-sm bg-white" />
                </label>
            )}
            {needCert && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cert} onChange={(e) => setCert(e.target.checked)} />I've seen the medical certificate</label>}
            {ber && <label className="flex items-center gap-2 text-sm">Days to grant<input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-20 border border-[#E5E7EB] px-2 py-1 bg-white" /><span className="text-xs text-[#6B7280]">(asked {r.days})</span></label>}
            {approve && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full border border-[#E5E7EB] px-2 py-1 text-sm bg-white" />}
            <div className="flex gap-2">
                <button type="button" disabled={!ok} onClick={() => onSubmit({ approve, note, ...(needCert ? { cert_seen: true } : {}), ...(ber && days !== r.days ? { days } : {}) })}
                    className={`px-3 py-1 text-xs text-white disabled:opacity-50 ${approve ? "bg-[#15803D]" : "bg-[#CC0033]"}`}>{approve ? "Approve" : "Reject"}</button>
                <button type="button" onClick={onCancel} className="px-3 py-1 text-xs">Cancel</button>
            </div>
        </div>
    );
}

function HrTools({ superadmin }) {
    const [people, setPeople] = useState([]);
    const [f, setF] = useState({ emp_id: "", fy: "", type: "EL", days: "", note: "" });
    const [rows, setRows] = useState([]);
    const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
    useEffect(() => { hrmPeople().then(setPeople).catch(() => {}); leaveAdjustments().then(setRows).catch(() => {}); }, []);
    const thisFy = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(-2)}`; })();
    const add = async (e) => {
        e.preventDefault();
        try { await leaveAdjust({ ...f, fy: f.fy || thisFy, days: Number(f.days) }); toast.success("Saved."); setF({ ...f, days: "", note: "" }); setRows(await leaveAdjustments()); }
        catch (er) { toast.error(formatApiError(er)); }
    };
    const exp = async () => {
        try { saveBlob(await leaveExport(month), `razorpayx-leave-${month}.csv`); } catch (er) { toast.error(formatApiError(er)); }
    };
    const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
    const inp = "mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm bg-white";
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            {superadmin && <SetBalance people={people} />}
            <form onSubmit={add} className="bg-white border border-[#E5E7EB] p-4 text-sm" data-testid="hrm-adjust">
                <h2 className="font-serif text-xl text-[#002B5C]">Opening balances &amp; corrections</h2>
                <p className="text-xs text-[#6B7280] mt-1">When starting: add each person's EL carried in (+), and CL / SL already taken this year (−). Every entry is kept with its reason.</p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                    <label className="col-span-2">Person<select required value={f.emp_id} onChange={(e) => setF({ ...f, emp_id: e.target.value })} className={inp}>
                        <option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.emp_code ? ` (${p.emp_code})` : ""}</option>)}
                    </select></label>
                    <label>Leave<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={inp}>
                        <option value="EL">Earned</option><option value="CL">Casual</option><option value="SL">Sick</option><option value="OPT">Optional holiday</option>
                    </select></label>
                    <label>Days (+ / −)<input required type="number" step="0.5" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} className={inp} /></label>
                    <label>Leave year<input value={f.fy || thisFy} onChange={(e) => setF({ ...f, fy: e.target.value })} className={inp} /></label>
                    <label>Reason<input required minLength={5} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} placeholder="Opening balance from old records" /></label>
                </div>
                <button type="submit" className="mt-3 bg-[#002B5C] text-white px-4 py-2 text-sm">Save</button>
                {rows.length > 0 && (
                    <ul className="mt-3 text-xs divide-y divide-[#F3F4F6] max-h-48 overflow-y-auto">
                        {rows.map((a) => <li key={a.id} className="py-1">{names[a.emp_id] || "?"} · {a.type} {a.days > 0 ? "+" : ""}{a.days} · {a.fy} · {a.note} <span className="text-[#9CA3AF]">({a.by})</span></li>)}
                    </ul>
                )}
            </form>
            <section className="bg-white border border-[#E5E7EB] p-4 text-sm">
                <h2 className="font-serif text-xl text-[#002B5C]">RazorpayX Payroll</h2>
                <p className="text-xs text-[#6B7280] mt-1">Each month: loss-of-pay days per person (approved leave only) and who joined — to enter in RazorpayX before running payroll.</p>
                <div className="mt-3 flex items-end gap-2">
                    <label>Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inp} /></label>
                    <button type="button" onClick={exp} className="inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-3 py-2"><Download size={14} />Download CSV</button>
                </div>
            </section>
        </div>
    );
}
