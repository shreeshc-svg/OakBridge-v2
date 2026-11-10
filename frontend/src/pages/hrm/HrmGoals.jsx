import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import {
    goalsPlan, goalsSaveDraft, goalsSubmit, goalsDecide, goalsReopen, goalsCheckin, goalsReview, goalsRate, goalsTeam, goalsRelease,
    formatApiError,
} from "../../lib/api";

/**
 * HRM → Goals (release 3). Rules on the server (backend/hr_goals_core.py):
 * employee drafts annual goals (weights = 100%) → manager approves or returns
 * → each quarter: self check-in, then manager review → year-end rating 1–5,
 * hidden from the employee until HR releases ratings. This screen only shows
 * what the server says the person may do (`plan.can`).
 */
const STATUS_LABEL = { on_track: "On track", at_risk: "At risk", off_track: "Off track", done: "Done" };
const STATUS_TONE = { on_track: "text-[#15803D]", at_risk: "text-[#B4750F]", off_track: "text-[#CC0033]", done: "text-[#002B5C]" };
const PLAN_STATUS = { draft: "Draft", submitted: "Waiting for approval", returned: "Sent back for changes", approved: "Approved", "not started": "Not started" };
const thisFy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(-2)}`; };
const shiftFy = (fy, by) => { const y = Number(fy.slice(0, 4)) + by; return `${y}-${String(y + 1).slice(-2)}`; };

export default function GoalsTab({ me }) {
    const [fy, setFy] = useState(thisFy());
    const [open, setOpen] = useState(null);        // emp_id of a team member's plan
    const lead = me.hr || me.manager;
    return (
        <div className="space-y-5" data-testid="hrm-goals">
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setFy(shiftFy(fy, -1))} className="border border-[#E5E7EB] bg-white px-2 py-1" aria-label="Previous year">‹</button>
                <h2 className="font-serif text-2xl text-[#002B5C]">Goals · FY {fy}</h2>
                <button type="button" onClick={() => setFy(shiftFy(fy, 1))} className="border border-[#E5E7EB] bg-white px-2 py-1" aria-label="Next year">›</button>
            </div>
            {open ? (
                <div>
                    <button type="button" onClick={() => setOpen(null)} className="inline-flex items-center gap-1 text-sm underline mb-3"><ArrowLeft size={14} />Back to the team</button>
                    <Plan empId={open} fy={fy} />
                </div>
            ) : (
                <>
                    {me.me && <Plan fy={fy} />}
                    {lead && <Team fy={fy} hr={me.hr} onOpen={setOpen} />}
                </>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------- a plan --- */
function Plan({ empId, fy }) {
    const [p, setP] = useState(null);
    const load = useCallback(() => goalsPlan(empId, fy).then(setP).catch((e) => toast.error(formatApiError(e))), [empId, fy]);
    useEffect(() => { setP(null); load(); }, [load]);
    if (!p) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    const run = async (fn, ok) => { try { const r = await fn(); toast.success(ok); r && r.goals ? setP({ ...p, ...r }) : load(); } catch (e) { toast.error(formatApiError(e)); } };
    const total = (p.goals || []).reduce((n, g) => n + (Number(g.weight) || 0), 0);
    return (
        <section className="bg-white border border-[#E5E7EB] p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-serif text-xl text-[#002B5C] flex-1">{empId ? `${p.name}'s goals` : "Your goals"}</h3>
                <span className="text-xs border border-[#E5E7EB] px-2 py-0.5">{PLAN_STATUS[p.status] || p.status}</span>
                {p.overall != null && <span className="text-sm">Overall <b className="text-[#002B5C]">{p.overall}%</b></span>}
            </div>
            {p.decision_note && p.status === "returned" && <p className="text-sm border border-[#E7B64B] bg-[#FFFBEB] px-3 py-2">Manager's note: {p.decision_note}</p>}

            {p.can.edit ? (
                <Editor p={p} fy={fy} onSaved={(r) => setP({ ...p, ...r })} />
            ) : p.goals.length ? (
                <GoalList p={p} />
            ) : <p className="text-sm text-[#6B7280]">No goals set for {fy} yet.</p>}

            <div className="flex flex-wrap gap-2">
                {p.can.submit && p.id && <button type="button" onClick={() => run(() => goalsSubmit(fy), "Submitted to your manager.")} className="bg-[#002B5C] text-white px-4 py-2 text-sm" disabled={total !== 100}>Submit for approval</button>}
                {p.can.decide && <DecideBar p={p} onDone={load} />}
                {p.can.reopen && <button type="button" onClick={() => window.confirm("Reopen these goals for changes? They'll need approval again.") && run(() => goalsReopen(p.id), "Reopened.")} className="border border-[#002B5C] text-[#002B5C] px-3 py-2 text-sm">Reopen to change</button>}
            </div>

            {p.status === "approved" && <Quarters p={p} onChange={(r) => setP({ ...p, ...r })} />}
            {p.status === "approved" && <YearEnd p={p} onChange={(r) => setP({ ...p, ...r })} />}
        </section>
    );
}

