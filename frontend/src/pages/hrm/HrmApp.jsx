import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, Home, Settings2, Users, Plus, X, Send, Search } from "lucide-react";
import {
    hrmMe, hrmPeople, hrmAddPerson, hrmEditPerson, hrmInvite, hrmCalendar, hrmSaveCalendar, hrmSettings, hrmSaveSettings,
    formatApiError,
} from "../../lib/api";
import NoIndex from "../../components/NoIndex";

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
const fyShift = (fy, by) => { const y = Number(fy.slice(0, 4)) + by; return `${y}-${String(y + 1).slice(-2)}`; };

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
    const tabs = [["home", "Home", Home], ...(me.hr || me.manager ? [["people", me.hr ? "People" : "My team", Users]] : []),
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
                {tab === "home" && <HomeTab me={me} />}
                {tab === "people" && <PeopleTab hr={me.hr} />}
                {tab === "calendar" && <CalendarTab hr={me.hr} />}
                {tab === "settings" && me.hr && <SettingsTab />}
            </main>
        </div>
    );
}

/* ------------------------------------------------------------------ home --- */
function HomeTab({ me }) {
    const [cal, setCal] = useState(null);
    useEffect(() => { hrmCalendar().then(setCal).catch(() => {}); }, []);
    const p = me.me;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = (cal?.rows || []).filter((r) => r.date >= today).slice(0, 5);
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <Card title={p ? `Hi ${p.name.split(" ")[0]}` : "Super admin"}>
                {p ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <Field k="Designation" v={p.designation} /><Field k="Department" v={p.department} />
                        <Field k="Reports to" v={me.manager_name} /><Field k="Joined" v={fmt(p.joined_on)} />
                        <Field k="Status" v={p.confirmed_on ? `Confirmed ${fmt(p.confirmed_on)}` : "On probation"} />
                        {(me.hr || me.manager) && <Field k={me.hr ? "People" : "Your team"} v={String(me.team_size)} />}
                    </dl>
                ) : <p className="text-sm text-[#4B5563]">You see everything as a site super admin. Add yourself under People to get your own leave and goals.</p>}
                <p className="mt-4 text-xs text-[#6B7280]">Leave, goals and hiring arrive in the next releases.</p>
            </Card>
            <Card title={`Upcoming holidays · ${cal?.fy || ""}`}>
                {!cal ? <p className="text-sm text-[#6B7280]">Loading…</p> : upcoming.length ? (
                    <ul className="divide-y divide-[#F3F4F6] text-sm">
                        {upcoming.map((r) => (
                            <li key={r.date} className="py-2 flex justify-between gap-3">
                                <span>{r.name}{r.kind === "optional" && <span className="ml-2 text-[10px] uppercase tracking-wider text-[#B4750F]">optional</span>}</span>
                                <span className="text-[#4B5563] whitespace-nowrap">{fmt(r.date)}</span>
                            </li>
                        ))}
                    </ul>
                ) : <p className="text-sm text-[#6B7280]">No more holidays listed this year.</p>}
                {cal && <p className="mt-3 text-xs text-[#6B7280]">Weekly off: {weeklyOffText(cal.weekly_off)}.</p>}
            </Card>
        </div>
    );
}

/* ---------------------------------------------------------------- people --- */
const EMPTY = { name: "", work_email: "", phone: "", emp_code: "", designation: "", department: "", location: "",
    manager_id: "", joined_on: "", confirmed_on: "", gender: "", hr_access: false };

