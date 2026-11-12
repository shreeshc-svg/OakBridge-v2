import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CircleDot, Download, FileWarning, Gavel, HandCoins, LogOut, Plus, Send, Undo2, UserCheck } from "lucide-react";
import {
    sepMine, sepResign, sepWithdraw, sepManager, sepAccept, sepBoard, sepOpenCase, sepCaseStep, sepFnf, sepLetter,
    hrmPeople, saveBlob, formatApiError,
} from "../../lib/api";

/**
 * HRM → Exit (Nov 2026). Rules on the server (backend/hr_separation_core.py):
 *   resignation  employee -> reporting manager -> HR confirms the last day
 *                (30 days' notice; shortfall recorded) -> exit + F&F in 14 days
 *   termination  HR / Directors only, as a documented case: each ground needs
 *                its steps (PIP, show-cause + reply, absence notice …) before
 *                "Terminate" is allowed.
 * The employee sees only their own resignation and notices addressed to them.
 */
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—");
const err = (e) => toast.error(formatApiError(e));
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const inp = "mt-1 w-full border border-[#E5E7EB] px-3 py-2 text-sm bg-white";
const dl = async (id, name) => { try { saveBlob(await sepLetter(id), `${name}.pdf`); } catch (e) { err(e); } };

export default function ExitTab({ me }) {
    const lead = me.hr || me.manager;
    return (
        <div className="space-y-8" data-testid="hrm-exit">
            {me.me && <Mine />}
            {lead && <Board hr={me.hr} />}
        </div>
    );
}

/* ------------------------------------------------------------- employee --- */
function Mine() {
    const [d, setD] = useState(null);
    const load = useCallback(() => sepMine().then(setD).catch(err), []);
    useEffect(() => { load(); }, [load]);
    if (!d) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    return (
        <div className="space-y-5">
            {d.notices.map((n) => <Notice key={n.id} n={n} onChange={load} />)}
            {d.resignation ? <MyResignation r={d.resignation} onChange={load} /> : !d.exit_recorded && <Resign d={d} onDone={load} />}
        </div>
    );
}

function Resign({ d, onDone }) {
    const [open, setOpen] = useState(false);
    const [f, setF] = useState({ reason: "", last_day: d.default_last_day });
    const [busy, setBusy] = useState(false);
    const short = Math.max(0, d.notice_days - Math.round((new Date(`${f.last_day}T00:00:00`) - new Date(new Date().toDateString())) / 86400000));
    const go = async () => {
        if (!window.confirm(`Submit your resignation?\n\nProposed last day: ${fmt(f.last_day)}\nIt goes to ${d.manager_name || "HR"} first. You can withdraw it until HR accepts.`)) return;
        setBusy(true);
        try { await sepResign(f); toast.success("Submitted. We'll keep you posted by email."); onDone(); } catch (e) { err(e); } finally { setBusy(false); }
    };
    if (!open) {
        return (
            <section className="bg-white border border-[#E5E7EB] p-5 flex flex-wrap items-center gap-4">
                <LogOut className="text-[#6B7280]" />
                <div className="flex-1 min-w-[220px]"><div className="font-medium text-[#002B5C]">Thinking of moving on?</div>
                    <p className="text-sm text-[#6B7280]">We'd love to talk first — speak to {d.manager_name || "HR"} any time. If you've decided, you can start your resignation here.</p></div>
                <button type="button" onClick={() => setOpen(true)} className="border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm" data-testid="hrm-start-resign">Start resignation</button>
            </section>
        );
    }
    return (
        <section className="bg-white border border-[#E5E7EB] p-5 space-y-4" data-testid="hrm-resign-form">
            <h3 className="font-serif text-2xl text-[#002B5C]">Resignation</h3>
            <ol className="grid sm:grid-cols-4 gap-2 text-xs">
                {["You submit", `${d.manager_name || "HR"} reviews`, "HR confirms your last day", "Handover & Full and Final (14 days)"].map((s, i) => (
                    <li key={s} className="bg-[#F5F7FA] px-3 py-2"><b className="text-[#002B5C]">{i + 1}.</b> {s}</li>))}
            </ol>
            <label className="block text-sm">Reason <span className="text-[#6B7280]">(kept confidential with your manager and HR)</span>
                <textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={inp} maxLength={2000} /></label>
            <label className="block text-sm max-w-xs">Proposed last working day
                <input type="date" min={plus(0)} value={f.last_day} onChange={(e) => setF({ ...f, last_day: e.target.value })} className={inp} />
                <span className="text-xs text-[#6B7280]">{fmt(f.last_day)} · notice period is {d.notice_days} days{short ? ` — ${short} day(s) short; HR decides if that's waived` : " ✓"}</span></label>
            <div className="flex gap-2">
                <button type="button" disabled={busy || f.reason.trim().length < 10} onClick={go} className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-5 py-2 text-sm disabled:opacity-50"><Send size={14} />Submit resignation</button>
                <button type="button" onClick={() => setOpen(false)} className="text-sm underline">Not now</button>
            </div>
        </section>
    );
}

