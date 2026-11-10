import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, CalendarCheck, Home, Settings2, Users, Plus, X, Send, Search, Target, Briefcase } from "lucide-react";
import {
    hrmMe, hrmPeople, hrmAddPerson, hrmEditPerson, hrmInvite, hrmConfirmAll, hrmSettings, hrmSaveSettings,
    formatApiError,
} from "../../lib/api";
import NoIndex from "../../components/NoIndex";
import HrmCalendar from "./HrmCalendar";
import LeaveTab from "./HrmLeave";
import GoalsTab from "./HrmGoals";
import HiringTab, { LifecyclePanel, ChecklistSettings } from "./HrmHiring";
import HomeTab from "./HrmHome";
import { Avatar, PhotoPicker } from "./HrmBits";

/**
 * Oakbridge HRM — release 1 (Nov 2026): people, logins, leave year, calendar.
 *
 * One screen for everyone; what it SHOWS follows what the server allows
 * (backend/hrm.py → hr_core.access_of): an employee sees themselves, a
 * manager their team, HR / founders everyone and the setup tabs. Hiding a tab
 * here is convenience only — every endpoint checks again.
 *
 * Leave (release 2), goals (3) and hiring / exit (4) slot in as more tabs.
 */
const NAVY = "#002B5C";
const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th"];
const weeklyOffText = (w) => {
    if (!w) return "";
    const parts = (w.weekdays || []).map((d) => `every ${DAY_NAMES[d]}`);
    if ((w.saturdays || []).length) parts.push(`${w.saturdays.map((n) => ORD[n]).join(" & ")} Saturday`);
    return parts.join(" + ") || "none";
};

