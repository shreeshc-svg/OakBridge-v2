import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Briefcase, Droplet, HeartPulse, Home, Mail, Pencil, Phone, Plus, ShieldCheck, Trash2, User, X } from "lucide-react";
import { profileMe, profileSave, profileOf, formatApiError } from "../../lib/api";
import { Ring, SelfPhoto } from "./HrmBits";

/**
 * HRM → My profile (Nov 2026). The employee keeps their own personal details
 * and emergency contacts up to date — add, change or clear; saves at once.
 * Work details (ID, designation, department, dates) are read-only here:
 * HR manages those. No bank / PAN / Aadhaar by company decision.
 * Server: backend/hrm_profile.py (HR sees all, manager only emergency contacts).
 */
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");
const MARITAL = { single: "Single", married: "Married", divorced: "Divorced", widowed: "Widowed", prefer_not: "Prefer not to say" };
const inp = "mt-1 w-full border border-[#E5E7EB] px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1E6FB8]/40";
const err = (e) => toast.error(formatApiError(e));

export default function ProfileTab({ me }) {
    const [p, setP] = useState(null);
    const load = useCallback(() => profileMe().then(setP).catch(err), []);
    useEffect(() => { load(); }, [load]);
    if (!p) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    const save = async (body, ok = "Saved.") => { try { setP(await profileSave(body)); toast.success(ok); return true; } catch (e) { err(e); return false; } };
    const pct = p.complete;
    return (
        <div className="space-y-5" data-testid="hrm-profile">
            <section className="relative overflow-hidden text-white p-5 sm:p-6" style={{ background: "linear-gradient(120deg,#002B5C 0%,#0B4A8B 60%,#1E6FB8 100%)" }}>
                <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/5" aria-hidden="true" />
                <div className="relative flex flex-wrap items-center gap-5">
                    {me.me && <div className="bg-white/10 p-2"><SelfPhoto p={me.me} /></div>}
                    <div className="flex-1 min-w-[220px]">
                        <h2 className="font-serif text-3xl">{p.name}</h2>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                            {[p.work.designation, p.work.department, p.work.emp_code && `Emp ID ${p.work.emp_code}`].filter(Boolean).map((t) => <span key={t} className="bg-white/15 px-2 py-0.5">{t}</span>)}
                        </div>
                        <div className="mt-2 text-xs text-white/75">{p.work.work_email}{p.manager_name ? ` · reports to ${p.manager_name}` : ""}{p.work.joined_on ? ` · joined ${fmt(p.work.joined_on)}` : ""}</div>
                    </div>
                    <div className="bg-white p-2 text-center" title="How complete your profile is">
                        <Ring value={pct} max={100} color={pct === 100 ? "#0E9F6E" : "#F5B841"} size={84} label={`${pct}%`} />
                        <div className="text-[11px] text-[#4B5563] mt-0.5">{pct === 100 ? "All done ✓" : "complete"}</div>
                    </div>
                </div>
            </section>
            {pct < 100 && <p className="text-sm bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2">Please fill in the missing details — especially an <b>emergency contact</b>. It's only seen by HR (and your manager sees just the emergency contact).</p>}

            <div className="grid gap-5 lg:grid-cols-2">
                <Section icon={Phone} title="Contact" filled={!!(p.phone && p.personal_email)}
                    view={<Rows rows={[["Mobile", p.phone], ["Personal email", p.personal_email]]} />}
                    edit={(done) => <ContactForm p={p} onSave={async (b) => (await save(b)) && done()} />} />
                <Section icon={User} title="Personal" filled={!!(p.dob && p.blood_group && p.marital_status)}
                    view={<Rows rows={[["Date of birth", fmt(p.dob)], ["Blood group", p.blood_group], ["Marital status", MARITAL[p.marital_status]]]} />}
                    edit={(done) => <PersonalForm p={p} onSave={async (b) => (await save(b)) && done()} />} />
                <Section icon={Home} title="Address" filled={!!(p.current_address && p.permanent_address)}
                    view={<Rows rows={[["Current", p.current_address], ["Permanent", p.permanent_address === p.current_address && p.current_address ? "Same as current" : p.permanent_address]]} />}
                    edit={(done) => <AddressForm p={p} onSave={async (b) => (await save(b)) && done()} />} />
                <Section icon={HeartPulse} title="Emergency contacts" filled={!!p.emergency.length}
                    view={p.emergency.length ? <ul className="space-y-2">{p.emergency.map((c) => <Contact key={c.phone} c={c} />)}</ul> : <Empty text="No emergency contact yet — please add one." />}
                    edit={(done) => <EmergencyForm p={p} onSave={async (b) => (await save(b, "Emergency contacts saved.")) && done()} />} />
            </div>

            <section className="bg-white border border-[#E5E7EB] p-4 text-sm">
                <h3 className="font-medium text-[#002B5C] flex items-center gap-2"><Briefcase size={16} />Work details <span className="text-xs font-normal text-[#6B7280]">— managed by HR; ask HR to change these</span></h3>
                <div className="mt-3"><Rows rows={[["Employee ID", p.work.emp_code], ["Designation", p.work.designation], ["Department", p.work.department], ["Work email", p.work.work_email],
                    ["Joined", fmt(p.work.joined_on)], ["Confirmed", p.work.confirmed_on ? fmt(p.work.confirmed_on) : "On probation"]]} /></div>
            </section>
            <p className="text-xs text-[#6B7280] flex items-center gap-1.5"><ShieldCheck size={14} />Only you and HR see your personal details. We don't store bank, PAN or Aadhaar here — those stay with payroll. If you leave, these personal details are deleted automatically one year after your Full &amp; Final settlement.</p>
        </div>
    );
}

function Section({ icon: I, title, view, edit, filled }) {
    const [editing, setEditing] = useState(false);
    return (
        <section className={`bg-white border p-4 transition-shadow hover:shadow-md ${filled ? "border-[#E5E7EB]" : "border-[#FDE68A]"}`}>
            <div className="flex items-center gap-2 mb-3">
                <span className={`w-8 h-8 grid place-items-center rounded-full ${filled ? "bg-[#ECFDF5] text-[#0E9F6E]" : "bg-[#FEF3C7] text-[#B4750F]"}`}><I size={16} /></span>
                <h3 className="font-medium text-[#002B5C] flex-1">{title}</h3>
                {!editing ? <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-sm text-[#002B5C] border border-[#002B5C] px-3 py-1 hover:bg-[#002B5C] hover:text-white transition-colors"><Pencil size={13} />{filled ? "Edit" : "Add"}</button>
                    : <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="text-[#6B7280]"><X size={18} /></button>}
            </div>
            {editing ? edit(() => setEditing(false)) : view}
        </section>
    );
}

function Rows({ rows }) {
    return (
        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => <React.Fragment key={k}><dt className="text-[#6B7280]">{k}</dt><dd className={`whitespace-pre-line ${v ? "text-[#111827]" : "text-[#9CA3AF] italic"}`}>{v || "Not added"}</dd></React.Fragment>)}
        </dl>
    );
}

