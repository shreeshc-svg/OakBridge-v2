import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X, FileText, Check } from "lucide-react";
import {
    hiringList, hiringAdd, hiringEdit, hiringNote, hiringFeedback, hiringCv, hiringJoin, hrmPeople,
    hrmLifecycle, hrmChecklist, hrmExit, hrmExitCancel, hrmLifecycleSettings, hrmSaveLifecycleSettings, formatApiError,
} from "../../lib/api";

/**
 * HRM release 4 (Nov 2026): Hiring board, onboarding / exit checklists, exit.
 * Rules on the server (backend/hr_lifecycle_core.py). HR moves candidates and
 * marks them joined; a hiring manager sees only their candidates and adds
 * interview feedback. CVs open through the HRM (signed in), never a public link.
 */
const fmt = (d) => (d ? new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const BOARD = ["new", "shortlisted", "interview", "offer"];
const REC = { hire: "Hire", maybe: "Maybe", no: "No" };
const REC_TONE = { hire: "text-[#15803D]", maybe: "text-[#B4750F]", no: "text-[#CC0033]" };

export default function HiringTab() {
    const [d, setD] = useState(null);
    const [people, setPeople] = useState([]);
    const [open, setOpen] = useState(null);
    const [showClosed, setShowClosed] = useState(false);
    const [adding, setAdding] = useState(false);
    const load = useCallback(() => hiringList().then(setD).catch((e) => toast.error(formatApiError(e))), []);
    useEffect(() => { load(); hrmPeople().then(setPeople).catch(() => {}); }, [load]);
    if (!d) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    const byStage = (s) => d.rows.filter((c) => c.stage === s);
    const closed = d.rows.filter((c) => !BOARD.includes(c.stage));
    const cur = open && d.rows.find((c) => c.id === open);
    return (
        <div className="space-y-4" data-testid="hrm-hiring">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-serif text-2xl text-[#002B5C] flex-1">{d.hr ? "Hiring" : "Your candidates"}</h2>
                {d.hr && <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-3 py-2 text-sm"><Plus size={14} />Add candidate</button>}
            </div>
            {d.hr && <p className="text-xs text-[#6B7280]">Applications from the Careers page appear here automatically. People not hired are deleted 6 months after they're turned down (privacy law).</p>}
            {adding && <AddCandidate onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
            {cur && <Candidate c={cur} hr={d.hr} people={people} stages={d.stages} onClose={() => setOpen(null)} onChange={load} />}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {BOARD.map((s) => (
                    <section key={s} className="bg-white border border-[#E5E7EB] p-3 min-h-[120px]">
                        <div className="flex items-center justify-between mb-2">
                            <b className="text-sm text-[#002B5C]">{d.stages[s]}</b><span className="text-xs text-[#6B7280]">{byStage(s).length}</span>
                        </div>
                        <ul className="space-y-2">
                            {byStage(s).map((c) => (
                                <li key={c.id}>
                                    <button type="button" onClick={() => setOpen(c.id)} className={`w-full text-left border px-2.5 py-2 hover:border-[#002B5C] ${open === c.id ? "border-[#002B5C]" : "border-[#E5E7EB]"}`}>
                                        <div className="text-sm text-[#002B5C]">{c.name}</div>
                                        <div className="text-[11px] text-[#6B7280]">{c.role}{c.hiring_manager_name ? ` · ${c.hiring_manager_name}` : ""} · {fmt(c.created_at)}</div>
                                        {(c.feedback || []).length > 0 && <div className="text-[11px] mt-0.5">{c.feedback.map((f, i) => <span key={i} className={`mr-1 ${REC_TONE[f.recommend]}`}>{REC[f.recommend]}</span>)}</div>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            <button type="button" onClick={() => setShowClosed(!showClosed)} className="text-xs underline text-[#4B5563]">{showClosed ? "Hide" : "Show"} joined / not selected ({closed.length})</button>
            {showClosed && (
                <ul className="bg-white border border-[#E5E7EB] divide-y divide-[#F3F4F6] text-sm">
                    {closed.map((c) => (
                        <li key={c.id} className="px-3 py-2 flex flex-wrap gap-3 items-center">
                            <span className="flex-1">{c.name} <span className="text-[#6B7280]">· {c.role}</span></span>
                            <span className="text-xs">{d.stages[c.stage]} · {fmt(c.closed_at)}</span>
                            <button type="button" onClick={() => setOpen(c.id)} className="text-xs underline">Open</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function AddCandidate({ onClose, onDone }) {
    const [f, setF] = useState({ name: "", email: "", phone: "", role: "", source: "referral" });
    const inp = "mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm";
    const save = async (e) => {
        e.preventDefault();
        try { await hiringAdd(f); toast.success("Added."); onDone(); } catch (er) { toast.error(formatApiError(er)); }
    };
    return (
        <form onSubmit={save} className="bg-white border border-[#002B5C] p-4 grid gap-3 sm:grid-cols-5 text-sm items-end">
            <label>Name *<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inp} /></label>
            <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inp} /></label>
            <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inp} /></label>
            <label>Role<input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className={inp} /></label>
            <div className="flex gap-2"><button type="submit" className="bg-[#002B5C] text-white px-3 py-2">Add</button><button type="button" onClick={onClose} className="px-3 py-2">Cancel</button></div>
        </form>
    );
}

function Candidate({ c, hr, people, stages, onClose, onChange }) {
    const [note, setNote] = useState("");
    const [fb, setFb] = useState({ recommend: "hire", notes: "" });
    const [joining, setJoining] = useState(false);
    const act = async (fn, ok) => { try { await fn(); if (ok) toast.success(ok); onChange(); } catch (e) { toast.error(formatApiError(e)); } };
    const openCv = async () => {
        try { const b = await hiringCv(c.id); const u = URL.createObjectURL(b); window.open(u, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(u), 60000); }
        catch (e) { toast.error(formatApiError(e)); }
    };
    const closedStage = ["joined", "rejected", "withdrawn"].includes(c.stage);
    const next = { new: "shortlisted", shortlisted: "interview", interview: "offer" }[c.stage];
    return (
        <section className="bg-white border border-[#002B5C] p-4 space-y-3 text-sm" data-testid="hrm-candidate">
            <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1">
                    <div className="font-serif text-xl text-[#002B5C]">{c.name}</div>
                    <div className="text-xs text-[#4B5563]">{[c.role, c.email, c.phone, `applied ${fmt(c.created_at)}`].filter(Boolean).join(" · ")}</div>
                    <div className="text-xs mt-0.5">Stage: <b>{stages[c.stage]}</b>{c.hiring_manager_name ? ` · hiring manager ${c.hiring_manager_name}` : ""}</div>
                </div>
                {c.has_cv && <button type="button" onClick={openCv} className="inline-flex items-center gap-1 border border-[#002B5C] text-[#002B5C] px-3 py-1.5"><FileText size={14} />Open CV</button>}
                <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>

            {hr && !closedStage && (
                <div className="flex flex-wrap items-center gap-2 border-t border-[#F3F4F6] pt-3">
                    {next && <button type="button" onClick={() => act(() => hiringEdit(c.id, { stage: next }), `Moved to ${stages[next]}.`)} className="bg-[#002B5C] text-white px-3 py-1.5">Move to {stages[next]}</button>}
                    {c.stage === "offer" && <button type="button" onClick={() => setJoining(true)} className="bg-[#15803D] text-white px-3 py-1.5" data-testid="hrm-mark-joined"><Check size={14} className="inline mr-1" />Mark as joined</button>}
                    <button type="button" onClick={() => window.confirm(`Mark ${c.name} as not selected?`) && act(() => hiringEdit(c.id, { stage: "rejected" }), "Marked not selected.")} className="border border-[#CC0033] text-[#CC0033] px-3 py-1.5">Not selected</button>
                    <button type="button" onClick={() => act(() => hiringEdit(c.id, { stage: "withdrawn" }), "Marked withdrawn.")} className="px-3 py-1.5 underline text-[#4B5563]">Candidate withdrew</button>
                    <label className="ml-auto flex items-center gap-2 text-xs">Hiring manager
                        <select value={c.hiring_manager_id || ""} onChange={(e) => act(() => hiringEdit(c.id, { hiring_manager_id: e.target.value || null }), "Saved — they've been emailed.")} className="border border-[#E5E7EB] px-2 py-1">
                            <option value="">— none —</option>{people.filter((p) => p.status === "active").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </label>
                </div>
            )}
            {joining && <JoinForm c={c} people={people} onClose={() => setJoining(false)} onDone={() => { setJoining(false); onChange(); onClose(); }} />}

            <div className="grid gap-4 md:grid-cols-2 border-t border-[#F3F4F6] pt-3">
                <div>
                    <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Interview feedback</div>
                    {(c.feedback || []).length ? (
                        <ul className="mt-1 space-y-2">{c.feedback.map((f, i) => (
                            <li key={i} className="text-xs"><b className={REC_TONE[f.recommend]}>{REC[f.recommend]}</b> · {f.by_name || f.by} · {fmt(f.at)}<div className="text-[#4B5563]">{f.notes}</div></li>
                        ))}</ul>
                    ) : <p className="text-xs text-[#6B7280] mt-1">None yet.</p>}
                    {!closedStage && (
                        <div className="mt-2 space-y-1.5">
                            <div className="flex gap-2 text-xs">{Object.entries(REC).map(([k, l]) => (
                                <label key={k} className="flex items-center gap-1"><input type="radio" name={`rec-${c.id}`} checked={fb.recommend === k} onChange={() => setFb({ ...fb, recommend: k })} />{l}</label>
                            ))}</div>
                            <textarea value={fb.notes} onChange={(e) => setFb({ ...fb, notes: e.target.value })} rows={2} placeholder="How did the interview go?" className="w-full border border-[#E5E7EB] px-2 py-1 text-xs" />
                            <button type="button" onClick={() => act(() => hiringFeedback(c.id, fb).then(() => setFb({ recommend: "hire", notes: "" })), "Feedback saved.")} className="bg-[#002B5C] text-white px-3 py-1 text-xs">Add feedback</button>
                        </div>
                    )}
                </div>
                <div>
                    <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Notes</div>
                    <ul className="mt-1 space-y-1">{(c.notes || []).map((n, i) => <li key={i} className="text-xs"><span className="text-[#6B7280]">{n.by} · {fmt(n.at)}:</span> {n.text}</li>)}</ul>
                    <div className="mt-2 flex gap-2">
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className="flex-1 border border-[#E5E7EB] px-2 py-1 text-xs" />
                        <button type="button" disabled={!note.trim()} onClick={() => act(() => hiringNote(c.id, note).then(() => setNote("")), "")} className="border border-[#002B5C] px-2 text-xs disabled:opacity-50">Add</button>
                    </div>
                </div>
            </div>
        </section>
    );
}

function JoinForm({ c, people, onClose, onDone }) {
    const [f, setF] = useState({ work_email: "", joined_on: "", designation: c.role || "", department: "", manager_id: c.hiring_manager_id || "", emp_code: "", location: "", send_login: true });
    const [busy, setBusy] = useState(false);
    const inp = "mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm";
    const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await hiringJoin(c.id, f);
            toast.success(r.invited?.ok === false ? `Joined — but the login email failed: ${r.invited.error}` : `${c.name} is now in People, on probation, with an onboarding checklist.`);
            onDone();
        } catch (er) { toast.error(formatApiError(er)); } finally { setBusy(false); }
    };
    return (
        <form onSubmit={save} className="border border-[#15803D] bg-[#F0FDF4] p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm" data-testid="hrm-join-form">
            <label>Work email * <span className="text-[11px] text-[#6B7280]">(their login)</span><input required type="email" value={f.work_email} onChange={set("work_email")} className={inp} /></label>
            <label>Joining date *<input required type="date" value={f.joined_on} onChange={set("joined_on")} className={inp} />{f.joined_on && <span className="block text-[11px] text-[#15803D]">= {fmt(f.joined_on)}</span>}</label>
            <label>Designation<input value={f.designation} onChange={set("designation")} className={inp} /></label>
            <label>Department<input value={f.department} onChange={set("department")} className={inp} /></label>
            <label>Reports to<select value={f.manager_id} onChange={set("manager_id")} className={inp}>
                <option value="">— nobody —</option>{people.filter((p) => p.status === "active").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label>Employee code<input value={f.emp_code} onChange={set("emp_code")} className={inp} /></label>
            <label>Location<input value={f.location} onChange={set("location")} className={inp} /></label>
            <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={f.send_login} onChange={set("send_login")} />Send their HRM login now</label>
            <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                <button type="submit" disabled={busy} className="bg-[#15803D] text-white px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Confirm joining"}</button>
                <button type="button" onClick={onClose} className="px-3 py-2">Cancel</button>
                <span className="text-xs text-[#6B7280] self-center">They start on probation — confirm them in People when probation ends.</span>
            </div>
        </form>
    );
}

/* -------------------------------------------- onboarding / exit (People) --- */
export function LifecyclePanel({ person, onChange }) {
    const [d, setD] = useState(null);
    const [exitF, setExitF] = useState({ last_day: "", reason: "resigned", note: "" });
    const [extra, setExtra] = useState({ onboarding: "", exit: "" });
    const load = useCallback(() => hrmLifecycle(person.id).then(setD).catch((e) => toast.error(formatApiError(e))), [person.id]);
    useEffect(() => { load(); }, [load]);
    if (!d) return null;
    const tick = async (kind, item, done) => { try { await hrmChecklist(person.id, { kind, item, done }); load(); } catch (e) { toast.error(formatApiError(e)); } };
    const add = async (kind) => {
        if (!extra[kind].trim()) return;
        try { await hrmChecklist(person.id, { kind, item: extra[kind], add: true }); setExtra({ ...extra, [kind]: "" }); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const recordExit = async (e) => {
        e.preventDefault();
        if (!window.confirm(`Record ${person.name}'s exit? Last working day ${fmt(exitF.last_day)}. Their HRM login${person.user_id ? " and any admin / warehouse access" : ""} close the day after.`)) return;
        try { const r = await hrmExit(person.id, exitF); toast.success(`Exit recorded.${r.leave_cancelled ? ` ${r.leave_cancelled} leave request(s) after the last day cancelled.` : ""}`); load(); onChange?.(); }
        catch (er) { toast.error(formatApiError(er)); }
    };
    const cancelExit = async () => {
        if (!window.confirm(`${person.name} is staying — remove the exit?`)) return;
        try { await hrmExitCancel(person.id); load(); onChange?.(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const List = ({ kind, items }) => (
        <div>
            <ul className="space-y-1">
                {items.map((i) => (
                    <li key={i.item}><label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" checked={i.done} onChange={(e) => tick(kind, i.item, e.target.checked)} className="mt-1" />
                        <span className={i.done ? "text-[#6B7280] line-through" : ""}>{i.item}{i.done && <span className="no-underline text-[11px] ml-1">({i.by}, {fmt(i.at)})</span>}</span>
                    </label></li>
                ))}
            </ul>
            <div className="mt-1 flex gap-2"><input value={extra[kind]} onChange={(e) => setExtra({ ...extra, [kind]: e.target.value })} placeholder="+ another item" className="flex-1 border border-[#E5E7EB] px-2 py-1 text-xs" />
                <button type="button" onClick={() => add(kind)} className="border px-2 text-xs">Add</button></div>
        </div>
    );
    const done = (items) => `${items.filter((i) => i.done).length}/${items.length}`;
    return (
        <div className="grid gap-4 md:grid-cols-2 mt-4 border-t border-[#E5E7EB] pt-4" data-testid="hrm-lifecycle">
            <div>
                <div className="text-[11px] uppercase tracking-wider text-[#6B7280] mb-1">Onboarding {d.onboarding.length ? done(d.onboarding) : ""}</div>
                {d.onboarding.length ? <List kind="onboarding" items={d.onboarding} /> : <p className="text-xs text-[#6B7280]">No onboarding list (added before release 4).</p>}
            </div>
            <div>
                <div className="text-[11px] uppercase tracking-wider text-[#6B7280] mb-1">Exit</div>
                {d.exit ? (
                    <div className="space-y-2">
                        <p className="text-sm">Last working day <b>{fmt(d.exit.last_day)}</b> · {d.exit.reason_label}{d.exit.note ? ` — ${d.exit.note}` : ""}</p>
                        <p className="text-xs">{d.exit.encashment?.eligible ? <>Earned leave to encash: <b>{d.exit.encashment.days} day(s)</b> (on that month's RazorpayX export)</> : <>No earned-leave encashment ({d.exit.encashment?.why}).</>}</p>
                        <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Exit checklist {done(d.exit_checklist)}</div>
                        <List kind="exit" items={d.exit_checklist} />
                        {person.status === "active" && <button type="button" onClick={cancelExit} className="text-xs underline text-[#4B5563]">They're staying — remove the exit</button>}
                    </div>
                ) : person.status === "active" ? (
                    <form onSubmit={recordExit} className="space-y-2 text-sm">
                        <label className="block">Last working day<input required type="date" value={exitF.last_day} onChange={(e) => setExitF({ ...exitF, last_day: e.target.value })} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5" />{exitF.last_day && <span className="text-[11px] text-[#15803D]">= {fmt(exitF.last_day)}</span>}</label>
                        <label className="block">Reason<select value={exitF.reason} onChange={(e) => setExitF({ ...exitF, reason: e.target.value })} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5">
                            {Object.entries(d.reasons).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select></label>
                        <input value={exitF.note} onChange={(e) => setExitF({ ...exitF, note: e.target.value })} placeholder="Note (optional)" className="w-full border border-[#E5E7EB] px-2 py-1.5" />
                        <button type="submit" className="border border-[#CC0033] text-[#CC0033] px-3 py-1.5" data-testid="hrm-record-exit">Record exit</button>
                    </form>
                ) : <p className="text-xs text-[#6B7280]">Left.</p>}
            </div>
        </div>
    );
}

/* ------------------------------------------------ checklist templates ---- */
export function ChecklistSettings() {
    const [s, setS] = useState(null);
    useEffect(() => { hrmLifecycleSettings().then(setS).catch(() => {}); }, []);
    if (!s) return null;
    const save = async () => { try { setS(await hrmSaveLifecycleSettings(s)); toast.success("Saved — used for people who join / leave from now on."); } catch (e) { toast.error(formatApiError(e)); } };
    return (
        <section className="bg-white border border-[#E5E7EB] p-4 mt-4" data-testid="hrm-checklist-settings">
            <h2 className="font-serif text-xl text-[#002B5C] mb-3">Onboarding &amp; exit checklists</h2>
            <div className="grid gap-4 md:grid-cols-2 text-sm">
                {["onboarding", "exit"].map((k) => (
                    <label key={k} className="block capitalize">{k} (one item per line)
                        <textarea rows={9} value={s[k].join("\n")} onChange={(e) => setS({ ...s, [k]: e.target.value.split("\n") })} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm normal-case" />
                    </label>
                ))}
            </div>
            <button type="button" onClick={save} className="mt-3 bg-[#002B5C] text-white px-4 py-2 text-sm">Save checklists</button>
        </section>
    );
}