export default function HrmApp() {
    const [me, setMe] = useState(null);
    const [err, setErr] = useState("");
    const [tab, setTab] = useState("home");
    useEffect(() => { hrmMe().then(setMe).catch((e) => setErr(formatApiError(e))); }, []);

    if (err) {
        return (
            <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center px-6">
                <NoIndex title="HRM" />
                <div className="max-w-md text-center">
                    <h1 className="font-serif text-3xl text-[#002B5C]">Oakbridge HRM</h1>
                    <p className="mt-3 text-[#4B5563]">{err}</p>
                    <Link to="/" className="mt-6 inline-block underline text-sm text-[#4B5563]">Back to the website</Link>
                </div>
            </div>
        );
    }
    if (!me) return <div className="py-32 text-center font-mono text-xs text-[#4B5563]">Loading…</div>;

    const role = me.hr ? "HR / Founder" : me.manager ? "Manager" : "Employee";
    const tabs = [["home", "Home", Home], ["leave", "Leave", CalendarCheck], ["goals", "Goals", Target], ...(me.hr || me.manager ? [["people", me.hr ? "People" : "My team", Users]] : []),
        ...(me.hiring ? [["hiring", "Hiring", Briefcase]] : []),
        ["calendar", "Calendar", CalendarDays], ...(me.hr ? [["settings", "Settings", Settings2]] : [])];

    return (
        <div className="min-h-screen bg-[#F5F7FA]" data-testid="hrm-app">
            <NoIndex title="HRM" />
            <header className="bg-[#002B5C] text-white">
                <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
                    <div className="font-serif text-xl flex-1">Oakbridge <span className="text-[#F5B841]">HRM</span></div>
                    <span className="text-xs text-white/80 hidden sm:inline">{me.me?.name || "Super admin"}</span>
                    <span className="text-[10px] font-mono tracking-widest border border-white/40 px-2 py-0.5 uppercase">{role}</span>
                </div>
                <nav className="max-w-5xl mx-auto px-2 flex gap-1 overflow-x-auto" aria-label="HRM sections">
                    {tabs.map(([k, l, I]) => (
                        <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}
                            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 ${tab === k ? "border-[#F5B841] text-white" : "border-transparent text-white/70 hover:text-white"}`}>
                            <I size={15} aria-hidden="true" />{l}
                        </button>
                    ))}
                </nav>
            </header>
            <main className="max-w-5xl mx-auto px-4 py-6">
                {tab === "home" && <HomeTab me={me} go={setTab} />}
                {tab === "leave" && <LeaveTab me={me} />}
                {tab === "goals" && <GoalsTab me={me} />}
                {tab === "hiring" && me.hiring && <HiringTab />}
                {tab === "people" && <PeopleTab hr={me.hr} superadmin={me.superadmin} />}
                {tab === "calendar" && <HrmCalendar hr={me.hr} manager={me.manager} />}
                {tab === "settings" && me.hr && <><SettingsTab /><ChecklistSettings /></>}
            </main>
        </div>
    );
}

/* ---------------------------------------------------------------- people --- */
const EMPTY = { name: "", work_email: "", phone: "", emp_code: "", designation: "", department: "", location: "",
    manager_id: "", joined_on: "", confirmed_on: "", gender: "", hr_access: false };

function PeopleTab({ hr, superadmin }) {
    const [rows, setRows] = useState(null);
    const [q, setQ] = useState("");
    const [edit, setEdit] = useState(null);   // null | "new" | person
    const [showExited, setShowExited] = useState(false);
    const load = useCallback(() => hrmPeople(showExited).then(setRows).catch((e) => toast.error(formatApiError(e))), [showExited]);
    useEffect(() => { load(); }, [load]);
    const shown = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (rows || []).filter((r) => !t || [r.name, r.work_email, r.department, r.designation, r.emp_code, r.manager_name]
            .some((f) => (f || "").toLowerCase().includes(t)));
    }, [rows, q]);
    const invite = async (r) => {
        if (!window.confirm(`Send ${r.name} their HRM login at ${r.work_email}?`)) return;
        try {
            const res = await hrmInvite(r.id);
            toast.success(res.account_created ? "Login created — a set-password email is on its way." : "They already have an account — emailed where to sign in.");
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };
    const unconfirmed = (rows || []).filter((r) => r.status === "active" && !r.confirmed_on);
    const confirmAll = async () => {
        if (!window.confirm(`Mark ${unconfirmed.length} person(s) as confirmed (not on probation)?\n\nTheir confirmation date becomes their joining date, so earned leave counts from when they joined. Anyone really on probation: untick them afterwards in Edit.`)) return;
        try { const r = await hrmConfirmAll(); toast.success(`${r.confirmed} marked confirmed.`); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!rows) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    return (
        <div className="space-y-4">
            {hr && unconfirmed.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 border border-[#E7B64B] bg-[#FFFBEB] px-3 py-2 text-sm" data-testid="hrm-confirm-all">
                    <span className="flex-1">{unconfirmed.length} person(s) show as <b>on probation</b> because no confirmation date is set — so they get no paid leave.</span>
                    <button type="button" onClick={confirmAll} className="bg-[#002B5C] text-white px-3 py-1.5 text-sm">Mark all confirmed</button>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" aria-hidden="true" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, department…"
                        className="w-full border border-[#E5E7EB] bg-white pl-9 pr-3 py-2 text-sm" aria-label="Search people" />
                </div>
                {hr && <label className="text-xs text-[#4B5563] flex items-center gap-1.5"><input type="checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} />Show people who left</label>}
                {hr && (
                    <button type="button" onClick={() => setEdit("new")} data-testid="hrm-add"
                        className="inline-flex items-center gap-1.5 bg-[#002B5C] text-white px-3 py-2 text-sm"><Plus size={14} />Add person</button>
                )}
            </div>
            {edit && <PersonForm person={edit === "new" ? null : edit} people={rows} superadmin={superadmin} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
            <div className="bg-white border border-[#E5E7EB] overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[#4B5563] border-b border-[#E5E7EB]">
                        <th className="px-3 py-2">Name</th><th className="px-3 py-2 whitespace-nowrap">Emp ID</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Reports to</th>
                        <th className="px-3 py-2 whitespace-nowrap">Joined</th><th className="px-3 py-2">Status</th>{hr && <th className="px-3 py-2" />}
                    </tr></thead>
                    <tbody>
                        {shown.map((r) => (
                            <tr key={r.id} className="border-b border-[#F3F4F6] align-top">
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2.5">
                                        <Avatar p={r} />
                                        <div className="min-w-0">
                                            <div className="text-[#002B5C]">{r.name}{r.hr_access && <span className="ml-2 text-[10px] uppercase tracking-wider text-[#B4750F]">HR</span>}</div>
                                            <div className="text-[11px] text-[#6B7280]">{[r.designation, r.work_email].filter(Boolean).join(" · ")}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-[#4B5563]">{r.emp_code || "—"}</td>
                                <td className="px-3 py-2 text-[#4B5563]">{r.department || "—"}</td>
                                <td className="px-3 py-2 text-[#4B5563]">{r.manager_name || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{fmt(r.joined_on)}</td>
                                <td className="px-3 py-2 text-xs">
                                    {r.status === "exited" ? <span className="text-[#6B7280]">Left {fmt(r.exited_on)}</span>
                                        : r.exited_on ? <span className="text-[#CC0033]">Leaving {fmt(r.exited_on)}</span>
                                            : r.confirmed_on ? "Confirmed" : <span className="text-[#B4750F]">Probation</span>}
                                    {hr && r.status === "active" && <div className="text-[11px] text-[#6B7280]">{r.user_id ? (r.invited_at ? "Login sent" : "Has a login") : "No login yet"}</div>}
                                </td>
                                {hr && (
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        <button type="button" onClick={() => setEdit(r)} className="text-xs border border-[#002B5C] px-2 py-1 mr-2">Edit</button>
                                        {r.status === "active" && (
                                            <button type="button" onClick={() => invite(r)} title="Email their HRM login" className="inline-flex items-center gap-1 text-xs underline">
                                                <Send size={12} />{r.invited_at ? "Resend login" : "Send login"}
                                            </button>
                                        )}
                                    </td>
                                )}
                            </tr>
                        ))}
                        {!shown.length && <tr><td colSpan={hr ? 7 : 6} className="px-3 py-8 text-center text-[#6B7280]">{rows.length ? "No one matches." : hr ? "No one yet — add your first person." : "No one in your team yet."}</td></tr>}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-[#6B7280]">Only work details are kept here — no ID numbers, documents or bank details.</p>
        </div>
    );
}

function PersonForm({ person, people, superadmin, onClose, onSaved }) {
    const [f, setF] = useState(() => ({ ...EMPTY, ...(person || {}), manager_id: person?.manager_id || "" }));
    // Confirmed is the normal case: new people default to confirmed, and a
    // confirmed person with no date is confirmed from their joining date.
    const [confirmed, setConfirmed] = useState(person ? !!person.confirmed_on : true);
    // Super admin only: this person's own weekly off (null = the company's).
    const [ownOff, setOwnOff] = useState(person?.weekly_off || null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const set = (k) => (e) => { setError(""); setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }); };
    const managers = people.filter((p) => p.status === "active" && p.id !== person?.id);
    // Checked here as well as on the server, so the problem shows next to the
    // field instead of only in a corner pop-up (the date boxes follow the
    // BROWSER's order — mm/dd/yyyy on many laptops — which is easy to misread).
    const dateError = confirmed && f.joined_on && f.confirmed_on && f.confirmed_on < f.joined_on
        ? `Confirmed on (${fmt(f.confirmed_on)}) is before Joined on (${fmt(f.joined_on)}).` : "";
    const save = async (e) => {
        e.preventDefault();
        if (dateError) { setError(dateError); return; }
        setBusy(true);
        const body = { ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, f[k]])), ...(superadmin ? { weekly_off: ownOff || {} } : {}),
            confirmed_on: confirmed ? (f.confirmed_on || f.joined_on) : "" };
        try {
            if (person) await hrmEditPerson(person.id, body); else await hrmAddPerson(body);
            toast.success(person ? "Saved." : `${f.name} added. Use “Send login” when they should get access.`);
            onSaved();
        } catch (er) { const m = formatApiError(er); setError(m); toast.error(m); } finally { setBusy(false); }
    };
    const inp = "mt-1 w-full border border-[#E5E7EB] px-2 py-1.5 text-sm bg-white";
    // The date in words under each date box: "= 6 Jan 2026" — no day/month mix-ups.
    const said = (d) => (d ? <span className="block mt-0.5 text-[11px] text-[#15803D]" data-testid="hrm-date-words">= {fmt(d)}</span> : null);
    return (
        <>
        <form onSubmit={save} className="bg-white border border-[#002B5C] p-4" data-testid="hrm-person-form">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    {person && <PersonPhoto person={person} />}
                    <h2 className="font-serif text-xl text-[#002B5C]">{person ? `Edit ${person.name}` : "Add a person"}</h2>
                </div>
                <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <label>Full name *<input required value={f.name} onChange={set("name")} className={inp} /></label>
                <label>Work email * <span className="text-[11px] text-[#6B7280]">(their login)</span><input required type="email" value={f.work_email} onChange={set("work_email")} className={inp} /></label>
                <label>Phone<input value={f.phone || ""} onChange={set("phone")} className={inp} /></label>
                <label>Employee code<input value={f.emp_code || ""} onChange={set("emp_code")} className={inp} /></label>
                <label>Designation<input value={f.designation || ""} onChange={set("designation")} className={inp} /></label>
                <label>Department<input value={f.department || ""} onChange={set("department")} className={inp} list="hrm-depts" /></label>
                <datalist id="hrm-depts">{[...new Set(people.map((p) => p.department).filter(Boolean))].map((d) => <option key={d} value={d} />)}</datalist>
                <label>Location<input value={f.location || ""} onChange={set("location")} className={inp} placeholder="Office / Warehouse" /></label>
                <label>Reports to
                    <select value={f.manager_id} onChange={set("manager_id")} className={inp}>
                        <option value="">— nobody (top) —</option>
                        {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                </label>
                <label>Gender <span className="text-[11px] text-[#6B7280]">(for maternity / paternity leave)</span>
                    <select value={f.gender || ""} onChange={set("gender")} className={inp}>
                        <option value="">Not set</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
                    </select>
                </label>
                <label>Joined on *<input required type="date" value={f.joined_on || ""} onChange={set("joined_on")} className={inp} />{said(f.joined_on)}</label>
<div>
                    <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="hrm-confirmed" />Confirmed employee <span className="text-[11px] text-[#6B7280]">(untick = on probation, no paid leave)</span></label>
                    {confirmed && (
                        <label className="block mt-1 text-xs">Confirmed on <span className="text-[#6B7280]">(blank = from joining date)</span>
                            <input type="date" value={f.confirmed_on || ""} onChange={set("confirmed_on")} className={`${inp} ${dateError ? "border-[#CC0033]" : ""}`} />{said(f.confirmed_on)}
                        </label>
                    )}
                </div>
                {superadmin && (
                    <fieldset className="sm:col-span-2 lg:col-span-3 border border-[#E5E7EB] p-3" data-testid="hrm-own-weekly-off">
                        <legend className="px-1 text-xs text-[#4B5563]">Weekly off for this person <span className="text-[#6B7280]">(super admin)</span></legend>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!ownOff} onChange={(e) => setOwnOff(e.target.checked ? null : { weekdays: [6], saturdays: [] })} />Same as the company</label>
                        {ownOff && (
                            <div className="mt-2 flex flex-wrap gap-3 text-xs">
                                {DAY_NAMES.map((d, i) => (
                                    <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={ownOff.weekdays.includes(i)}
                                        onChange={() => setOwnOff({ ...ownOff, weekdays: ownOff.weekdays.includes(i) ? ownOff.weekdays.filter((x) => x !== i) : [...ownOff.weekdays, i] })} />{d}</label>
                                ))}
                                {[1, 2, 3, 4, 5].map((k) => (
                                    <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={ownOff.saturdays.includes(k)}
                                        onChange={() => setOwnOff({ ...ownOff, saturdays: ownOff.saturdays.includes(k) ? ownOff.saturdays.filter((x) => x !== k) : [...ownOff.saturdays, k] })} />{ORD[k]} Sat</label>
                                ))}
                            </div>
                        )}
                    </fieldset>
                )}
                <label className="flex items-start gap-2 sm:col-span-2 lg:col-span-3 mt-1">
                    <input type="checkbox" checked={!!f.hr_access} onChange={set("hr_access")} className="mt-1" />
                    <span>HR / Founder access <span className="block text-[11px] text-[#6B7280]">Sees everyone and can change people, the calendar and settings.</span></span>
                </label>
            </div>
            {(error || dateError) && (
                <p role="alert" className="mt-4 border border-[#CC0033] bg-[#FEF2F2] text-[#CC0033] px-3 py-2 text-sm" data-testid="hrm-form-error">{error || dateError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={onClose} className="px-3 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={busy} className="bg-[#002B5C] text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            </div>
            </form>
            {/* Outside the form on purpose: it has its own exit form, and forms can't nest. */}
            {person && <div className="bg-white border border-t-0 border-[#002B5C] px-4 pb-4"><LifecyclePanel person={person} onChange={onSaved} /></div>}
        </>
    );
}

function PersonPhoto({ person }) {
    const [cur, setCur] = useState(person);
    return (
        <div className="flex items-center gap-2">
            <Avatar p={cur} size={48} />
            <PhotoPicker p={cur} onChanged={(at) => setCur({ ...cur, photo_at: at })} />
        </div>
    );
}

/* -------------------------------------------------------------- calendar --- */
/* -------------------------------------------------------------- settings --- */
function SettingsTab() {
    const [w, setW] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { hrmSettings().then((s) => setW(s.weekly_off)).catch((e) => toast.error(formatApiError(e))); }, []);
    if (!w) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    const toggle = (key, v) => setW({ ...w, [key]: w[key].includes(v) ? w[key].filter((x) => x !== v) : [...w[key], v].sort() });
    const save = async () => {
        setBusy(true);
        try { const r = await hrmSaveSettings({ weekly_off: w }); setW(r.weekly_off); toast.success("Saved."); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    return (
        <Card title="Weekly off">
            <p className="text-sm text-[#4B5563]">Days nobody works. Leave never counts these days (except loss of pay and maternity, as the policy says).</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {DAY_NAMES.map((d, i) => (
                    <label key={d} className="flex items-center gap-1.5"><input type="checkbox" checked={w.weekdays.includes(i)} onChange={() => toggle("weekdays", i)} />Every {d}</label>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="flex items-center gap-1.5"><input type="checkbox" checked={w.saturdays.includes(n)} onChange={() => toggle("saturdays", n)} />{ORD[n]} Saturday</label>
                ))}
            </div>
            <p className="mt-3 text-xs text-[#6B7280]">Now: {weeklyOffText(w)}. Leave year: 1 April – 31 March (policy).</p>
            <button type="button" disabled={busy} onClick={save} className="mt-4 bg-[#002B5C] text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </Card>
    );
}

/* ----------------------------------------------------------------- bits --- */
function Card({ title, children }) {
    return (
        <section className="bg-white border border-[#E5E7EB] p-4">
            <h2 className="font-serif text-xl mb-3" style={{ color: NAVY }}>{title}</h2>
            {children}
        </section>
    );
}

