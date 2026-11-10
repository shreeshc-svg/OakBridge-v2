import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Award, Bell, Check, Download, Lock, Lightbulb, PartyPopper, Send, ShieldCheck, Undo2, UserPlus } from "lucide-react";
import {
    appraisalCycle, appraisalStart, appraisalRemind, appraisalAdd, appraisalMine, appraisalTeam, appraisalGet,
    appraisalSaveSelf, appraisalSaveManager, appraisalSaveHr, appraisalRelease, appraisalReopen, appraisalAck, appraisalLetter,
    hrmPeople, formatApiError,
} from "../../lib/api";

/**
 * HRM → Appraisal (Nov 2026). Rules live on the server
 * (backend/hr_appraisal_core.py, hrm_appraisal.py):
 *   1 the employee rates themselves on 5 skills + 3 short questions
 *   2 the reporting manager rates the same skills, gives an overall rating and
 *     PROPOSES an increment % (and maybe a promotion) — managers never see pay
 *   3 HR / founders may adjust (with a reason), enter the current CTC and approve
 *   4 the employee sees the result, downloads the letter, acknowledges it.
 *
 * Written for people who don't use software all day: words instead of numbers
 * on every rating, one clear button per step, a warning before anything locks,
 * and the stepper always says whose turn it is. What a person can DO comes
 * from the server (`a.can`) — hiding a button here is never the control.
 */
const GOLD = "#F5B841";
const TONE = { 1: "#CC0033", 2: "#D97706", 3: "#0B4A8B", 4: "#0E9F6E", 5: "#7C3AED" };
const fmt = (d) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—");
const inr = (n) => (n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
// Same rule as the server (hr_appraisal_core.revised_ctc): nearest rupee,
// half up — done in whole numbers so the preview never differs by ₹1.
const revised = (cur, pct) => {
    const c = Math.round(Number(cur)); const p10 = Math.round(Number(pct) * 10);
    if (!(c > 0) || Number.isNaN(p10)) return null;
    return Math.floor((c * (1000 + p10) + 500) / 1000);
};
const cleanCtc = (s) => String(s || "").replace(/[,\s₹]|rs\.?/gi, "");
const shiftFy = (fy, by) => { const y = Number(fy.slice(0, 4)) + by; return `${y}-${String(y + 1).slice(-2)}`; };
const err = (e) => toast.error(formatApiError(e));

export default function AppraisalTab({ me }) {
    const [fy, setFy] = useState(null);
    const [meta, setMeta] = useState(null);
    const [open, setOpen] = useState(null);           // appraisal id from the team list
    const [tick, setTick] = useState(0);
    const lead = me.hr || me.manager;
    useEffect(() => { setMeta(null); appraisalCycle(fy).then((m) => { setMeta(m); if (!fy) setFy(m.fy); }).catch(err); }, [fy, tick]);
    if (!meta) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    return (
        <div className="space-y-5" data-testid="hrm-appraisal">
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setOpen(null); setFy(shiftFy(meta.fy, -1)); }} className="border border-[#E5E7EB] bg-white px-2 py-1" aria-label="Previous year">‹</button>
                <h2 className="font-serif text-2xl text-[#002B5C]">Appraisal · FY {meta.fy}</h2>
                <button type="button" onClick={() => { setOpen(null); setFy(shiftFy(meta.fy, 1)); }} className="border border-[#E5E7EB] bg-white px-2 py-1" aria-label="Next year">›</button>
            </div>
            {!meta.cycle ? (
                me.hr ? <StartCycle meta={meta} onStarted={() => setTick(tick + 1)} />
                    : <Empty text={`The ${meta.fy} appraisal hasn't started yet. HR will email you when it does.`} />
            ) : open ? (
                <div>
                    <button type="button" onClick={() => setOpen(null)} className="inline-flex items-center gap-1 text-sm underline mb-3"><ArrowLeft size={14} />Back to the list</button>
                    <ById id={open} meta={meta} />
                </div>
            ) : (
                <>
                    {me.hr && <HrBar meta={meta} onChanged={() => setTick(tick + 1)} />}
                    {me.me && <Mine fy={meta.fy} meta={meta} />}
                    {lead && <Team fy={meta.fy} hr={me.hr} onOpen={setOpen} />}
                </>
            )}
        </div>
    );
}

function Empty({ text }) {
    return <div className="bg-white border border-[#E5E7EB] p-6 text-center text-sm text-[#4B5563]"><Award className="mx-auto mb-2 text-[#9CA3AF]" />{text}</div>;
}

/* ------------------------------------------------------------- HR setup --- */
function StartCycle({ meta, onStarted }) {
    const [selfDue, setSelfDue] = useState("");
    const [mgrDue, setMgrDue] = useState("");
    const [busy, setBusy] = useState(false);
    const bad = selfDue && mgrDue && mgrDue < selfDue;
    const go = async () => {
        if (!window.confirm(`Start the ${meta.fy} appraisal now? Every confirmed employee gets an email asking for their self-review.`)) return;
        setBusy(true);
        try { const r = await appraisalStart({ fy: meta.fy, self_due: selfDue, manager_due: mgrDue }); toast.success(`Started for ${r.people} people.`); onStarted(); }
        catch (e) { err(e); } finally { setBusy(false); }
    };
    return (
        <section className="bg-white border border-[#E5E7EB] p-5 space-y-4" data-testid="hrm-appraisal-start">
            <h3 className="font-serif text-xl text-[#002B5C]">Start the {meta.fy} appraisal</h3>
            <ol className="text-sm text-[#4B5563] list-decimal pl-5 space-y-1">
                <li>Everyone confirmed gets an email and fills in a short self-review.</li>
                <li>Each reporting manager then reviews their people and proposes an increment %.</li>
                <li>You check, adjust if needed, add the CTC and approve. Only then does the employee see the result.</li>
            </ol>
            <div className="grid sm:grid-cols-2 gap-4">
                <DateBox label="Self-reviews due by" value={selfDue} onChange={setSelfDue} />
                <DateBox label="Manager reviews due by" value={mgrDue} onChange={setMgrDue} error={bad ? "Must be after the self-review date." : ""} />
            </div>
            {!meta.ctc_ready && <KeyWarning />}
            <button type="button" disabled={busy || !selfDue || !mgrDue || bad} onClick={go} className="bg-[#002B5C] text-white px-5 py-2 text-sm disabled:opacity-50">{busy ? "Starting…" : "Start appraisal"}</button>
        </section>
    );
}