function Editor({ p, fy, onSaved }) {
    const [rows, setRows] = useState(p.goals.length ? p.goals : [{ title: "", measure: "", weight: 100 }]);
    const [busy, setBusy] = useState(false);
    const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    const total = rows.reduce((n, r) => n + (Number(r.weight) || 0), 0);
    const save = async () => {
        setBusy(true);
        try { onSaved(await goalsSaveDraft(fy, rows.map((r) => ({ ...r, weight: Number(r.weight) || 0 })))); toast.success("Saved."); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const inp = "w-full border border-[#E5E7EB] px-2 py-1.5 text-sm";
    return (
        <div className="space-y-2" data-testid="hrm-goal-editor">
            <p className="text-xs text-[#6B7280]">1–8 goals. Say how each will be measured. Weights show how much each matters and must add up to 100%.</p>
            {rows.map((r, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_32px] items-start">
                    <input value={r.title} onChange={(e) => upd(i, "title", e.target.value)} placeholder={`Goal ${i + 1}`} className={inp} aria-label={`Goal ${i + 1}`} />
                    <input value={r.measure || ""} onChange={(e) => upd(i, "measure", e.target.value)} placeholder="How it's measured (e.g. ₹50L B2B orders)" className={inp} aria-label="Measure" />
                    <label className="flex items-center gap-1"><input type="number" min={5} max={100} value={r.weight} onChange={(e) => upd(i, "weight", e.target.value)} className={inp} aria-label="Weight %" />%</label>
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove goal" className="p-1.5 text-[#CC0033]"><Trash2 size={15} /></button>
                </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
                {rows.length < 8 && <button type="button" onClick={() => setRows([...rows, { title: "", measure: "", weight: Math.max(5, 100 - total) }])} className="inline-flex items-center gap-1 border border-[#002B5C] text-[#002B5C] px-3 py-1.5 text-sm"><Plus size={14} />Add goal</button>}
                <span className={`text-sm ${total === 100 ? "text-[#15803D]" : "text-[#CC0033]"}`}>Total {total}%{total !== 100 ? " — must be 100%" : " ✓"}</span>
                <button type="button" disabled={busy} onClick={save} className="ml-auto bg-white border border-[#002B5C] text-[#002B5C] px-4 py-1.5 text-sm disabled:opacity-50">{busy ? "Saving…" : "Save draft"}</button>
            </div>
        </div>
    );
}

function latest(p, gid) {
    for (const q of ["Q4", "Q3", "Q2", "Q1"]) { const s = p.checkins?.[q]?.self; if (s) return s.progress[gid]; }
    return null;
}

function GoalList({ p }) {
    return (
        <ul className="divide-y divide-[#F3F4F6]">
            {p.goals.map((g) => {
                const pr = latest(p, g.id);
                return (
                    <li key={g.id} className="py-2.5">
                        <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-medium text-[#002B5C] flex-1">{g.title}</span>
                            <span className="text-xs text-[#6B7280]">weight {g.weight}%</span>
                        </div>
                        {g.measure && <div className="text-xs text-[#6B7280]">{g.measure}</div>}
                        {pr != null && (
                            <div className="mt-1.5 flex items-center gap-2">
                                <div className="flex-1 h-2 bg-[#F3F4F6]"><div className="h-2 bg-[#002B5C]" style={{ width: `${pr}%` }} /></div>
                                <span className="text-xs w-10 text-right">{pr}%</span>
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

function DecideBar({ p, onDone }) {
    const [back, setBack] = useState(false);    // inline "what should change?" instead of a browser pop-up
    const [note, setNote] = useState("");
    const act = async (approve) => {
        try { await goalsDecide(p.id, { approve, note: approve ? "" : note }); toast.success(approve ? "Approved." : "Sent back."); onDone(); }
        catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <>
            <button type="button" onClick={() => act(true)} className="bg-[#15803D] text-white px-4 py-2 text-sm">Approve goals</button>
            <button type="button" onClick={() => setBack(!back)} className="border border-[#CC0033] text-[#CC0033] px-3 py-2 text-sm">Send back</button>
            {back && (
                <div className="basis-full border-l-4 border-[#CC0033] bg-[#FEF2F2] px-3 py-2 space-y-2" data-testid="hrm-goals-sendback">
                    <label className="block text-xs">What should change? <span className="text-[#6B7280]">(they'll see this)</span>
                        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full border border-[#E5E7EB] px-2 py-1 text-sm bg-white" />
                    </label>
                    <div className="flex gap-2">
                        <button type="button" disabled={note.trim().length < 5} onClick={() => act(false)} className="bg-[#CC0033] text-white px-3 py-1 text-xs disabled:opacity-50">Send back</button>
                        <button type="button" onClick={() => setBack(false)} className="px-3 py-1 text-xs">Cancel</button>
                    </div>
                </div>
            )}
        </>
    );
}

/* On a phone the four quarters fold: the CURRENT one (the latest still open,
   else the latest with anything in it, else Q1) is open, the others are one
   line each — tap to open. From tablet width up all four show side by side. */
function Quarters({ p, onChange }) {
    const withData = ["Q1", "Q2", "Q3", "Q4"].filter((q) => p.checkins?.[q]?.self || p.checkins?.[q]?.review);
    const current = p.open_quarters?.[p.open_quarters.length - 1] || withData[withData.length - 1] || "Q1";
    return (
        <div className="grid gap-2 md:gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="hrm-quarters">
            {["Q1", "Q2", "Q3", "Q4"].map((q) => <Quarter key={q} q={q} p={p} onChange={onChange} current={q === current} />)}
        </div>
    );
}

function Quarter({ q, p, onChange, current }) {
    const c = p.checkins?.[q] || {};
    const open = p.open_quarters.includes(q);
    const [expanded, setExpanded] = useState(current);
    const summary = c.review ? "reviewed ✓" : c.self ? "checked in" : open ? (p.can.checkin ? "check-in open" : "open") : "—";
    const [prog, setProg] = useState(() => Object.fromEntries(p.goals.map((g) => [g.id, c.self?.progress?.[g.id] ?? latest(p, g.id) ?? 0])));
    const [note, setNote] = useState(c.self?.note || "");
    const [st, setSt] = useState(() => Object.fromEntries(p.goals.map((g) => [g.id, c.review?.status?.[g.id] || ""])));
    const [comment, setComment] = useState(c.review?.comment || "");
    const sendSelf = async () => {
        try { onChange(await goalsCheckin(p.id, { q, progress: prog, note })); toast.success(`${q} check-in sent to your manager.`); }
        catch (e) { toast.error(formatApiError(e)); }
    };
    const sendReview = async () => {
        try { onChange(await goalsReview(p.id, { q, status: st, comment })); toast.success(`${q} reviewed.`); }
        catch (e) { toast.error(formatApiError(e)); }
    };
    const range = p.quarters?.[q] || [];
    return (
        <div className={`border p-3 text-sm ${open ? "border-[#002B5C]" : "border-[#E5E7EB]"}`} data-testid={`hrm-quarter-${q}`}>
            <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="w-full flex items-baseline justify-between gap-2 text-left md:cursor-default">
                <b className="text-[#002B5C]">{q}</b>
                <span className="text-[11px] text-[#6B7280] flex-1 text-right">{range.length ? `${new Date(range[0]).toLocaleDateString("en-IN", { month: "short" })}–${new Date(range[1]).toLocaleDateString("en-IN", { month: "short" })}` : ""}{open ? " · open" : ""}
                    <span className={`md:hidden ml-1 ${c.review ? "text-[#15803D]" : open ? "text-[#B4750F]" : ""}`}>· {summary}</span></span>
                <span className="md:hidden text-[#6B7280]" aria-hidden="true">{expanded ? "▴" : "▾"}</span>
            </button>
            <div className={`${expanded ? "block" : "hidden"} md:block`}>
            {c.self ? (
                <div className="mt-2 text-xs">
                    <div className="text-[#4B5563]">Self check-in: {p.goals.map((g) => `${c.self.progress[g.id]}%`).join(" · ")}</div>
                    {c.self.note && <div className="text-[#6B7280] mt-0.5">“{c.self.note}”</div>}
                </div>
            ) : <div className="mt-2 text-xs text-[#9CA3AF]">No check-in yet.</div>}
            {c.review && (
                <div className="mt-2 text-xs border-t border-[#F3F4F6] pt-2">
                    {p.goals.map((g) => <div key={g.id} className={STATUS_TONE[c.review.status[g.id]]}>{g.title.slice(0, 28)}: {STATUS_LABEL[c.review.status[g.id]]}</div>)}
                    <div className="text-[#4B5563] mt-0.5">“{c.review.comment}”</div>
                </div>
            )}
            {p.can.checkin && open && !c.review && (
                <div className="mt-3 space-y-1.5 border-t border-[#F3F4F6] pt-2">
                    {p.goals.map((g) => (
                        <label key={g.id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 truncate" title={g.title}>{g.title}</span>
                            <input type="number" min={0} max={100} value={prog[g.id]} onChange={(e) => setProg({ ...prog, [g.id]: Number(e.target.value) })} className="w-16 border border-[#E5E7EB] px-1 py-0.5" />%
                        </label>
                    ))}
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What went well, what's blocking" className="w-full border border-[#E5E7EB] px-2 py-1 text-xs" />
                    <button type="button" onClick={sendSelf} className="bg-[#002B5C] text-white px-3 py-1 text-xs">{c.self ? "Update check-in" : "Send check-in"}</button>
                </div>
            )}
            {p.can.review && (open || c.self) && (
                <div className="mt-3 space-y-1.5 border-t border-[#F3F4F6] pt-2">
                    {p.goals.map((g) => (
                        <label key={g.id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 truncate" title={g.title}>{g.title}</span>
                            <select value={st[g.id]} onChange={(e) => setSt({ ...st, [g.id]: e.target.value })} className="border border-[#E5E7EB] px-1 py-0.5">
                                <option value="">—</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                        </label>
                    ))}
                    <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Your comment" className="w-full border border-[#E5E7EB] px-2 py-1 text-xs" />
                    <button type="button" onClick={sendReview} className="bg-[#15803D] text-white px-3 py-1 text-xs">{c.review ? "Update review" : "Save review"}</button>
                </div>
            )}
            </div>
        </div>
    );
}

function YearEnd({ p, onChange }) {
    const ye = p.year_end;
    const [rating, setRating] = useState(ye?.rating || 3);
    const [summary, setSummary] = useState(ye?.summary || "");
    const save = async () => {
        try { onChange(await goalsRate(p.id, { rating: Number(rating), summary })); toast.success("Rating saved — the employee sees it once HR releases ratings."); }
        catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <div className="border-t border-[#E5E7EB] pt-3" data-testid="hrm-year-end">
            <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Year-end review</div>
            {ye?.pending ? <p className="text-sm mt-1">Your manager has written your year-end review. You'll see it once HR releases ratings.</p>
                : ye ? <p className="text-sm mt-1"><b className="text-[#002B5C]">{ye.rating}/5 · {ye.label}</b> — {ye.summary}{!p.released && <span className="block text-xs text-[#6B7280]">Not visible to the employee until HR releases ratings.</span>}</p>
                    : <p className="text-sm mt-1 text-[#6B7280]">{p.rating_open ? "Open for the manager's rating." : "Opens in mid-February."}</p>}
            {p.can.rate && (
                <div className="mt-2 space-y-2">
                    <select value={rating} onChange={(e) => setRating(e.target.value)} className="border border-[#E5E7EB] px-2 py-1.5 text-sm">
                        {Object.entries(p.ratings).reverse().map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}
                    </select>
                    <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Summary of the year (at least 20 characters)" className="w-full border border-[#E5E7EB] px-2 py-1.5 text-sm" />
                    <button type="button" onClick={save} className="bg-[#002B5C] text-white px-4 py-1.5 text-sm">{ye ? "Update rating" : "Save rating"}</button>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ team --- */
function Team({ fy, hr, onOpen }) {
    const [d, setD] = useState(null);
    const load = useCallback(() => goalsTeam(fy).then(setD).catch((e) => toast.error(formatApiError(e))), [fy]);
    useEffect(() => { load(); }, [load]);
    const release = async () => {
        if (!window.confirm(`Release ${fy} ratings? Every employee will see their own year-end rating.`)) return;
        try { await goalsRelease(fy); toast.success("Ratings released."); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!d) return null;
    return (
        <section className="bg-white border border-[#E5E7EB]" data-testid="hrm-goals-team">
            <div className="flex items-center gap-3 px-4 pt-4">
                <h3 className="font-serif text-xl text-[#002B5C] flex-1">{hr ? "Everyone's goals" : "Your team's goals"}</h3>
                {hr && (d.released ? <span className="text-xs text-[#15803D]">Ratings released</span>
                    : <button type="button" onClick={release} className="border border-[#002B5C] text-[#002B5C] px-3 py-1.5 text-xs">Release {fy} ratings</button>)}
            </div>
            <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[#4B5563] border-b border-[#E5E7EB]">
                        <th className="px-4 py-2">Person</th><th className="px-3 py-2">Goals</th><th className="px-3 py-2">Overall</th>
                        {["Q1", "Q2", "Q3", "Q4"].map((q) => <th key={q} className="px-2 py-2">{q}</th>)}<th className="px-3 py-2">Rating</th><th />
                    </tr></thead>
                    <tbody>
                        {d.rows.map((r) => (
                            <tr key={r.emp_id} className={`border-b border-[#F3F4F6] ${r.waiting_for_me ? "bg-[#FFFBEB]" : ""}`}>
                                <td className="px-4 py-2"><div className="text-[#002B5C]">{r.name}</div><div className="text-[11px] text-[#6B7280]">{[r.emp_code, r.department].filter(Boolean).join(" · ")}</div></td>
                                <td className="px-3 py-2 text-xs">{PLAN_STATUS[r.status] || r.status}{r.goals ? ` · ${r.goals}` : ""}</td>
                                <td className="px-3 py-2">{r.overall != null ? `${r.overall}%` : "—"}</td>
                                {["Q1", "Q2", "Q3", "Q4"].map((q) => <td key={q} className="px-2 py-2 text-[11px]">{r.quarters[q] === "reviewed" ? "✓" : r.quarters[q] === "checked in" ? <span className="text-[#B4750F]">to review</span> : "—"}</td>)}
                                <td className="px-3 py-2">{r.rating ? `${r.rating}/5` : "—"}</td>
                                <td className="px-3 py-2 text-right">{r.plan_id && <button type="button" onClick={() => onOpen(r.emp_id)} className="text-xs border border-[#002B5C] px-2 py-1">{r.waiting_for_me ? "Review" : "Open"}</button>}</td>
                            </tr>
                        ))}
                        {!d.rows.length && <tr><td colSpan={9} className="px-4 py-6 text-center text-[#6B7280]">No one yet.</td></tr>}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