const Empty = ({ text }) => <p className="text-sm text-[#9CA3AF] italic">{text}</p>;

function Contact({ c }) {
    return (
        <li className="flex items-center gap-3 bg-[#F5F7FA] px-3 py-2">
            <span className="w-9 h-9 grid place-items-center rounded-full bg-[#002B5C] text-white text-sm">{c.name.slice(0, 1).toUpperCase()}</span>
            <span className="flex-1"><b className="text-[#002B5C]">{c.name}</b>{c.relation && <span className="text-xs text-[#6B7280]"> · {c.relation}</span>}
                <a href={`tel:${c.phone}`} className="block text-sm text-[#1E6FB8]">{c.phone}</a></span>
        </li>
    );
}

function Actions({ busy, onClear }) {
    return (
        <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={busy} className="bg-[#002B5C] text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            {onClear && <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-sm text-[#CC0033]"><Trash2 size={13} />Clear these</button>}
        </div>
    );
}

function useForm(init, onSave) {
    const [f, setF] = useState(init);
    const [busy, setBusy] = useState(false);
    const submit = async (e, body) => { e?.preventDefault(); setBusy(true); try { await onSave(body || f); } finally { setBusy(false); } };
    return { f, setF, busy, submit, set: (k) => (e) => setF({ ...f, [k]: e.target.value }) };
}