function DateBox({ label, value, onChange, error = "" }) {
    return (
        <label className="block text-sm">
            <span className="text-[#374151]">{label}</span>
            <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5" />
            <span className={`block text-xs mt-1 ${error ? "text-[#CC0033]" : "text-[#6B7280]"}`}>{error || (value ? fmt(value) : "Pick a date")}</span>
        </label>
    );
}

function KeyWarning() {
    return (
        <p className="text-sm border border-[#E7B64B] bg-[#FFFBEB] px-3 py-2 flex gap-2"><Lock size={16} className="shrink-0 mt-0.5" />
            Salaries can't be entered yet: the encryption key (HRM_DATA_KEY) isn't set on the server. Everything else works — add the key in Render before HR approval.</p>
    );
}

function HrBar({ meta, onChanged }) {
    const [adding, setAdding] = useState(false);
    const p = meta.progress || {};
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    const remind = async () => {
        if (!window.confirm("Email everyone who still has a self-review or manager review to do?")) return;
        try { const r = await appraisalRemind(meta.fy); toast.success(`Reminded ${r.sent}.`); } catch (e) { err(e); }
    };
    return (
        <section className="bg-white border border-[#E5E7EB] p-4 space-y-3" data-testid="hrm-appraisal-progress">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-[#002B5C] flex-1">Progress · {total} people · self-reviews due {fmt(meta.cycle.self_due)}, managers by {fmt(meta.cycle.manager_due)}</h3>
                <button type="button" onClick={remind} className="inline-flex items-center gap-1 border border-[#002B5C] text-[#002B5C] px-3 py-1.5 text-sm"><Bell size={14} />Send reminders</button>
                <button type="button" onClick={() => setAdding(!adding)} className="inline-flex items-center gap-1 border border-[#E5E7EB] px-3 py-1.5 text-sm"><UserPlus size={14} />Add someone</button>
            </div>
            <div className="flex h-3 overflow-hidden bg-[#F3F4F6]" aria-hidden="true">
                {["released", "hr", "manager", "self"].map((s, i) => <div key={s} style={{ width: `${total ? (100 * (p[s] || 0)) / total : 0}%`, background: ["#0E9F6E", GOLD, "#1E6FB8", "#CBD5E1"][i] }} />)}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-[#4B5563]">
                {[["self", "Self-review", "#CBD5E1"], ["manager", "With manager", "#1E6FB8"], ["hr", "Waiting for HR approval", GOLD], ["released", "Done", "#0E9F6E"]].map(([k, l, c]) => (
                    <span key={k} className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 inline-block" style={{ background: c }} />{l}: <b>{p[k] || 0}</b></span>
                ))}
            </div>
            {!meta.ctc_ready && <KeyWarning />}
            {adding && <AddPerson fy={meta.fy} onDone={() => { setAdding(false); onChanged(); }} />}
        </section>
    );
}

function AddPerson({ fy, onDone }) {
    const [people, setPeople] = useState(null);
    const [pick, setPick] = useState("");
    useEffect(() => { hrmPeople().then(setPeople).catch(err); }, []);
    const add = async () => { try { await appraisalAdd(fy, pick); toast.success("Added — they've been included."); onDone(); } catch (e) { err(e); } };
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm border-t border-[#F3F4F6] pt-3">
            <span className="text-[#4B5563]">For people who joined or were confirmed after the start:</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="border border-[#E5E7EB] px-2 py-1.5" aria-label="Person">
                <option value="">Choose…</option>
                {(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.emp_code ? ` (${p.emp_code})` : ""}</option>)}
            </select>
            <button type="button" disabled={!pick} onClick={add} className="bg-[#002B5C] text-white px-3 py-1.5 disabled:opacity-50">Add</button>
        </div>
    );
}

/* ------------------------------------------------------------- the lists --- */
function Mine({ fy, meta }) {
    const [d, setD] = useState(undefined);
    const load = useCallback(() => appraisalMine(fy).then((r) => setD(r.appraisal)).catch((e) => { setD(null); err(e); }), [fy]);
    useEffect(() => { load(); }, [load]);
    if (d === undefined) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    if (!d) return <Empty text="You're not part of this year's appraisal — usually because you were still on probation when it started. Ask HR if that's wrong." />;
    return <Appraisal a={d} meta={meta} onChange={setD} reload={load} />;
}

function ById({ id, meta }) {
    const [d, setD] = useState(null);
    const load = useCallback(() => appraisalGet(id).then(setD).catch(err), [id]);
    useEffect(() => { load(); }, [load]);
    if (!d) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    return <Appraisal a={d} meta={meta} onChange={setD} reload={load} />;
}

const STAGE_PILL = { self: ["Self-review", "#E5E7EB", "#374151"], manager: ["Manager review", "#DBEAFE", "#1E40AF"], hr: ["HR approval", "#FEF3C7", "#92400E"], released: ["Done", "#D1FAE5", "#065F46"] };

function Team({ fy, hr, onOpen }) {
    const [rows, setRows] = useState(null);
    useEffect(() => { appraisalTeam(fy).then((r) => setRows(r.rows)).catch((e) => { setRows([]); err(e); }); }, [fy]);
    if (!rows) return null;
    const mine = rows.filter((r) => r.my_turn).length;
    return (
        <section className="bg-white border border-[#E5E7EB]" data-testid="hrm-appraisal-team">
            <div className="px-4 py-3 border-b border-[#F3F4F6] flex items-center gap-2">
                <h3 className="font-medium text-[#002B5C] flex-1">{hr ? "Everyone" : "Your team"}</h3>
                {mine > 0 && <span className="text-xs bg-[#F5B841] text-[#002B5C] px-2 py-0.5 font-medium">{mine} waiting for you</span>}
            </div>
            {!rows.length ? <p className="p-4 text-sm text-[#6B7280]">Nobody here yet.</p> : (
                <ul className="divide-y divide-[#F3F4F6]">
                    {rows.map((r) => {
                        const [l, bg, fg] = STAGE_PILL[r.stage];
                        return (
                            <li key={r.id}>
                                <button type="button" onClick={() => onOpen(r.id)} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-[#F9FAFB]">
                                    <span className="flex-1 min-w-[160px]">
                                        <span className="font-medium text-[#002B5C]">{r.name}</span>
                                        <span className="block text-xs text-[#6B7280]">{[r.emp_code, r.department].filter(Boolean).join(" · ")}</span>
                                    </span>
                                    {r.overall != null && <span className="text-xs text-[#4B5563]">{r.overall}/5 · {r.increment_pct}%</span>}
                                    {r.disagreed && <span className="text-xs text-[#CC0033]">disagrees</span>}
                                    {r.stage === "released" && !r.acknowledged && <span className="text-xs text-[#6B7280]">not yet acknowledged</span>}
                                    <span className="text-xs px-2 py-0.5" style={{ background: bg, color: fg }}>{l}</span>
                                    {r.my_turn && <span className="text-xs bg-[#002B5C] text-white px-2 py-0.5">Your turn →</span>}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

/* -------------------------------------------------------- one appraisal --- */
function Appraisal({ a, meta, onChange, reload }) {
    const owner = a.role === "owner";
    return (
        <section className="bg-white border border-[#E5E7EB] overflow-hidden" data-testid="hrm-appraisal-card">
            <div className="px-5 py-4 text-white" style={{ background: "linear-gradient(120deg,#002B5C 0%,#0B4A8B 60%,#1E6FB8 100%)" }}>
                <div className="text-white/70 text-xs">FY {a.fy} appraisal</div>
                <h3 className="font-serif text-2xl">{owner ? "Your appraisal" : a.name}</h3>
                <div className="text-xs text-white/80 mt-0.5">{[a.designation, a.department, a.emp_code && `Emp ID ${a.emp_code}`].filter(Boolean).join(" · ")}{!owner ? "" : ` · reviewed by ${a.manager_name}`}</div>
                <Stepper stage={a.stage} owner={owner} />
            </div>
            <div className="p-5 space-y-6">
                {a.reopen_note && a.stage !== "released" && <p className="text-sm border border-[#E7B64B] bg-[#FFFBEB] px-3 py-2">Sent back by HR: {a.reopen_note}</p>}
                {owner && a.stage === "released" && <Result a={a} meta={meta} onChange={onChange} />}
                {a.can.self ? <SelfForm a={a} meta={meta} onSaved={onChange} />
                    : a.self && <SelfView a={a} meta={meta} owner={owner} />}
                {owner && ["manager", "hr"].includes(a.stage) && <Waiting stage={a.stage} who={a.manager_name} />}
                {a.goals && <Goals g={a.goals} />}
                {a.can.manager ? <ManagerForm a={a} meta={meta} onSaved={onChange} />
                    : !owner && a.manager && a.stage !== "self" && <ManagerView a={a} meta={meta} />}
                {!owner && a.stage === "manager" && !a.can.manager && <Waiting stage="manager" who={a.manager_name} />}
                {!owner && a.stage === "self" && <p className="text-sm bg-[#F5F7FA] border border-[#E5E7EB] px-3 py-2.5">Waiting for {a.name.split(" ")[0]} to submit their self-review{a.self_due ? ` (due ${fmt(a.self_due)})` : ""}. You'll get an email when it's your turn.</p>}
                {a.role === "hr" && a.stage === "hr" && <HrPanel a={a} meta={meta} onSaved={onChange} reload={reload} />}
                {a.role === "hr" && a.can.reopen && a.stage !== "hr" && <SendBack a={a} onDone={onChange} />}
                {!owner && a.stage === "released" && <Outcome a={a} />}
            </div>
        </section>
    );
}

function Stepper({ stage, owner }) {
    const idx = ["self", "manager", "hr", "released"].indexOf(stage);
    const labels = owner ? ["Your self-review", "Manager review", "HR approval", "Your result"] : ["Self-review", "Manager review", "HR approval", "Shared"];
    return (
        <ol className="mt-4 grid grid-cols-4 gap-1" aria-label="Progress">
            {labels.map((l, i) => {
                const done = i < idx || stage === "released";
                const now = i === idx && stage !== "released";
                return (
                    <li key={l} className="text-center" aria-current={now ? "step" : undefined}>
                        <div className="h-1.5" style={{ background: done ? GOLD : now ? "#FFFFFF" : "rgba(255,255,255,.2)" }} />
                        <div className={`mt-1.5 text-[11px] sm:text-xs ${now ? "text-white font-medium" : done ? "text-white/90" : "text-white/50"}`}>
                            {done ? <Check size={11} className="inline mr-0.5 -mt-0.5" /> : `${i + 1}. `}{l}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

function Waiting({ stage, who }) {
    return (
        <p className="text-sm bg-[#F5F7FA] border border-[#E5E7EB] px-3 py-2.5 flex gap-2"><Lock size={15} className="shrink-0 mt-0.5 text-[#6B7280]" />
            {stage === "manager" ? `Waiting for ${who} to write the manager review.` : "With HR for final approval."} You'll get an email when the result is ready — nothing else to do for now.</p>
    );
}

/* Rating picker: words, not numbers. */
function Chips({ value, onChange, scale, name, compare }) {
    return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={name}>
            {[1, 2, 3, 4, 5].map((n) => {
                const on = Number(value) === n;
                return (
                    <button key={n} type="button" role="radio" aria-checked={on} onClick={() => onChange(n)}
                        className="px-2.5 py-1.5 text-xs border transition-colors"
                        style={on ? { background: TONE[n], borderColor: TONE[n], color: "#fff" } : { borderColor: compare === n ? TONE[n] : "#E5E7EB", color: "#374151", background: "#fff" }}>
                        {scale[n]}{compare === n && !on ? " ·" : ""}
                    </button>
                );
            })}
        </div>
    );
}

function Tag({ n, scale }) {
    if (!n) return <span className="text-xs text-[#9CA3AF]">not rated</span>;
    return <span className="text-xs px-2 py-0.5 text-white" style={{ background: TONE[n] }}>{scale[n]}</span>;
}

/* ------------------------------------------------------------ self part --- */
function SelfForm({ a, meta, onSaved }) {
    const [f, setF] = useState({ skills: { ...(a.self?.skills || {}) }, achievements: a.self?.achievements || "", challenges: a.self?.challenges || "", support: a.self?.support || "" });
    const [busy, setBusy] = useState(false);
    const rated = meta.skills.filter((s) => f.skills[s.key]).length;
    const ready = rated === meta.skills.length && f.achievements.trim().length >= 10;
    const save = async (submit) => {
        if (submit && !window.confirm(`Submit your self-review to ${a.manager_name}?\n\nAfter this you can't change it.`)) return;
        setBusy(true);
        try { onSaved(await appraisalSaveSelf(a.id, { ...f, submit })); toast.success(submit ? "Submitted — thank you!" : "Saved. You can come back and finish later."); }
        catch (e) { err(e); } finally { setBusy(false); }
    };
    return (
        <div className="space-y-5" data-testid="hrm-appraisal-self">
            <Hint>Be honest — this is your chance to tell your side. Takes about 10 minutes, and you can <b>save and finish later</b>. {a.self_due && <>Please submit by <b>{fmt(a.self_due)}</b>.</>}</Hint>
            <div>
                <h4 className="font-medium text-[#002B5C]">How did you do this year? <span className="text-xs text-[#6B7280] font-normal">({rated} of {meta.skills.length} done)</span></h4>
                <div className="mt-3 space-y-3">
                    {meta.skills.map((s) => (
                        <div key={s.key} className="border border-[#F3F4F6] p-3">
                            <div className="text-sm font-medium text-[#111827]">{s.label}</div>
                            <div className="text-xs text-[#6B7280] mb-2">{s.hint}</div>
                            <Chips value={f.skills[s.key]} scale={meta.scale} name={s.label} onChange={(n) => setF({ ...f, skills: { ...f.skills, [s.key]: n } })} />
                        </div>
                    ))}
                </div>
            </div>
            {meta.questions.map((q, i) => (
                <label key={q.key} className="block">
                    <span className="text-sm font-medium text-[#111827]">{q.label}{i === 0 ? <span className="text-[#CC0033]"> *</span> : <span className="text-xs text-[#6B7280] font-normal"> (optional)</span>}</span>
                    <textarea rows={3} value={f[q.key]} onChange={(e) => setF({ ...f, [q.key]: e.target.value })} className="mt-1 w-full border border-[#E5E7EB] px-3 py-2 text-sm" maxLength={2000} />
                </label>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-[#F3F4F6] pt-4">
                <button type="button" disabled={busy} onClick={() => save(false)} className="border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm disabled:opacity-50">Save draft</button>
                <button type="button" disabled={busy || !ready} onClick={() => save(true)} className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-5 py-2 text-sm disabled:opacity-50"><Send size={14} />Submit to my manager</button>
                {!ready && <span className="text-xs text-[#6B7280]">To submit: rate all {meta.skills.length} and answer the first question.</span>}
            </div>
        </div>
    );
}

function SelfView({ a, meta, owner }) {
    const s = a.self || {};
    return (
        <div className="space-y-3">
            <h4 className="font-medium text-[#002B5C]">{owner ? "Your self-review" : `${a.name.split(" ")[0]}'s self-review`} {a.self_submitted_at && <span className="text-xs text-[#6B7280] font-normal">submitted {fmt(a.self_submitted_at)}</span>}</h4>
            <ul className="grid sm:grid-cols-2 gap-2">{meta.skills.map((k) => <li key={k.key} className="flex items-center justify-between gap-2 border border-[#F3F4F6] px-3 py-2 text-sm">{k.label}<Tag n={s.skills?.[k.key]} scale={meta.scale} /></li>)}</ul>
            {meta.questions.map((q) => s[q.key] ? <div key={q.key}><div className="text-xs text-[#6B7280]">{q.label}</div><p className="text-sm whitespace-pre-line">{s[q.key]}</p></div> : null)}
        </div>
    );
}

function Goals({ g }) {
    return (
        <div className="border border-[#F3F4F6] p-3">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-[#002B5C] flex-1">This year's goals ({g.count})</span>
                {g.overall != null && <span className="text-sm">Progress <b>{g.overall}%</b></span>}
                {g.rating != null && <span className="text-xs text-[#4B5563]">Goals rating {g.rating}/5</span>}</div>
            <ul className="mt-1 text-xs text-[#4B5563] list-disc pl-5">{g.items.map((x) => <li key={x.title}>{x.title} <span className="text-[#9CA3AF]">· {x.weight}%</span></li>)}</ul>
        </div>
    );
}

/* --------------------------------------------------------- manager part --- */
function ManagerForm({ a, meta, onSaved }) {
    const m = a.manager || {};
    const [f, setF] = useState({
        skills: Object.fromEntries(meta.skills.map((s) => [s.key, { rating: m.skills?.[s.key]?.rating || null, comment: m.skills?.[s.key]?.comment || "" }])),
        overall: m.overall || null, increment_pct: m.increment_pct ?? "", designation: m.designation || "", summary: m.summary || "",
    });
    const [promo, setPromo] = useState(!!m.designation);
    const [busy, setBusy] = useState(false);
    const pctOk = f.increment_pct !== "" && Number(f.increment_pct) >= 0 && Number(f.increment_pct) <= 100 && Number.isInteger(Number(f.increment_pct) * 2);
    const ready = meta.skills.every((s) => f.skills[s.key].rating) && f.overall && pctOk && f.summary.trim().length >= 20 && (!promo || f.designation.trim());
    const setSkill = (k, part) => setF({ ...f, skills: { ...f.skills, [k]: { ...f.skills[k], ...part } } });
    const save = async (submit) => {
        if (submit && !window.confirm("Send your review to HR for approval?\n\nAfter this you can't change it. The employee will see your ratings and summary once HR approves.")) return;
        setBusy(true);
        try {
            onSaved(await appraisalSaveManager(a.id, { ...f, designation: promo ? f.designation : "", increment_pct: f.increment_pct === "" ? null : Number(f.increment_pct), submit }));
            toast.success(submit ? "Sent to HR." : "Saved.");
        } catch (e) { err(e); } finally { setBusy(false); }
    };
    const sk = a.self?.skills || {};
    return (
        <div className="space-y-5" data-testid="hrm-appraisal-manager">
            <h4 className="font-medium text-[#002B5C] text-lg">Your review of {a.name.split(" ")[0]}</h4>
            <Hint>{a.name.split(" ")[0]}'s own rating is outlined on each line so you can compare. Your ratings and summary are <b>shared with them after HR approves</b> — write as you'd say it to them. {a.manager_due && <>Due by <b>{fmt(a.manager_due)}</b>.</>}</Hint>
            {meta.skills.map((s) => (
                <div key={s.key} className="border border-[#F3F4F6] p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium flex-1">{s.label}</span><span className="text-xs text-[#6B7280]">They said:</span><Tag n={sk[s.key]} scale={meta.scale} /></div>
                    <Chips value={f.skills[s.key].rating} compare={sk[s.key]} scale={meta.scale} name={s.label} onChange={(n) => setSkill(s.key, { rating: n })} />
                    <input value={f.skills[s.key].comment} onChange={(e) => setSkill(s.key, { comment: e.target.value })} placeholder="A short example or comment (optional)" className="w-full border border-[#E5E7EB] px-2 py-1.5 text-sm" maxLength={600} />
                </div>
            ))}
            <div className="border-2 border-[#002B5C]/10 p-4 space-y-4 bg-[#F8FAFC]">
                <div><div className="text-sm font-medium mb-2">Overall rating for the year <span className="text-[#CC0033]">*</span></div>
                    <Chips value={f.overall} scale={meta.scale} name="Overall rating" onChange={(n) => setF({ ...f, overall: n })} /></div>
                <label className="block max-w-xs">
                    <span className="text-sm font-medium">Proposed increment <span className="text-[#CC0033]">*</span></span>
                    <span className="mt-1 flex items-center gap-1"><input type="number" min={0} max={100} step={0.5} inputMode="decimal" value={f.increment_pct} onChange={(e) => setF({ ...f, increment_pct: e.target.value })} className="w-28 border border-[#E5E7EB] px-2 py-1.5" aria-label="Increment percent" />%</span>
                    <span className={`block text-xs mt-1 ${f.increment_pct !== "" && !pctOk ? "text-[#CC0033]" : "text-[#6B7280]"}`}>{f.increment_pct !== "" && !pctOk ? "Use a whole or half number between 0 and 100, e.g. 8 or 8.5." : "Enter 0 for no increment. You don't need to know the salary — HR applies this %."}</span>
                </label>
                <div>
                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} />Recommend a promotion</label>
                    {promo && <input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} placeholder="New designation, e.g. Senior Editor" className="mt-2 w-full max-w-sm border border-[#E5E7EB] px-2 py-1.5 text-sm block" maxLength={120} aria-label="New designation" />}
                </div>
                <label className="block"><span className="text-sm font-medium">Summary for {a.name.split(" ")[0]} <span className="text-[#CC0033]">*</span></span>
                    <textarea rows={4} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className="mt-1 w-full border border-[#E5E7EB] px-3 py-2 text-sm" placeholder="What went well, and one or two things to focus on next year." maxLength={2000} />
                    <span className="text-xs text-[#6B7280]">This also goes on their appraisal letter.</span></label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => save(false)} className="border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm disabled:opacity-50">Save draft</button>
                <button type="button" disabled={busy || !ready} onClick={() => save(true)} className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-5 py-2 text-sm disabled:opacity-50"><Send size={14} />Send to HR</button>
                {!ready && <span className="text-xs text-[#6B7280]">To send: rate every skill, overall, increment and a summary (20+ characters).</span>}
            </div>
        </div>
    );
}

function ManagerView({ a, meta }) {
    const m = a.manager || {};
    const sk = a.self?.skills || {};
    return (
        <div className="space-y-3">
            <h4 className="font-medium text-[#002B5C]">Manager review {m.by && <span className="text-xs text-[#6B7280] font-normal">by {m.by}</span>}</h4>
            <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-[#6B7280]"><th className="py-1 pr-2 font-normal">Skill</th><th className="py-1 pr-2 font-normal">Self</th><th className="py-1 pr-2 font-normal">Manager</th><th className="py-1 font-normal">Comment</th></tr></thead>
                <tbody>{meta.skills.map((s) => <tr key={s.key} className="border-t border-[#F3F4F6]"><td className="py-1.5 pr-2">{s.label}</td><td className="pr-2"><Tag n={sk[s.key]} scale={meta.scale} /></td><td className="pr-2"><Tag n={m.skills?.[s.key]?.rating} scale={meta.scale} /></td><td className="text-xs text-[#4B5563]">{m.skills?.[s.key]?.comment}</td></tr>)}</tbody>
            </table></div>
            <div className="flex flex-wrap gap-4 text-sm"><span>Overall: <Tag n={m.overall} scale={meta.scale} /></span><span>Proposed increment: <b>{m.increment_pct ?? "—"}%</b></span>{m.designation && <span>Promotion to: <b>{m.designation}</b></span>}</div>
            {m.summary && <p className="text-sm whitespace-pre-line border-l-4 border-[#F5B841] pl-3">{m.summary}</p>}
        </div>
    );
}

/* -------------------------------------------------------------- HR part --- */
function HrPanel({ a, meta, onSaved, reload }) {
    const m = a.manager || {};
    const out = a.outcome || {};
    const [f, setF] = useState({ overall: out.overall || m.overall, increment_pct: out.increment_pct ?? m.increment_pct ?? "", designation: out.designation || "", effective_from: out.effective_from || meta.default_effective, current_ctc: "", reason: a.hr?.reason || "" });
    const [busy, setBusy] = useState(false);
    const curKnown = a.ctc && !a.ctc.error ? a.ctc.current : null;
    const cur = f.current_ctc ? Number(cleanCtc(f.current_ctc)) : curKnown;
    const preview = cur && f.increment_pct !== "" ? revised(cur, f.increment_pct) : null;
    const changed = Number(f.overall) !== Number(m.overall) || Number(f.increment_pct) !== Number(m.increment_pct) || (f.designation || "") !== (m.designation || "");
    const needReason = changed && f.reason.trim().length < 10;
    const save = async () => {
        setBusy(true);
        try {
            const body = { overall: Number(f.overall), increment_pct: Number(f.increment_pct), designation: f.designation, effective_from: f.effective_from, reason: f.reason };
            if (f.current_ctc) body.current_ctc = f.current_ctc;
            onSaved(await appraisalSaveHr(a.id, body)); setF((x) => ({ ...x, current_ctc: "" })); toast.success("Saved.");
            return true;
        } catch (e) { err(e); return false; } finally { setBusy(false); }
    };
    const release = async () => {
        const msg = `Approve and share with ${a.name}?\n\nRating: ${meta.scale[f.overall]}\nIncrement: ${f.increment_pct}%${f.designation ? `\nNew designation: ${f.designation}` : ""}${preview ? `\nRevised CTC: ${inr(preview)}` : "\n(no CTC entered — the letter won't show salary)"}\nEffective: ${fmt(f.effective_from)}\n\nThey'll be emailed and can download their letter. This can't be undone.`;
        if (!window.confirm(msg)) return;
        if (!(await save())) return;
        setBusy(true);
        try { onSaved(await appraisalRelease(a.id)); toast.success("Shared with the employee."); } catch (e) { err(e); reload(); } finally { setBusy(false); }
    };
    return (
        <div className="border-2 border-[#F5B841] p-4 space-y-4" data-testid="hrm-appraisal-hr">
            <h4 className="font-medium text-[#002B5C] flex items-center gap-2"><ShieldCheck size={18} />HR approval <span className="text-xs font-normal text-[#6B7280]">— only HR / founders see this box</span></h4>
            <Hint>The manager's proposal is filled in. Change anything you need to — if you do, say why (kept on record, not shown to the employee).</Hint>
            <div><div className="text-sm font-medium mb-2">Final rating</div><Chips value={f.overall} compare={m.overall} scale={meta.scale} name="Final rating" onChange={(n) => setF({ ...f, overall: n })} /></div>
            <div className="grid sm:grid-cols-2 gap-4">
                <label className="block text-sm"><span>Increment %</span>
                    <span className="mt-1 flex items-center gap-1"><input type="number" min={0} max={100} step={0.5} value={f.increment_pct} onChange={(e) => setF({ ...f, increment_pct: e.target.value })} className="w-28 border border-[#E5E7EB] px-2 py-1.5" aria-label="Final increment percent" />%</span>
                    <span className="text-xs text-[#6B7280]">Manager proposed {m.increment_pct}%</span></label>
                <label className="block text-sm"><span>New designation <span className="text-xs text-[#6B7280]">(leave empty for no promotion)</span></span>
                    <input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5" maxLength={120} placeholder={a.designation ? `Stays "${a.designation}"` : ""} />
                    {m.designation && <span className="text-xs text-[#6B7280]">Manager proposed "{m.designation}"</span>}</label>
                <DateBox label="Effective from" value={f.effective_from} onChange={(v) => setF({ ...f, effective_from: v })} />
                <div className="text-sm">
                    <span>Current annual CTC (₹)</span>
                    {meta.ctc_ready ? (
                        <>
                            <input value={f.current_ctc} onChange={(e) => setF({ ...f, current_ctc: e.target.value })} inputMode="numeric" placeholder={curKnown ? `${inr(curKnown)} saved — type to change` : "e.g. 600000"} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5" aria-label="Current annual CTC" autoComplete="off" />
                            {a.ctc?.error && <span className="block text-xs text-[#CC0033]">{a.ctc.error}</span>}
                            {f.current_ctc && cleanCtc(f.current_ctc) && <span className="block text-xs text-[#6B7280]">{inr(cleanCtc(f.current_ctc))} — check the zeros</span>}
                        </>
                    ) : <KeyWarning />}
                </div>
            </div>
            {preview != null && (
                <div className="bg-[#ECFDF5] border border-[#A7F3D0] px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-3">
                    <span>{inr(cur)} + {f.increment_pct}% =</span><span className="font-serif text-2xl text-[#065F46]">{inr(preview)}</span><span className="text-xs text-[#6B7280]">new annual CTC from {fmt(f.effective_from)}</span>
                </div>
            )}
            <label className="block text-sm"><span>Reason for changes {changed && <span className="text-[#CC0033]">*</span>}</span>
                <textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="mt-1 w-full border border-[#E5E7EB] px-3 py-2" maxLength={600} placeholder={changed ? "Why did you change the manager's proposal?" : "Only needed if you change the manager's proposal"} />
                {needReason && <span className="text-xs text-[#CC0033]">You've changed the manager's proposal — add a reason (10+ characters).</span>}</label>
            <div className="flex flex-wrap items-center gap-2 border-t border-[#F3F4F6] pt-4">
                <button type="button" disabled={busy || needReason} onClick={save} className="border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm disabled:opacity-50">Save</button>
                <button type="button" disabled={busy || needReason || !f.overall || f.increment_pct === ""} onClick={release} className="inline-flex items-center gap-1.5 bg-[#0E9F6E] text-white px-5 py-2 text-sm disabled:opacity-50"><Check size={15} />Approve and share with {a.name.split(" ")[0]}</button>
            </div>
            <SendBack a={a} onDone={onSaved} />
        </div>
    );
}

function SendBack({ a, onDone }) {
    const [open, setOpen] = useState(false);
    const [part, setPart] = useState(a.stage === "hr" ? "manager" : "self");
    const [note, setNote] = useState("");
    const go = async () => {
        try { onDone(await appraisalReopen(a.id, { part, note })); toast.success("Sent back."); setOpen(false); } catch (e) { err(e); }
    };
    if (!open) return <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm text-[#4B5563] underline"><Undo2 size={14} />Send back for changes</button>;
    return (
        <div className="border border-[#E5E7EB] p-3 space-y-2 text-sm">
            <div className="flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-1"><input type="radio" checked={part === "self"} onChange={() => setPart("self")} />To {a.name.split(" ")[0]} (self-review)</label>
                {a.stage === "hr" && <label className="inline-flex items-center gap-1"><input type="radio" checked={part === "manager"} onChange={() => setPart("manager")} />To the manager</label>}
            </div>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they change?" className="w-full border border-[#E5E7EB] px-3 py-2" />
            <div className="flex gap-2"><button type="button" disabled={note.trim().length < 5} onClick={go} className="bg-[#002B5C] text-white px-3 py-1.5 disabled:opacity-50">Send back</button><button type="button" onClick={() => setOpen(false)} className="underline">Cancel</button></div>
        </div>
    );
}

/* --------------------------------------------------------------- result --- */
async function download(a) {
    try {
        const b = await appraisalLetter(a.id);
        const u = URL.createObjectURL(b);
        const el = document.createElement("a");
        el.href = u; el.download = `Appraisal ${a.fy} - ${a.name}.pdf`; document.body.appendChild(el); el.click(); el.remove();
        setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) { err(e); }
}

function Figures({ a, scaleWord }) {
    const o = a.outcome || {};
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Fig label="Overall rating" value={scaleWord} />
            <Fig label="Increment" value={`${o.increment_pct}%`} />
            {o.designation ? <Fig label="New designation" value={o.designation} /> : <Fig label="Designation" value="No change" />}
            {a.ctc && !a.ctc.error && a.ctc.revised ? <Fig label="New annual CTC" value={inr(a.ctc.revised)} /> : <Fig label="Effective from" value={fmt(o.effective_from)} />}
        </div>
    );
}

function Fig({ label, value }) {
    return <div className="bg-white/80 border border-[#E5E7EB] px-3 py-2.5"><div className="text-[11px] uppercase tracking-wide text-[#6B7280]">{label}</div><div className="font-serif text-lg text-[#002B5C] leading-tight mt-0.5">{value}</div></div>;
}

function Result({ a, meta, onChange }) {
    const o = a.outcome || {};
    const word = meta.scale[o.overall] || `${o.overall}/5`;
    return (
        <div className="space-y-4" data-testid="hrm-appraisal-result">
            <div className="p-5 border border-[#F5B841]/60" style={{ background: "linear-gradient(135deg,#FFFBEB 0%,#FFF7E0 100%)" }}>
                <div className="flex items-center gap-2 text-[#92400E] text-sm"><PartyPopper size={18} />Your {a.fy} appraisal is ready</div>
                <div className="mt-3"><Figures a={a} scaleWord={word} /></div>
                <p className="mt-3 text-xs text-[#4B5563]">Takes effect from <b>{fmt(o.effective_from)}</b>.{a.ctc && !a.ctc.error && a.ctc.current ? ` Your annual CTC goes from ${inr(a.ctc.current)} to ${inr(a.ctc.revised)}.` : ""}</p>
                <button type="button" onClick={() => download(a)} className="mt-3 inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-4 py-2 text-sm"><Download size={14} />Download appraisal letter (PDF)</button>
            </div>
            {a.manager && <ManagerView a={a} meta={meta} />}
            <Ack a={a} onChange={onChange} />
        </div>
    );
}

function Ack({ a, onChange }) {
    const [comment, setComment] = useState("");
    const [disagree, setDisagree] = useState(false);
    const [busy, setBusy] = useState(false);
    if (a.ack) return <p className="text-sm bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-2 flex gap-2"><Check size={16} className="text-[#15803D] shrink-0 mt-0.5" />You acknowledged this on {fmt(a.ack.at)}.{a.ack.disagree ? " HR has your note and will get back to you." : ""}</p>;
    const go = async () => {
        setBusy(true);
        try { const r = await appraisalAck(a.id, { comment, disagree }); onChange({ ...a, ack: r.ack, can: { ...a.can, ack: false } }); toast.success("Thank you — acknowledged."); }
        catch (e) { err(e); } finally { setBusy(false); }
    };
    return (
        <div className="border border-[#E5E7EB] p-4 space-y-3" data-testid="hrm-appraisal-ack">
            <h4 className="font-medium text-[#002B5C]">Please acknowledge</h4>
            <p className="text-xs text-[#6B7280]">This only confirms you've read it. If you don't agree, tick the box and tell HR why — it won't count against you.</p>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Any comments? (optional)" className="w-full border border-[#E5E7EB] px-3 py-2 text-sm" maxLength={1000} />
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={disagree} onChange={(e) => setDisagree(e.target.checked)} />I don't agree with this result</label>
            {disagree && comment.trim().length < 10 && <p className="text-xs text-[#CC0033]">Tell HR what you disagree with (a sentence or two).</p>}
            <div><button type="button" disabled={busy || (disagree && comment.trim().length < 10)} onClick={go} className="bg-[#002B5C] text-white px-5 py-2 text-sm disabled:opacity-50">{disagree ? "Acknowledge and send my note to HR" : "I've read it — acknowledge"}</button></div>
        </div>
    );
}

function Outcome({ a }) {
    const o = a.outcome || {};
    return (
        <div className="border border-[#A7F3D0] bg-[#F0FDF4] p-4 space-y-3">
            <div className="text-sm font-medium text-[#065F46] flex items-center gap-2"><Check size={16} />Shared {fmt(a.released_at)} · effective {fmt(o.effective_from)}{a.applied_at ? " · applied" : ""}</div>
            <div className="text-sm">Final: <b>{o.overall}/5</b> · <b>{o.increment_pct}%</b>{o.designation ? <> · promoted to <b>{o.designation}</b></> : ""}{a.ctc && !a.ctc.error && a.ctc.revised ? <> · new CTC <b>{inr(a.ctc.revised)}</b></> : ""}</div>
            {a.ack ? <p className="text-sm">{a.ack.disagree ? <span className="text-[#CC0033] font-medium">Disagrees: </span> : "Acknowledged"} {fmt(a.ack.at)}{a.ack.comment ? ` — “${a.ack.comment}”` : ""}</p>
                : <p className="text-sm text-[#6B7280]">Not acknowledged yet.</p>}
            {a.can.letter && <button type="button" onClick={() => download(a)} className="inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-3 py-1.5 text-sm"><Download size={14} />Letter (PDF)</button>}
        </div>
    );
}

function Hint({ children }) {
    return <p className="text-sm text-[#374151] bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-2 flex gap-2"><Lightbulb size={16} className="shrink-0 mt-0.5 text-[#1E6FB8]" /><span>{children}</span></p>;
}

// Re-exported for the Home banner.
export function useMyAppraisal(enabled) {
    const [a, setA] = useState(null);
    useEffect(() => { if (enabled) appraisalMine().then((r) => setA(r.appraisal)).catch(() => {}); }, [enabled]);
    return useMemo(() => {
        if (!a) return null;
        if (a.can?.self) return { text: a.self?.skills && Object.keys(a.self.skills).length ? "Finish your self-review" : "Your appraisal self-review is open", due: a.self_due };
        if (a.can?.ack) return { text: "Your appraisal result is ready", due: null };
        return null;
    }, [a]);
}
