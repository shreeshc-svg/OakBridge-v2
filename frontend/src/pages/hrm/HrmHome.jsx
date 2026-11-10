import React, { useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, Target, Users, Briefcase, PartyPopper, ChevronRight } from "lucide-react";
import { hrmCalendar, hrmPeople, leaveSummary, leaveTeam, leaveApprovals, goalsPlan } from "../../lib/api";
import { BalanceCards, Approvals } from "./HrmLeave";
import { Avatar, PhotoPicker, Ring } from "./HrmBits";

/**
 * HRM Home (Nov 2026 refresh). Built around what an employee opens it for:
 * "how much leave do I have, what's coming up, what do I need to do" — first
 * and in colour. HR / managers get their extra blocks below their own.
 * Data is the same endpoints as before; nothing here decides access.
 */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const days = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const fmt = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const LTYPE = { CL: "Casual leave", SL: "Sick leave", EL: "Earned leave", MAT: "Maternity", PAT: "Paternity", BER: "Bereavement",
    OPT: "Optional holiday", COMP: "Comp-off", LOP: "Loss of pay" };

export default function HomeTab({ me, go }) {
    const [cal, setCal] = useState(null);
    const [s, setS] = useState(null);
    const [goals, setGoals] = useState(null);
    const [off, setOff] = useState(null);
    const [people, setPeople] = useState(null);
    const [waiting, setWaiting] = useState(null);
    const today = iso(new Date());
    useEffect(() => {
        hrmCalendar().then(setCal).catch(() => {});
        if (me.me) { leaveSummary().then(setS).catch(() => {}); goalsPlan().then(setGoals).catch(() => {}); }
        if (me.hr || me.manager) {
            leaveTeam(today, plus(today, 6)).then((r) => setOff(r.rows || [])).catch(() => setOff([]));
            leaveApprovals().then(setWaiting).catch(() => setWaiting([]));
        }
        if (me.hr) hrmPeople().then(setPeople).catch(() => setPeople([]));
    }, [me, today]);

    const p = me.me;
    const nextHol = (cal?.rows || []).find((r) => r.date >= today && r.kind !== "optional");
    const checkinDue = goals?.status === "approved" ? (goals.open_quarters || []).find((q) => !goals.checkins?.[q]?.self) : null;
    const goalsTodo = goals && (goals.status === "draft" || goals.status === "returned") ? (goals.goals?.length ? "Submit your goals" : "Set your goals") : checkinDue ? `${checkinDue} check-in due` : "";
    // "Coming up": my leave + holidays, next 60 days, in date order.
    const coming = [
        ...(s?.requests || []).filter((r) => r.type !== "COMP_EARN" && ["approved", "pending"].includes(r.status) && r.end >= today && r.start <= plus(today, 60))
            .map((r) => ({ date: r.start < today ? today : r.start, title: LTYPE[r.type] || r.type, sub: `${r.days} day(s)${r.start !== r.end ? ` · until ${fmt(r.end)}` : ""}`, tone: r.status === "pending" ? "amber" : "green", tag: r.status === "pending" ? "waiting approval" : "approved" })),
        ...(cal?.rows || []).filter((h) => h.date >= today && h.date <= plus(today, 60) && (h.kind !== "special" || h.for_me !== false))
            .map((h) => ({ date: h.date, title: h.name, sub: h.kind === "optional" ? "optional holiday — take it as your 1 a year" : h.kind === "special" ? "special day off" : "office closed", tone: h.kind === "optional" ? "violet" : "navy" })),
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    const offToday = (off || []).filter((r) => r.start <= today && today <= r.end && r.status === "approved");

    return (
        <div className="space-y-6" data-testid="hrm-home">
            {/* ---------- hero ---------- */}
            <section className="relative overflow-hidden text-white p-5 sm:p-6" style={{ background: "linear-gradient(120deg,#002B5C 0%,#0B4A8B 60%,#1E6FB8 100%)" }}>
                <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/5" aria-hidden="true" />
                <div className="absolute right-24 -bottom-16 w-40 h-40 rounded-full bg-[#F5B841]/10" aria-hidden="true" />
                <div className="relative flex flex-wrap items-center gap-5">
                    {p && <HeroPhoto p={p} />}
                    <div className="flex-1 min-w-[220px]">
                        <div className="text-white/70 text-sm">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
                        <h1 className="font-serif text-3xl sm:text-4xl mt-0.5">{greet()}, {p ? p.name.split(" ")[0] : "admin"}</h1>
                        {p ? (
                            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                                {[p.designation, p.department, p.emp_code && `Emp ID ${p.emp_code}`].filter(Boolean).map((t) => <span key={t} className="bg-white/15 px-2 py-0.5">{t}</span>)}
                                {!p.confirmed_on && <span className="bg-[#F5B841] text-[#002B5C] px-2 py-0.5 font-medium">On probation</span>}
                            </div>
                        ) : <p className="text-sm text-white/80 mt-1">Site super admin — add yourself under People to get your own leave and goals.</p>}
                        {p && me.manager_name && <div className="mt-2 text-xs text-white/70">Reports to {me.manager_name}</div>}
                    </div>
                    {nextHol && (
                        <div className="bg-white/10 border border-white/20 px-4 py-3 text-center min-w-[150px]" data-testid="hrm-next-holiday">
                            <PartyPopper size={18} className="mx-auto text-[#F5B841]" aria-hidden="true" />
                            <div className="font-serif text-3xl leading-none mt-1">{days(today, nextHol.date) === 0 ? "Today" : days(today, nextHol.date)}</div>
                            <div className="text-[11px] text-white/70">{days(today, nextHol.date) === 0 ? "" : days(today, nextHol.date) === 1 ? "day to" : "days to"} {nextHol.name}</div>
                        </div>
                    )}
                </div>
                {/* quick actions */}
                <div className="relative mt-5 flex flex-wrap gap-2">
                    {p && <Action icon={CalendarCheck} label="Apply for leave" onClick={() => go("leave")} primary testid="hrm-home-apply" />}
                    {p && <Action icon={Target} label={goalsTodo || "My goals"} onClick={() => go("goals")} badge={!!goalsTodo} />}
                    <Action icon={CalendarDays} label="Calendar" onClick={() => go("calendar")} />
                    {(me.hr || me.manager) && <Action icon={Users} label={me.hr ? "People" : "My team"} onClick={() => go("people")} />}
                    {me.hiring && <Action icon={Briefcase} label="Hiring" onClick={() => go("hiring")} />}
                </div>
            </section>

            {/* ---------- HR at a glance ---------- */}
            {me.hr && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="hrm-hr-kpis">
                    <Kpi label="People" value={people ? people.length : "…"} onClick={() => go("people")} accent="#002B5C" />
                    <Kpi label="Off today" value={off ? offToday.length : "…"} onClick={() => go("calendar")} accent="#0EA5A4" />
                    <Kpi label="Waiting approval" value={waiting ? waiting.length : "…"} onClick={() => go("leave")} accent="#D97706" hot={!!waiting?.length} />
                    <Kpi label="On probation" value={people ? people.filter((x) => !x.confirmed_on).length : "…"} onClick={() => go("people")} accent="#7C3AED" />
                    <Kpi label="No login yet" value={people ? people.filter((x) => !x.user_id).length : "…"} onClick={() => go("people")} accent="#E11D48" hot={!!people?.some((x) => !x.user_id)} />
                </div>
            )}

            {/* ---------- my leave ---------- */}
            {p && (
                <section>
                    <div className="flex items-end justify-between mb-2">
                        <h2 className="font-serif text-2xl text-[#002B5C]">Your leave <span className="text-sm font-sans text-[#6B7280]">· {s?.fy || ""}</span></h2>
                        <button type="button" onClick={() => go("leave")} className="text-xs text-[#002B5C] inline-flex items-center">Details<ChevronRight size={14} /></button>
                    </div>
                    {s ? <BalanceCards s={s} /> : <Skeleton />}
                </section>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
                {/* coming up */}
                <section className={`bg-white border border-[#E5E7EB] p-4 ${p ? "lg:col-span-2" : "lg:col-span-3"}`}>
                    <h2 className="font-serif text-xl text-[#002B5C] mb-3">Coming up</h2>
                    {!cal ? <Skeleton rows={3} /> : coming.length ? (
                        <ul className="space-y-2.5">
                            {coming.map((c, i) => (
                                <li key={i} className="flex items-center gap-3">
                                    <DateBadge date={c.date} tone={c.tone} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm text-[#002B5C] font-medium truncate">{c.title}</div>
                                        <div className="text-xs text-[#6B7280] truncate">{c.sub}{c.tag ? ` · ${c.tag}` : ""}</div>
                                    </div>
                                    <span className="text-[11px] text-[#6B7280] whitespace-nowrap">{days(today, c.date) === 0 ? "today" : `in ${days(today, c.date)}d`}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-sm text-[#6B7280]">Nothing in the next two months.</p>}
                </section>
                {/* goals */}
                {p && (
                    <section className="bg-white border border-[#E5E7EB] p-4 flex flex-col">
                        <h2 className="font-serif text-xl text-[#002B5C] mb-3">Your goals <span className="text-sm font-sans text-[#6B7280]">· {goals?.fy || ""}</span></h2>
                        {!goals ? <Skeleton rows={2} /> : goals.goals?.length ? (
                            <div className="flex items-center gap-4">
                                <Ring value={goals.overall || 0} max={100} color="#002B5C" size={88} label={`${goals.overall ?? 0}%`} />
                                <div className="text-sm">
                                    <div className="text-[#002B5C] font-medium">{goals.goals.length} goal{goals.goals.length === 1 ? "" : "s"}</div>
                                    <div className="text-xs text-[#6B7280]">{{ draft: "Draft", submitted: "With your manager", returned: "Sent back — update", approved: "Approved" }[goals.status]}</div>
                                    {checkinDue && <div className="mt-1 text-xs bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 inline-block">{checkinDue} check-in due</div>}
                                </div>
                            </div>
                        ) : <p className="text-sm text-[#6B7280]">No goals for {goals.fy} yet — set 3 to 6 with your manager.</p>}
                        <button type="button" onClick={() => go("goals")} className="mt-auto pt-3 text-xs text-[#002B5C] inline-flex items-center self-start">Open goals<ChevronRight size={14} /></button>
                    </section>
                )}
            </div>

            {(me.hr || me.manager) && (
                <div className="grid gap-4 md:grid-cols-2">
                    <section className="bg-white border border-[#E5E7EB] p-4">
                        <h2 className="font-serif text-xl text-[#002B5C] mb-2">Waiting for you{waiting?.length ? ` (${waiting.length})` : ""}</h2>
                        <Approvals hr={me.hr} compact onChange={() => leaveApprovals().then(setWaiting).catch(() => {})} />
                    </section>
                    <section className="bg-white border border-[#E5E7EB] p-4">
                        <h2 className="font-serif text-xl text-[#002B5C] mb-2">{me.hr ? "Who's off this week" : "Your team this week"}</h2>
                        {!off ? <Skeleton rows={2} /> : off.length ? (
                            <ul className="divide-y divide-[#F3F4F6] text-sm">
                                {off.slice(0, 8).map((r) => (
                                    <li key={r.id} className="py-1.5 flex justify-between gap-2">
                                        <span>{r.name} <span className="text-[#6B7280]">· {r.label}{r.status === "pending" ? " (pending)" : ""}</span></span>
                                        <span className="text-[#4B5563] whitespace-nowrap">{r.start === r.end ? fmt(r.start) : `${fmt(r.start)} – ${fmt(r.end)}`}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-sm text-[#6B7280]">Everyone's in.</p>}
                    </section>
                </div>
            )}
        </div>
    );
}

function HeroPhoto({ p }) {
    const [cur, setCur] = useState(p);
    return (
        <div className="flex flex-col items-center gap-1">
            <div className="ring-4 ring-white/25"><Avatar p={cur} size={84} /></div>
            <span className="text-white/80 [&_button]:text-white"><PhotoPicker p={cur} onChanged={(at) => setCur({ ...cur, photo_at: at })} /></span>
        </div>
    );
}

function Action({ icon: I, label, onClick, primary = false, badge = false, testid }) {
    return (
        <button type="button" onClick={onClick} data-testid={testid}
            className={`relative inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium transition-colors ${primary ? "bg-[#F5B841] text-[#002B5C] hover:bg-[#FFD27A]" : "bg-white/10 text-white hover:bg-white/20 border border-white/20"}`}>
            <I size={16} aria-hidden="true" />{label}
            {badge && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#F5B841] ring-2 ring-[#0B4A8B]" aria-hidden="true" />}
        </button>
    );
}

function Kpi({ label, value, onClick, accent, hot = false }) {
    return (
        <button type="button" onClick={onClick} className="text-left bg-white border border-[#E5E7EB] hover:shadow-md transition-shadow p-3" style={{ borderTop: `3px solid ${accent}` }}>
            <div className="text-[10px] uppercase tracking-wider text-[#6B7280]">{label}</div>
            <div className="font-serif text-3xl leading-tight" style={{ color: hot ? accent : "#002B5C" }}>{value}</div>
        </button>
    );
}

const TONES = { navy: ["#002B5C", "#fff"], violet: ["#EDE9FE", "#5B21B6"], green: ["#DCFCE7", "#166534"], amber: ["#FEF3C7", "#92400E"] };
function DateBadge({ date, tone }) {
    const [bg, fg] = TONES[tone] || TONES.navy;
    const d = new Date(`${date}T00:00:00`);
    return (
        <div className="w-12 text-center py-1 shrink-0" style={{ background: bg, color: fg }}>
            <div className="text-[10px] uppercase tracking-wider leading-none">{d.toLocaleDateString("en-IN", { month: "short" })}</div>
            <div className="font-serif text-xl leading-tight">{d.getDate()}</div>
        </div>
    );
}

function Skeleton({ rows = 1 }) {
    return <div className="space-y-2" aria-hidden="true">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-10 bg-[#F3F4F6] animate-pulse" />)}</div>;
}