const RES_STEPS = [["manager", "Manager review"], ["hr", "HR confirms"], ["accepted", "Accepted"], ["fnf", "Full & Final"]];

function Timeline({ r }) {
    const idx = r.status === "withdrawn" ? -1 : r.status === "accepted" ? ((r.fnf || {}).status === "paid" ? 4 : 3) : r.status === "hr" ? 1 : 0;
    return (
        <ol className="grid grid-cols-4 gap-1 mt-4" aria-label="Progress">
            {RES_STEPS.map(([k, l], i) => (
                <li key={k} className="text-center">
                    <div className="h-1.5 transition-colors duration-700" style={{ background: i < idx ? "#F5B841" : i === idx ? "#FFFFFF" : "rgba(255,255,255,.2)" }} />
                    <div className={`mt-1.5 text-[11px] sm:text-xs ${i <= idx ? "text-white" : "text-white/50"}`}>{i < idx ? <Check size={11} className="inline mr-0.5 -mt-0.5" /> : null}{l}</div>
                </li>
            ))}
        </ol>
    );
}

function MyResignation({ r, onChange }) {
    const withdraw = async () => {
        if (!window.confirm("Withdraw your resignation? You'll continue as normal.")) return;
        try { await sepWithdraw(r.id); toast.success("Withdrawn — glad you're staying!"); onChange(); } catch (e) { err(e); }
    };
    return (
        <section className="bg-white border border-[#E5E7EB] overflow-hidden" data-testid="hrm-my-resignation">
            <div className="px-5 py-4 text-white" style={{ background: "linear-gradient(120deg,#002B5C 0%,#0B4A8B 60%,#1E6FB8 100%)" }}>
                <div className="text-white/70 text-xs">Submitted {fmt(r.submitted_at)}</div>
                <h3 className="font-serif text-2xl">Your resignation · {r.status_label}</h3>
                <Timeline r={r} />
            </div>
            <div className="p-5 space-y-3 text-sm">
                <div className="grid sm:grid-cols-3 gap-3">
                    <Fact label="You proposed" value={fmt(r.requested_last_day)} />
                    <Fact label="Final last day" value={r.last_day ? fmt(r.last_day) : "HR will confirm"} />
                    <Fact label="Full & Final" value={r.fnf ? (r.fnf.status === "paid" ? `Paid ${fmt(r.fnf.paid_on)}` : `By ${fmt(r.fnf.due)}`) : "After your last day"} />
                </div>
                {r.manager?.comment && <p className="text-[#4B5563]">{r.manager.name} reviewed it on {fmt(r.manager.at)}.</p>}
                <div className="flex flex-wrap gap-2">
                    {["manager", "hr"].includes(r.status) && <button type="button" onClick={withdraw} className="inline-flex items-center gap-1 border border-[#002B5C] text-[#002B5C] px-3 py-1.5"><Undo2 size={14} />Withdraw</button>}
                    {r.status === "accepted" && <button type="button" onClick={() => dl(r.id, "Acceptance of resignation")} className="inline-flex items-center gap-1 bg-[#002B5C] text-white px-3 py-1.5"><Download size={14} />Acceptance letter</button>}
                </div>
            </div>
        </section>
    );
}

function Fact({ label, value, tone }) {
    return <div className="bg-[#F5F7FA] px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-[#6B7280]">{label}</div><div className={`font-medium ${tone || "text-[#002B5C]"}`}>{value}</div></div>;
}