function PeopleTab({ hr }) {
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
    if (!rows) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    return (
        <div className="space-y-4">
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
            {edit && <PersonForm person={edit === "new" ? null : edit} people={rows} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
            <div className="bg-white border border-[#E5E7EB] overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-[#4B5563] border-b border-[#E5E7EB]">
                        <th className="px-3 py-2">Name</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Reports to</th>
                        <th className="px-3 py-2 whitespace-nowrap">Joined</th><th className="px-3 py-2">Status</th>{hr && <th className="px-3 py-2" />}
                    </tr></thead>
                    <tbody>
                        {shown.map((r) => (
                            <tr key={r.id} className="border-b border-[#F3F4F6] align-top">
                                <td className="px-3 py-2">
                                    <div className="text-[#002B5C]">{r.name}{r.hr_access && <span className="ml-2 text-[10px] uppercase tracking-wider text-[#B4750F]">HR</span>}</div>
                                    <div className="text-[11px] text-[#6B7280]">{[r.designation, r.work_email].filter(Boolean).join(" · ")}</div>
                                </td>
                                <td className="px-3 py-2 text-[#4B5563]">{r.department || "—"}</td>
                                <td className="px-3 py-2 text-[#4B5563]">{r.manager_name || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{fmt(r.joined_on)}</td>
                                <td className="px-3 py-2 text-xs">
                                    {r.status === "exited" ? <span className="text-[#6B7280]">Left</span> : r.confirmed_on ? "Confirmed" : <span className="text-[#B4750F]">Probation</span>}
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
                        {!shown.length && <tr><td colSpan={hr ? 6 : 5} className="px-3 py-8 text-center text-[#6B7280]">{rows.length ? "No one matches." : hr ? "No one yet — add your first person." : "No one in your team yet."}</td></tr>}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-[#6B7280]">Only work details are kept here — no ID numbers, documents or bank details.</p>
        </div>
    );
}

function PersonForm({ person, people, onClose, onSaved }) {
    const [f, setF] = useState(() => ({ ...EMPTY, ...(person || {}), manager_id: person?.manager_id || "" }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const set = (k) => (e) => { setError(""); setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }); };
    const managers = people.filter((p) => p.status === "active" && p.id !== person?.id);
    // Checked here as well as on the server, so the problem shows next to the
    // field instead of only in a corner pop-up (the date boxes follow the
    // BROWSER's order — mm/dd/yyyy on many laptops — which is easy to misread).
    const dateError = f.joined_on && f.confirmed_on && f.confirmed_on < f.joined_on
        ? `Confirmed on (${fmt(f.confirmed_on)}) is before Joined on (${fmt(f.joined_on)}).` : "";
    const save = async (e) => {
        e.preventDefault();
        if (dateError) { setError(dateError); return; }
        setBusy(true);
        const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, f[k]]));
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
        <form onSubmit={save} className="bg-white border border-[#002B5C] p-4" data-testid="hrm-person-form">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-serif text-xl text-[#002B5C]">{person ? `Edit ${person.name}` : "Add a person"}</h2>
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
                <label>Confirmed on <span className="text-[11px] text-[#6B7280]">(blank = on probation, no leave yet)</span>
                    <input type="date" value={f.confirmed_on || ""} onChange={set("confirmed_on")} className={`${inp} ${dateError ? "border-[#CC0033]" : ""}`} />{said(f.confirmed_on)}
                </label>
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
    );
}

/* -------------------------------------------------------------- calendar --- */
function CalendarTab({ hr }) {
    const [cal, setCal] = useState(null);
    const [fy, setFy] = useState("");
    const [rows, setRows] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const load = useCallback((y) => hrmCalendar(y).then((c) => { setCal(c); setFy(c.fy); setRows(c.rows); setDirty(false); })
        .catch((e) => toast.error(formatApiError(e))), []);
    useEffect(() => { load(); }, [load]);
    if (!cal) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    const upd = (i, k, v) => { setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(true); };
    const save = async () => {
        setBusy(true);
        try { const r = await hrmSaveCalendar(fy, rows.filter((x) => x.date && x.name)); setRows(r.rows); setDirty(false); toast.success("Calendar saved."); load(fy); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const go = (by) => { if (dirty && !window.confirm("Discard unsaved changes?")) return; load(fyShift(fy, by)); };
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => go(-1)} className="border border-[#E5E7EB] bg-white px-2 py-1 text-sm" aria-label="Previous year">‹</button>
                <h2 className="font-serif text-2xl text-[#002B5C]">FY {fy}</h2>
                <button type="button" onClick={() => go(1)} className="border border-[#E5E7EB] bg-white px-2 py-1 text-sm" aria-label="Next year">›</button>
                <span className="text-sm text-[#4B5563]">{fmt(cal.start)} – {fmt(cal.end)} · {cal.working_days} working days · weekly off: {weeklyOffText(cal.weekly_off)}</span>
            </div>
            <div className="bg-white border border-[#E5E7EB]">
                {rows.length === 0 && <p className="px-4 py-6 text-sm text-[#6B7280]">No holidays listed for {fy} yet.</p>}
                <ul className="divide-y divide-[#F3F4F6]">
                    {rows.map((r, i) => (
                        <li key={i} className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
                            {hr ? (
                                <>
                                    <input type="date" value={r.date} min={cal.start} max={cal.end} onChange={(e) => upd(i, "date", e.target.value)} className="border border-[#E5E7EB] px-2 py-1" aria-label="Date" />
                                    <input value={r.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="Holiday name" className="flex-1 min-w-[160px] border border-[#E5E7EB] px-2 py-1" aria-label="Name" />
                                    <select value={r.kind} onChange={(e) => upd(i, "kind", e.target.value)} className="border border-[#E5E7EB] px-2 py-1" aria-label="Kind">
                                        <option value="national">Company holiday</option><option value="optional">Optional holiday</option>
                                    </select>
                                    <button type="button" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }} aria-label="Remove" className="text-[#CC0033]"><X size={16} /></button>
                                </>
                            ) : (
                                <>
                                    <span className="w-28 text-[#4B5563]">{fmt(r.date)}</span>
                                    <span className="flex-1">{r.name}</span>
                                    {r.kind === "optional" && <span className="text-[10px] uppercase tracking-wider text-[#B4750F]">optional</span>}
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
            {hr && (
                <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => { setRows([...rows, { date: "", name: "", kind: "national" }]); setDirty(true); }}
                        className="inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-3 py-2 text-sm"><Plus size={14} />Add holiday</button>
                    <button type="button" disabled={!dirty || busy} onClick={save} className="bg-[#002B5C] text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? "Saving…" : "Save calendar"}</button>
                    <span className="text-xs text-[#6B7280]">Optional holidays: each person may take 1 per year (from release 2).</span>
                </div>
            )}
        </div>
    );
}

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

function Field({ k, v }) {
    return (<div><dt className="text-[11px] uppercase tracking-wider text-[#6B7280]">{k}</dt><dd className="text-[#002B5C]">{v || "—"}</dd></div>);
}