function ContactForm({ p, onSave }) {
    const { f, set, busy, submit } = useForm({ phone: p.phone, personal_email: p.personal_email }, onSave);
    return (
        <form onSubmit={submit} className="space-y-2 text-sm">
            <label className="block">Mobile<div className="relative"><Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 mt-0.5 text-[#9CA3AF]" />
                <input inputMode="tel" value={f.phone} onChange={set("phone")} className={`${inp} pl-8`} placeholder="10-digit mobile" /></div></label>
            <label className="block">Personal email<div className="relative"><Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 mt-0.5 text-[#9CA3AF]" />
                <input type="email" value={f.personal_email} onChange={set("personal_email")} className={`${inp} pl-8`} placeholder="you@gmail.com" /></div>
                <span className="text-xs text-[#6B7280]">Used after you leave (e.g. for your Full &amp; Final), since your work email closes.</span></label>
            <Actions busy={busy} onClear={(e) => submit(e, { personal_email: "" })} />
        </form>
    );
}

function PersonalForm({ p, onSave }) {
    const { f, setF, set, busy, submit } = useForm({ dob: p.dob, blood_group: p.blood_group, marital_status: p.marital_status }, onSave);
    const opt = p.options;
    return (
        <form onSubmit={submit} className="space-y-3 text-sm">
            <label className="block max-w-xs">Date of birth<input type="date" value={f.dob} onChange={set("dob")} className={inp} /><span className="text-xs text-[#6B7280]">{fmt(f.dob)}</span></label>
            <div><div className="flex items-center gap-1"><Droplet size={14} className="text-[#CC0033]" />Blood group</div>
                <div className="mt-1 flex flex-wrap gap-1.5">{opt.blood_group.map((b) => (
                    <button key={b} type="button" onClick={() => setF({ ...f, blood_group: f.blood_group === b ? "" : b })} aria-pressed={f.blood_group === b}
                        className={`w-12 py-1.5 border text-sm transition-all ${f.blood_group === b ? "bg-[#CC0033] border-[#CC0033] text-white scale-105" : "border-[#E5E7EB] hover:border-[#CC0033]"}`}>{b}</button>))}</div></div>
            <div><div>Marital status</div>
                <div className="mt-1 flex flex-wrap gap-1.5">{opt.marital_status.map((m) => (
                    <button key={m} type="button" onClick={() => setF({ ...f, marital_status: f.marital_status === m ? "" : m })} aria-pressed={f.marital_status === m}
                        className={`px-3 py-1.5 border text-sm transition-colors ${f.marital_status === m ? "bg-[#002B5C] border-[#002B5C] text-white" : "border-[#E5E7EB] hover:border-[#002B5C]"}`}>{MARITAL[m]}</button>))}</div></div>
            <Actions busy={busy} />
        </form>
    );
}

function AddressForm({ p, onSave }) {
    const [same, setSame] = useState(!!p.current_address && p.permanent_address === p.current_address);
    const { f, set, busy, submit } = useForm({ current_address: p.current_address, permanent_address: p.permanent_address }, onSave);
    const go = (e) => submit(e, { current_address: f.current_address, permanent_address: same ? f.current_address : f.permanent_address });
    return (
        <form onSubmit={go} className="space-y-2 text-sm">
            <label className="block">Current address<textarea rows={3} value={f.current_address} onChange={set("current_address")} className={inp} placeholder="House, street, area, city, PIN" maxLength={400} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />Permanent address is the same</label>
            {!same && <label className="block">Permanent address<textarea rows={3} value={f.permanent_address} onChange={set("permanent_address")} className={inp} maxLength={400} /></label>}
            <Actions busy={busy} />
        </form>
    );
}

function EmergencyForm({ p, onSave }) {
    const [rows, setRows] = useState(p.emergency.length ? p.emergency : [{ name: "", relation: "", phone: "" }]);
    const [busy, setBusy] = useState(false);
    const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    const go = async (e) => { e.preventDefault(); setBusy(true); try { await onSave({ emergency: rows }); } finally { setBusy(false); } };
    return (
        <form onSubmit={go} className="space-y-3 text-sm">
            {rows.map((r, i) => (
                <div key={i} className="border border-[#E5E7EB] p-3 space-y-2 relative">
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove contact ${i + 1}`} className="absolute top-2 right-2 text-[#CC0033]"><Trash2 size={14} /></button>
                    <div className="text-xs uppercase tracking-wide text-[#6B7280]">Contact {i + 1}</div>
                    <input value={r.name} onChange={(e) => upd(i, "name", e.target.value)} className={inp} placeholder="Full name" maxLength={80} />
                    <div className="grid grid-cols-2 gap-2">
                        <select value={r.relation} onChange={(e) => upd(i, "relation", e.target.value)} className={inp} aria-label="Relation">
                            <option value="">Relation…</option>{p.options.relations.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                        <input inputMode="tel" value={r.phone} onChange={(e) => upd(i, "phone", e.target.value)} className={inp} placeholder="Mobile" />
                    </div>
                </div>
            ))}
            {rows.length < 2 && <button type="button" onClick={() => setRows([...rows, { name: "", relation: "", phone: "" }])} className="inline-flex items-center gap-1 text-sm text-[#002B5C]"><Plus size={14} />Add another contact</button>}
            <Actions busy={busy} />
        </form>
    );
}

/* For HR (full) and managers (emergency contacts only) — read-only. */
export function ProfileView({ empId }) {
    const [p, setP] = useState(null);
    const [e, setE] = useState("");
    useEffect(() => { profileOf(empId).then(setP).catch((x) => setE(formatApiError(x))); }, [empId]);
    if (e) return <p className="text-sm text-[#6B7280]">{e}</p>;
    if (!p) return <p className="text-sm text-[#6B7280]">Loading…</p>;
    return (
        <div className="space-y-4 text-sm" data-testid="hrm-profile-view">
            {p.scope === "full" && (
                <>
                    <div className="flex items-center gap-3"><Ring value={p.complete} max={100} color={p.complete === 100 ? "#0E9F6E" : "#F5B841"} size={56} label={`${p.complete}%`} />
                        <span className="text-[#6B7280]">{p.updated_at ? `Last updated by them ${fmt(p.updated_at)}` : "Not filled in yet"}</span></div>
                    <Rows rows={[["Mobile", p.phone], ["Personal email", p.personal_email], ["Date of birth", fmt(p.dob)], ["Blood group", p.blood_group],
                        ["Marital status", MARITAL[p.marital_status]], ["Current address", p.current_address], ["Permanent address", p.permanent_address]]} />
                </>
            )}
            <div><div className="font-medium text-[#002B5C] mb-2 flex items-center gap-1.5"><HeartPulse size={15} className="text-[#CC0033]" />Emergency contacts</div>
                {p.emergency.length ? <ul className="space-y-2">{p.emergency.map((c) => <Contact key={c.phone} c={c} />)}</ul> : <Empty text="None added yet." />}</div>
        </div>
    );
}