function Notice({ n, onChange }) {
    const [reply, setReply] = useState("");
    const send = async () => {
        if (!window.confirm("Send your reply to HR? You can only reply once.")) return;
        try { await sepCaseStep(n.id, "reply", { text: reply }); toast.success("Reply sent to HR."); onChange(); } catch (e) { err(e); }
    };
    return (
        <section className="bg-white border-2 border-[#F59E0B] p-5 space-y-3 text-sm" data-testid="hrm-notice">
            {n.status === "terminated" && (
                <div><h3 className="font-serif text-xl text-[#002B5C]">Your employment</h3>
                    <p className="mt-1">Your last working day is <b>{fmt(n.last_day)}</b> ({n.notice_label}). Full &amp; Final by {fmt(n.fnf?.due)}.</p>
                    <button type="button" onClick={() => dl(n.id, "Termination letter")} className="mt-2 inline-flex items-center gap-1 bg-[#002B5C] text-white px-3 py-1.5"><Download size={14} />Letter</button></div>
            )}
            {n.pip && (
                <div><h3 className="font-serif text-xl text-[#002B5C]">Performance improvement plan</h3>
                    <p className="text-[#6B7280]">{fmt(n.pip.start)} – {fmt(n.pip.end)}{n.pip.outcome ? ` · outcome: ${n.pip.outcome === "met" ? "met ✓" : "not met"}` : ""}</p>
                    <p className="mt-2 whitespace-pre-line border-l-4 border-[#F5B841] pl-3">{n.pip.expectations}</p>
                    <p className="text-xs text-[#6B7280] mt-2">Your manager and HR are here to help — ask for regular check-ins.</p></div>
            )}
            {n.show_cause && (
                <div><h3 className="font-serif text-xl text-[#002B5C] flex items-center gap-2"><FileWarning size={20} className="text-[#B4750F]" />Show-cause notice</h3>
                    <p className="text-[#6B7280]">Issued {fmt(n.show_cause.issued_on)} · reply by {fmt(n.show_cause.deadline)}</p>
                    <p className="mt-2 whitespace-pre-line border-l-4 border-[#F59E0B] pl-3">{n.show_cause.text}</p>
                    {n.show_cause.reply ? <p className="mt-3 bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-2"><b>Your reply</b> ({fmt(n.show_cause.reply_at)}): {n.show_cause.reply}</p> : n.status === "open" && (
                        <div className="mt-3"><textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} className={inp} placeholder="Give your side — it will be considered before any decision." maxLength={4000} />
                            <button type="button" disabled={reply.trim().length < 10} onClick={send} className="mt-2 bg-[#002B5C] text-white px-4 py-2 disabled:opacity-50">Send reply to HR</button></div>
                    )}</div>
            )}
        </section>
    );
}

/* ---------------------------------------------------------- HR / manager --- */
function Board({ hr }) {
    const [b, setB] = useState(null);
    const [opening, setOpening] = useState(false);
    const load = useCallback(() => sepBoard().then(setB).catch(err), []);
    useEffect(() => { load(); }, [load]);
    if (!b) return null;
    const waiting = b.resignations.filter((r) => r.status === (hr ? "hr" : "manager")).length;
    const overdue = b.fnf.filter((x) => x.fnf.due < b.today).length;
    return (
        <div className="space-y-5" data-testid="hrm-exit-board">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-serif text-2xl text-[#002B5C] flex-1">{hr ? "Exits & separations" : "Your team"}</h2>
                {hr && <button type="button" onClick={() => setOpening(!opening)} className="inline-flex items-center gap-1 border border-[#CC0033] text-[#CC0033] px-3 py-1.5 text-sm"><Gavel size={14} />Open a termination case</button>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi icon={UserCheck} label="Resignations waiting for you" value={waiting} hot={waiting > 0} />
                <Kpi icon={LogOut} label="Leaving soon" value={b.resignations.filter((r) => r.status === "accepted" && r.last_day >= b.today).length} />
                {hr && <Kpi icon={Gavel} label="Open cases" value={b.cases.filter((c) => c.status === "open").length} />}
                {hr && <Kpi icon={HandCoins} label="Full & Final pending" value={`${b.fnf.length}${overdue ? ` (${overdue} late)` : ""}`} hot={overdue > 0} />}
            </div>
            {opening && <OpenCase grounds={b.grounds} onDone={() => { setOpening(false); load(); }} />}
            {b.resignations.filter((r) => r.status !== "withdrawn").map((r) => <ResCard key={r.id} r={r} hr={hr} onChange={load} />)}
            {hr && b.cases.map((c) => <CaseCard key={c.id} c={c} b={b} onChange={load} />)}
            {hr && b.fnf.length > 0 && (
                <section className="bg-white border border-[#E5E7EB]" data-testid="hrm-fnf">
                    <h3 className="px-4 py-3 border-b border-[#F3F4F6] font-medium text-[#002B5C]">Full &amp; Final settlements (14 days after the last day)</h3>
                    <ul className="divide-y divide-[#F3F4F6]">{b.fnf.map((x) => (
                        <li key={x.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
                            <span className="flex-1"><b>{x.name}</b> · last day {fmt(x.last_day)}</span>
                            <span className={x.fnf.due < b.today ? "text-[#CC0033] font-medium" : "text-[#4B5563]"}>due {fmt(x.fnf.due)}{x.fnf.due < b.today ? " — overdue" : ""}</span>
                            <button type="button" onClick={async () => { if (!window.confirm(`Mark ${x.name}'s Full & Final as paid?`)) return; try { await sepFnf(x.id, {}); toast.success("Marked paid."); load(); } catch (e) { err(e); } }}
                                className="bg-[#0E9F6E] text-white px-3 py-1">Mark paid</button>
                        </li>))}</ul>
                </section>
            )}
            {!b.resignations.length && !b.cases.length && <p className="text-sm text-[#6B7280] bg-white border border-[#E5E7EB] p-5">Nothing here — everyone's staying. 🎉</p>}
        </div>
    );
}

function Kpi({ icon: I, label, value, hot = false }) {
    return (
        <div className={`bg-white border p-4 transition-shadow hover:shadow-md ${hot ? "border-[#F5B841]" : "border-[#E5E7EB]"}`}>
            <I size={18} className={hot ? "text-[#B4750F]" : "text-[#6B7280]"} />
            <div className="font-serif text-3xl text-[#002B5C] mt-1">{value}</div>
            <div className="text-xs text-[#6B7280]">{label}</div>
        </div>
    );
}

const PILL = { manager: ["With manager", "#DBEAFE", "#1E40AF"], hr: ["With HR", "#FEF3C7", "#92400E"], accepted: ["Accepted", "#D1FAE5", "#065F46"],
    open: ["Case open", "#FEE2E2", "#991B1B"], terminated: ["Terminated", "#E5E7EB", "#374151"], closed: ["Closed — no action", "#D1FAE5", "#065F46"] };
const Pill = ({ s }) => { const [l, bg, fg] = PILL[s] || [s, "#E5E7EB", "#374151"]; return <span className="text-xs px-2 py-0.5" style={{ background: bg, color: fg }}>{l}</span>; };

function ResCard({ r, hr, onChange }) {
    const [f, setF] = useState({ comment: "", suggested_last_day: "", last_day: r.manager?.suggested_last_day || r.requested_last_day, waive_shortfall: false, note: "" });
    const act = async (fn, ok) => { try { await fn(); toast.success(ok); onChange(); } catch (e) { err(e); } };
    return (
        <section className="bg-white border border-[#E5E7EB] p-4 space-y-3 text-sm" data-testid="hrm-res-card">
            <div className="flex flex-wrap items-center gap-2"><LogOut size={16} className="text-[#6B7280]" /><b className="text-[#002B5C]">{r.name}</b>
                <span className="text-[#6B7280]">{[r.designation, r.department].filter(Boolean).join(" · ")}</span><span className="ml-auto"><Pill s={r.status} /></span></div>
            <div className="grid sm:grid-cols-3 gap-2">
                <Fact label="Resigned on" value={fmt(r.submitted_at)} />
                <Fact label="Proposed last day" value={fmt(r.requested_last_day)} />
                <Fact label={r.last_day ? "Final last day" : "Notice"} value={r.last_day ? fmt(r.last_day) : `${r.notice_days} days`} />
            </div>
            <p className="border-l-4 border-[#E5E7EB] pl-3 text-[#374151]">“{r.reason}”</p>
            {r.manager?.comment && <p className="text-[#4B5563]"><b>{r.manager.name}:</b> {r.manager.comment}{r.manager.suggested_last_day ? ` · suggests ${fmt(r.manager.suggested_last_day)}` : ""}</p>}
            {r.status === "manager" && !hr && (
                <div className="bg-[#F8FAFC] p-3 space-y-2">
                    <div className="font-medium text-[#002B5C]">Your review</div>
                    <textarea rows={2} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} className={inp} placeholder="Did you talk it over? Handover plan? Anything HR should know." />
                    <label className="block max-w-xs">Suggest a different last day (optional)<input type="date" value={f.suggested_last_day} onChange={(e) => setF({ ...f, suggested_last_day: e.target.value })} className={inp} /></label>
                    <button type="button" disabled={f.comment.trim().length < 10} onClick={() => act(() => sepManager(r.id, { comment: f.comment, suggested_last_day: f.suggested_last_day || null }), "Forwarded to HR.")}
                        className="bg-[#002B5C] text-white px-4 py-2 disabled:opacity-50">Accept &amp; forward to HR</button>
                </div>
            )}
            {r.status === "hr" && hr && (
                <div className="bg-[#FFFBEB] border border-[#FDE68A] p-3 space-y-2">
                    <div className="font-medium text-[#002B5C]">Confirm the last working day</div>
                    <label className="block max-w-xs">Last working day<input type="date" value={f.last_day} onChange={(e) => setF({ ...f, last_day: e.target.value })} className={inp} /><span className="text-xs text-[#6B7280]">{fmt(f.last_day)}</span></label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={f.waive_shortfall} onChange={(e) => setF({ ...f, waive_shortfall: e.target.checked })} />Waive any notice shortfall (early release)</label>
                    <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} placeholder="Note (optional)" />
                    <button type="button" onClick={() => window.confirm(`Accept ${r.name}'s resignation with last day ${fmt(f.last_day)}? Their exit checklist starts and they're emailed.`)
                        && act(() => sepAccept(r.id, { last_day: f.last_day, waive_shortfall: f.waive_shortfall, note: f.note }), "Accepted.")}
                        className="bg-[#0E9F6E] text-white px-4 py-2 inline-flex items-center gap-1"><Check size={15} />Accept resignation</button>
                </div>
            )}
            {r.status === "accepted" && (
                <div className="flex flex-wrap items-center gap-3 text-[#4B5563]">
                    {r.shortfall_days ? <span>Notice short by {r.shortfall_days} day(s){r.hr_decision?.waive_shortfall ? " — waived" : " — settle in F&F"}</span> : <span>Full notice served</span>}
                    {hr && <button type="button" onClick={() => dl(r.id, `Acceptance - ${r.name}`)} className="inline-flex items-center gap-1 underline"><Download size={13} />Letter</button>}
                </div>
            )}
        </section>
    );
}

/* What each ground needs before "Terminate" unlocks — mirrors check_terminate. */
function needs(c, today) {
    const s = c.steps || {};
    const sc = s.show_cause;
    return {
        performance: [["PIP set (2+ weeks)", !!s.pip], ["PIP ended", !!s.pip && s.pip.end <= today], ["Outcome: not met", s.pip?.outcome === "not_met"]],
        misconduct: [["Show-cause notice issued", !!sc], ["Reply received or deadline passed", !!sc && (!!sc.reply || sc.deadline < today)]],
        absconding: [["Absence + return-to-work notice recorded", !!s.absence], ["Absent 7+ days", !!s.absence && (new Date(today) - new Date(s.absence.since)) / 86400000 >= 7]],
        probation: [["Not confirmed", !c.confirmed]],
        redundancy: [["Business reason written (20+ characters)", (c.note || "").trim().length >= 20]],
    }[c.ground] || [];
}

function CaseCard({ c, b, onChange }) {
    const [f, setF] = useState({ expectations: "", start: plus(0), end: plus(30), text: "", deadline: plus(3), since: "", notice_sent_on: plus(0), note: c.note || "", last_day: plus(0), notice: "served", outcome_note: "" });
    const [panel, setPanel] = useState("");
    const list = needs(c, b.today);
    const ready = c.status === "open" && list.every(([, ok]) => ok);
    const run = async (step, body, ok) => { try { await sepCaseStep(c.id, step, body); toast.success(ok); setPanel(""); onChange(); } catch (e) { err(e); } };
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    const sc = c.steps?.show_cause;
    return (
        <section className="bg-white border border-[#E5E7EB] p-4 space-y-3 text-sm" data-testid="hrm-case-card">
            <div className="flex flex-wrap items-center gap-2"><Gavel size={16} className="text-[#CC0033]" /><b className="text-[#002B5C]">{c.name}</b><span className="text-[#6B7280]">{c.ground_label}</span><span className="ml-auto"><Pill s={c.status} /></span></div>
            {c.status === "open" && (
                <ul className="grid sm:grid-cols-3 gap-2">{list.map(([l, ok]) => (
                    <li key={l} className={`flex items-center gap-1.5 px-3 py-2 ${ok ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#F5F7FA] text-[#4B5563]"}`}>{ok ? <Check size={14} /> : <CircleDot size={14} />}{l}</li>))}</ul>
            )}
            {c.steps?.pip && <p className="text-[#4B5563]"><b>PIP</b> {fmt(c.steps.pip.start)} – {fmt(c.steps.pip.end)}{c.steps.pip.outcome ? ` · ${c.steps.pip.outcome === "met" ? "met" : "not met"}` : ""}</p>}
            {sc && <p className="text-[#4B5563]"><b>Show-cause</b> issued {fmt(sc.issued_on)}, reply by {fmt(sc.deadline)}{sc.reply ? <> · <b>reply:</b> “{sc.reply}”</> : " · no reply yet"}</p>}
            {c.status === "terminated" && <p>Last day {fmt(c.last_day)} · F&amp;F by {fmt(c.fnf?.due)} <button type="button" onClick={() => dl(c.id, `Termination - ${c.name}`)} className="ml-2 underline inline-flex items-center gap-1"><Download size={13} />Letter</button></p>}
            {c.status === "open" && (
                <>
                    <div className="flex flex-wrap gap-2">
                        {c.ground === "performance" && !c.steps?.pip && <Btn on={() => setPanel("pip")}>Start a PIP</Btn>}
                        {c.ground === "performance" && c.steps?.pip && !c.steps.pip.outcome && c.steps.pip.end <= b.today && <Btn on={() => setPanel("outcome")}>Record PIP outcome</Btn>}
                        {c.ground === "misconduct" && <Btn on={() => setPanel("show")}>{sc ? "Issue another show-cause" : "Issue show-cause notice"}</Btn>}
                        {c.ground === "absconding" && <Btn on={() => setPanel("absence")}>Record absence</Btn>}
                        {c.ground === "redundancy" && <Btn on={() => setPanel("note")}>Business reason</Btn>}
                        <Btn on={() => setPanel("close")}>Close — no action</Btn>
                        <button type="button" disabled={!ready} onClick={() => setPanel("terminate")} title={ready ? "" : "Complete the steps above first"}
                            className="inline-flex items-center gap-1 bg-[#CC0033] text-white px-3 py-1.5 disabled:opacity-40"><AlertTriangle size={14} />Terminate</button>
                    </div>
                    {panel === "pip" && <Panel go={() => run("pip", f, "PIP started — employee emailed.")} label="Start PIP">
                        <textarea rows={3} value={f.expectations} onChange={set("expectations")} className={inp} placeholder="What must improve, measurably (the employee sees this)" />
                        <div className="grid grid-cols-2 gap-2"><label>From<input type="date" value={f.start} onChange={set("start")} className={inp} /></label><label>To (2+ weeks)<input type="date" value={f.end} onChange={set("end")} className={inp} /></label></div></Panel>}
                    {panel === "outcome" && <Panel go={null} label="">
                        <input value={f.outcome_note} onChange={set("outcome_note")} className={inp} placeholder="Note on the outcome" />
                        <div className="flex gap-2"><Btn on={() => run("pip-outcome", { outcome: "met", note: f.outcome_note }, "Recorded: met.")}>Met ✓</Btn><Btn on={() => run("pip-outcome", { outcome: "not_met", note: f.outcome_note }, "Recorded: not met.")}>Not met</Btn></div></Panel>}
                    {panel === "show" && <Panel go={() => run("show-cause", { text: f.text, deadline: f.deadline }, "Issued — employee emailed.")} label="Issue notice">
                        <textarea rows={4} value={f.text} onChange={set("text")} className={inp} placeholder="Facts: what happened, when, and the question 'why should action not be taken?'" />
                        <label className="block max-w-xs">Reply by (2+ days)<input type="date" value={f.deadline} onChange={set("deadline")} className={inp} /></label></Panel>}
                    {panel === "absence" && <Panel go={() => run("absence", { since: f.since, notice_sent_on: f.notice_sent_on, note: f.note }, "Recorded.")} label="Save">
                        <div className="grid grid-cols-2 gap-2"><label>Absent since<input type="date" value={f.since} onChange={set("since")} className={inp} /></label><label>Return-to-work notice sent on<input type="date" value={f.notice_sent_on} onChange={set("notice_sent_on")} className={inp} /></label></div>
                        <input value={f.note} onChange={set("note")} className={inp} placeholder="How it was sent (email / courier / WhatsApp)" /></Panel>}
                    {panel === "note" && <Panel go={() => run("note", { note: f.note }, "Saved.")} label="Save"><textarea rows={3} value={f.note} onChange={set("note")} className={inp} placeholder="Why the role is closing" /></Panel>}
                    {panel === "close" && <Panel go={() => run("close", { note: f.note }, "Case closed.")} label="Close case"><input value={f.note} onChange={set("note")} className={inp} placeholder="Why (e.g. PIP met, reply accepted)" /></Panel>}
                    {panel === "terminate" && <Panel danger go={() => window.confirm(`Terminate ${c.name}? Their exit starts, they're emailed and get a letter. This can't be undone here.`)
                        && run("terminate", { last_day: f.last_day, notice: f.notice, note: f.note }, "Terminated.")} label="Terminate">
                        <div className="grid sm:grid-cols-2 gap-2"><label>Last working day<input type="date" value={f.last_day} onChange={set("last_day")} className={inp} /></label>
                            <label>Notice<select value={f.notice} onChange={set("notice")} className={inp}>{Object.entries(b.notice_modes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
                        <textarea rows={3} value={f.note} onChange={set("note")} className={inp} placeholder="The decision and why (kept on record)" /></Panel>}
                </>
            )}
        </section>
    );
}

const Btn = ({ on, children }) => <button type="button" onClick={on} className="border border-[#002B5C] text-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA]">{children}</button>;

function Panel({ go, label, children, danger = false }) {
    return (
        <div className={`p-3 space-y-2 ${danger ? "bg-[#FEF2F2] border border-[#FECACA]" : "bg-[#F8FAFC] border border-[#E5E7EB]"}`}>
            {children}
            {go && <button type="button" onClick={go} className={`${danger ? "bg-[#CC0033]" : "bg-[#002B5C]"} text-white px-4 py-2`}>{label}</button>}
        </div>
    );
}

function OpenCase({ grounds, onDone }) {
    const [people, setPeople] = useState([]);
    const [f, setF] = useState({ emp_id: "", ground: "performance", note: "" });
    useEffect(() => { hrmPeople().then(setPeople).catch(() => {}); }, []);
    const HELP = { performance: "Start with a 2+ week PIP. Terminate only if it isn't met.", misconduct: "Issue a show-cause notice and consider the reply first.",
        absconding: "7+ days absent without informing anyone, and a return-to-work notice sent.", probation: "Only before confirmation.", redundancy: "Write the business reason; notice or pay in lieu." };
    const go = async () => { try { await sepOpenCase(f); toast.success("Case opened — only HR can see it."); onDone(); } catch (e) { err(e); } };
    return (
        <section className="bg-white border-2 border-[#FECACA] p-4 space-y-3 text-sm" data-testid="hrm-open-case">
            <h3 className="font-medium text-[#991B1B] flex items-center gap-2"><Gavel size={16} />Open a termination case</h3>
            <p className="text-xs text-[#6B7280]">A documented process, not a one-click action. The employee only sees notices addressed to them (PIP, show-cause) and the outcome. Please have letters reviewed by your CA / lawyer.</p>
            <div className="grid sm:grid-cols-2 gap-2">
                <label>Employee<select value={f.emp_id} onChange={(e) => setF({ ...f, emp_id: e.target.value })} className={inp}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label>Ground<select value={f.ground} onChange={(e) => setF({ ...f, ground: e.target.value })} className={inp}>{Object.entries(grounds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            </div>
            <p className="bg-[#F5F7FA] px-3 py-2 text-[#374151]">{HELP[f.ground]}</p>
            <textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} placeholder="Background (HR only)" />
            <button type="button" disabled={!f.emp_id} onClick={go} className="inline-flex items-center gap-1 bg-[#002B5C] text-white px-4 py-2 disabled:opacity-50"><Plus size={14} />Open case</button>
        </section>
    );
}
