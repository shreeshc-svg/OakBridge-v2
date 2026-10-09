import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Mail, MessageCircle, Plus, Search, Trash2, X } from "lucide-react";
import {
    mkDashboard, mkHealth, mkSettings, mkSaveSettings, mkVerify, mkImport, mkReverify, mkSync, mkContacts, mkPatchContact,
    mkDeleteContact, mkLists, mkCreateList, mkCampaigns, mkNewCampaign, mkCampaign, mkSaveCampaign, mkDuplicate,
    mkAudience, mkPreview, mkTestSend, mkSend, mkCampaignAction, mkReport, mkDismissAlert, mkSuppressionSync,
    mkBulkContacts, mkBulkDeleteLists, mkBulkDeleteCampaigns, fetchBooks, fetchCategories, mediaUrl, formatApiError,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin, canDelete } from "../../lib/rbac";
import { LineChart, BarChart, Funnel, Donut, Kpi, pct, inr } from "../../components/marketing/Charts";

/**
 * Admin → Marketing (backend/marketing.py).
 *
 *   Dashboard   KPIs, activity / revenue graphs, list growth, funnels,
 *               verification mix, sender health
 *   Campaigns   email (Amazon SES) and WhatsApp (Interakt) campaigns:
 *               editor, audience, test, send / schedule, live report
 *   Contacts    everyone, with verification status and consent
 *   Lists       static lists and rule-based segments
 *   Verify      paste or upload addresses -> free verification report -> import
 *   Settings    sender, footer, double opt-in, auto-pause, SES/SNS health
 */
const TABS = [["dash", "Dashboard"], ["campaigns", "Campaigns"], ["contacts", "Contacts"], ["lists", "Lists & segments"], ["verify", "Verify & import"], ["settings", "Settings"]];
const STATUS_COLORS = { verified: "#15803D", valid: "#38bdf8", risky: "#F59E0B", invalid: "#CC0033", suppressed: "#6B7280", unknown: "#D1D5DB" };
const SELECTABLE = [["verified", "Verified", "proven: confirmed account or delivered before"],
    ["valid", "Valid", "mailbox checked"], ["risky", "Risky", "follows the risk rules in Settings"]];
const RISK_LABEL = { role: "role address (info@, admin@)", catch_all: "domain accepts any address (catch-all)", unconfirmed: "mailbox unconfirmed" };
const ACTION_LABEL = { send: "sent", tail: "sent last — stops itself if it bounces", skip: "skipped" };
const CAMP_TONE = { preparing: "border-[#7c3aed] text-[#7c3aed]", draft: "border-[#9CA3AF] text-[#4B5563]", scheduled: "border-[#38bdf8] text-[#0369a1]", sending: "border-[#F59E0B] text-[#B4750F]",
    paused: "border-[#CC0033] text-[#CC0033]", sent: "border-[#15803D] text-[#15803D]", cancelled: "border-[#9CA3AF] text-[#9CA3AF]" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN") : "—");
const SITE = "https://www.oakbridge.in";
const box = "border border-[#E5E7EB] bg-white px-3 py-2 text-sm w-full focus:border-[#002B5C] outline-none";
const btn = "px-4 py-2 text-sm disabled:opacity-50";

/** Tick-box selection over ids (kept across pages until cleared). */
function useSelection() {
    const [sel, setSel] = useState(() => new Set());
    const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const setAll = (ids, on) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
    const clear = useCallback(() => setSel(new Set()), []);
    return { sel, toggle, setAll, clear };
}

/** Appears when something is ticked: count, the actions, and Clear. */
function BulkBar({ count, children, onClear }) {
    if (!count) return null;
    return (
        <div className="flex flex-wrap items-center gap-3 bg-[#002B5C] text-white text-sm px-3 py-2" data-testid="mk-bulk-bar">
            <span><b>{count.toLocaleString("en-IN")}</b> selected</span>
            {children}
            <button type="button" className="ml-auto underline" onClick={onClear}>Clear</button>
        </div>
    );
}
const bulkBtn = "border border-white/60 px-3 py-1 hover:bg-white hover:text-[#002B5C]";

function useDebounced(v, ms = 300) {
    const [d, setD] = useState(v);
    useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
    return d;
}

export default function AdminMarketing() {
    const [tab, setTab] = useState("dash");
    const [openCampaign, setOpenCampaign] = useState(null);
    return (
        <div data-testid="admin-marketing-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Email &amp; WhatsApp</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">Marketing</h1>
                </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 border-b border-[#E5E7EB]">
                {TABS.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => { setTab(k); setOpenCampaign(null); }}
                        className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === k ? "border-[#002B5C] text-[#002B5C] font-medium" : "border-transparent text-[#4B5563]"}`}>{l}</button>
                ))}
            </div>
            <div className="mt-6">
                {tab === "dash" && <Dashboard onOpen={(id) => { setTab("campaigns"); setOpenCampaign(id); }} />}
                {tab === "campaigns" && (openCampaign
                    ? <CampaignView id={openCampaign} onBack={() => setOpenCampaign(null)} onOpen={setOpenCampaign} />
                    : <CampaignList onOpen={setOpenCampaign} />)}
                {tab === "contacts" && <Contacts />}
                {tab === "lists" && <Lists />}
                {tab === "verify" && <VerifyImport />}
                {tab === "settings" && <Settings />}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------ dashboard --- */
function Dashboard({ onOpen }) {
    const [days, setDays] = useState(30);
    const [d, setD] = useState(null);
    const [health, setHealth] = useState(null);
    useEffect(() => { setD(null); mkDashboard(days).then(setD).catch((e) => { toast.error(formatApiError(e)); setD({ error: true }); }); }, [days]);
    useEffect(() => { mkHealth().then(setHealth).catch(() => setHealth({ ok: false })); }, []);
    if (!d) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    if (d.error) return <p className="text-sm text-[#CC0033]">Could not load the dashboard.</p>;
    const k = d.kpi;
    const dismiss = async (aid) => {
        try { await mkDismissAlert(aid); setD({ ...d, alerts: d.alerts.filter((a) => a.id !== aid) }); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <div className="space-y-6" data-testid="mk-dashboard">
            {(d.alerts || []).map((a) => (
                <div key={a.id} className="border border-[#CC0033] bg-white text-sm p-3 flex items-start gap-3" data-testid="mk-alert">
                    <span className="text-[#CC0033] font-medium">Needs a look</span>
                    <span className="flex-1">{a.message} <span className="text-xs text-[#6B7280]">({when(a.at)})</span>
                        {a.campaign_id && <button type="button" className="underline ml-2" onClick={() => onOpen(a.campaign_id)}>Open campaign</button>}</span>
                    <button type="button" aria-label="Dismiss" onClick={() => dismiss(a.id)}><X size={14} /></button>
                </div>
            ))}
            {d.ses_usage?.near_limit && (
                <div className="border border-[#F59E0B] bg-white text-sm p-3"><SesUsage u={d.ses_usage} /></div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
                Period
                {[7, 30, 90, 365].map((n) => (
                    <button key={n} type="button" onClick={() => setDays(n)} className={`px-3 py-1 border ${days === n ? "border-[#002B5C] text-[#002B5C] bg-white" : "border-[#E5E7EB]"}`}>{n === 365 ? "1 year" : `${n} days`}</button>
                ))}
                <HealthBadge h={health} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                <Kpi label="Subscribed (email)" value={k.subscribed.toLocaleString("en-IN")} sub={`${k.contacts.toLocaleString("en-IN")} contacts`} testid="mk-kpi-subscribed" />
                <Kpi label="Emails sent" value={k.email_sent.toLocaleString("en-IN")} sub={`${k.campaigns} campaigns`} />
                <Kpi label="Open rate" value={pct(k.open_rate)} sub="of delivered" />
                <Kpi label="Click rate" value={pct(k.click_rate)} sub="of delivered" />
                <Kpi label="Bounce rate" value={pct(k.bounce_rate, 2)} sub="keep under 2%" warn={(k.bounce_rate || 0) > 0.02} testid="mk-kpi-bounce" />
                <Kpi label="Unsubscribe rate" value={pct(k.unsubscribe_rate, 2)} sub={`complaints ${pct(k.complaint_rate, 2)}`} warn={(k.complaint_rate || 0) > 0.001} />
                <Kpi label="WhatsApp sent" value={k.wa_sent.toLocaleString("en-IN")} sub={`${k.wa_subscribed} opted in`} />
                <Kpi label="WhatsApp read rate" value={pct(k.wa_read_rate)} />
                <Kpi label="WhatsApp cost" value={inr(k.wa_cost)} sub="from delivery reports" />
                <Kpi label="Campaign revenue" value={inr(k.revenue)} sub={`${k.orders} paid orders`} />
                <Kpi label="Delivery rate" value={pct(k.delivery_rate)} />
                <Kpi label="Revenue per email" value={k.email_sent ? `₹${(k.revenue / k.email_sent).toFixed(2)}` : "—"} />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
                <Panel title="Email activity"><LineChart series={d.series} keys={["sent", "opened", "clicked", "bounced"]} days={days} labels={{ sent: "Sent", opened: "Opened", clicked: "Clicked", bounced: "Bounced" }} /></Panel>
                <Panel title="Revenue from campaigns"><LineChart series={d.series} keys={["revenue"]} days={days} labels={{ revenue: "Revenue" }} /></Panel>
                <Panel title="Email funnel (all campaigns in period)"><Funnel steps={d.funnel_email} /></Panel>
                <Panel title="WhatsApp funnel"><Funnel steps={d.funnel_whatsapp.map((s) => (s.step === "Opened" ? { ...s, step: "Read" } : s))} /></Panel>
                <Panel title="List growth"><BarChart up={d.growth} down={d.unsubs} days={days} upLabel="New contacts" downLabel="Unsubscribed" /></Panel>
                <Panel title="Address quality (all contacts)"><Donut data={d.verification} colors={STATUS_COLORS} label="Verification status" /></Panel>
            </div>
            <Panel title="Campaigns in this period">
                <CampaignTable rows={d.campaigns} onOpen={onOpen} />
            </Panel>
        </div>
    );
}

function HealthBadge({ h }) {
    if (!h) return null;
    if (!h.ok) return <span className="ml-auto text-xs text-[#CC0033]" title={h.error}>SES not reachable — see Settings</span>;
    const sandbox = h.production === false;
    return (
        <span className={`ml-auto text-xs ${sandbox ? "text-[#B4750F]" : "text-[#15803D]"}`} data-testid="mk-health">
            SES {sandbox ? "sandbox (only verified recipients)" : "ready"} · {h.sent_24h ?? 0}/{h.max_24h ?? "?"} sent in 24h · 30-day bounce {pct(h.last30?.bounce_rate, 2)}
        </span>
    );
}

/** "Amazon SES mailbox checks: 120 of 1000 this month (≈ $1.20)" + why it stopped, if it did. */
function SesUsage({ u }) {
    if (!u) return null;
    if (!u.enabled) return <p className="text-xs text-[#B4750F]">Amazon SES mailbox checks are switched off (Settings) — only the free checks run.</p>;
    if (!u.supported) return <p className="text-xs text-[#CC0033]">The server's AWS library is too old for SES mailbox checks. In Render, use “Clear build cache &amp; deploy”.</p>;
    return (
        <p className="text-xs text-[#4B5563]" data-testid="mk-ses-usage">
            Amazon SES mailbox checks this month: <b>{u.used}</b> of {u.cap} (₹{u.spent_inr} of ₹{u.budget_inr} budget)
            {u.used >= u.cap ? <span className="text-[#CC0033]"> — budget used up; unchecked addresses are skipped until next month or a higher budget.</span>
                : u.near_limit ? <span className="text-[#B4750F]"> — over 80% used.</span> : null}
            {u.last_stop && u.used < u.cap && <span className="text-[#CC0033]"> — last run stopped: {u.last_stop.why}</span>}
        </p>
    );
}

function Panel({ title, children, right }) {
    return (
        <div className="bg-white border border-[#E5E7EB] p-4">
            <div className="flex items-center justify-between mb-3"><div className="text-sm font-medium text-[#002B5C]">{title}</div>{right}</div>
            {children}
        </div>
    );
}

function CampaignTable({ rows = [], onOpen, sel, onDelete }) {
    const ids = rows.map((r) => r.id);
    const allOn = !!sel && ids.length > 0 && ids.every((x) => sel.sel.has(x));
    const cols = 8 + (sel ? 1 : 0) + (onDelete ? 1 : 0);
    return (
        <table className="w-full text-sm" data-testid="mk-campaign-table">
            <thead><tr className="text-left text-[#4B5563]">
                {sel && <th className="w-8"><input type="checkbox" aria-label="Select all campaigns" checked={allOn} onChange={(e) => sel.setAll(ids, e.target.checked)} data-testid="mk-camp-select-all" /></th>}
                <th className="py-2">Campaign</th><th>Status</th><th className="text-right">Sent</th><th className="text-right">Open</th><th className="text-right">Click</th><th className="text-right">Bounce</th><th className="text-right">Orders</th><th className="text-right">Revenue</th>{onDelete && <th className="w-8"></th>}</tr></thead>
            <tbody>
                {rows.map((c) => {
                    const s = c.stats || {};
                    const base = s.delivered || s.sent || 0;
                    return (
                        <tr key={c.id} className="border-t border-[#E5E7EB] hover:bg-[#F5F7FA] cursor-pointer" onClick={() => onOpen(c.id)}>
                            {sel && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.sel.has(c.id)} onChange={() => sel.toggle(c.id)} /></td>}
                            <td className="py-2">{c.channel === "whatsapp" ? <MessageCircle size={13} className="inline mr-1 text-[#15803D]" /> : <Mail size={13} className="inline mr-1 text-[#002B5C]" />}{c.name}</td>
                            <td><span className={`text-[10px] font-mono uppercase border px-1.5 py-0.5 ${CAMP_TONE[c.status] || ""}`}>{c.status}</span></td>
                            <td className="text-right">{(s.sent || 0).toLocaleString("en-IN")}</td>
                            <td className="text-right">{pct(base ? (s.opened || 0) / base : null)}</td>
                            <td className="text-right">{pct(base ? (s.clicked || 0) / base : null)}</td>
                            <td className={`text-right ${s.sent && s.bounced / s.sent > 0.02 ? "text-[#CC0033]" : ""}`}>{pct(s.sent ? (s.bounced || 0) / s.sent : null, 2)}</td>
                            <td className="text-right">{s.paid || 0}</td>
                            <td className="text-right">{inr(s.revenue)}</td>
                            {onDelete && <td className="text-right" onClick={(e) => e.stopPropagation()}>
                                <button type="button" aria-label={`Delete ${c.name}`} onClick={() => onDelete([c.id])}><Trash2 size={14} className="text-[#CC0033]" /></button></td>}
                        </tr>
                    );
                })}
                {!rows.length && <tr><td colSpan={cols} className="py-6 text-[#4B5563]">No campaigns yet.</td></tr>}
            </tbody>
        </table>
    );
}

/* ------------------------------------------------------------ campaigns --- */
/** Delete (drafts) / archive (sent) campaigns, after one clear confirmation. */
async function deleteCampaigns(ids, rows) {
    const picked = (rows || []).filter((r) => ids.includes(r.id));
    const live = picked.filter((r) => ["preparing", "sending"].includes(r.status)).length;
    const went = picked.filter((r) => !["draft", "preparing", "sending"].includes(r.status)).length;
    const msg = `Delete ${ids.length} campaign${ids.length === 1 ? "" : "s"}?`
        + (went ? `\n\n${went} already went out (or were scheduled): they're archived — hidden everywhere, and the unsubscribe links in those emails keep working.` : "")
        + (live ? `\n\n${live} still sending — cancel ${live === 1 ? "it" : "them"} first; ${live === 1 ? "it" : "they"} will be left as is.` : "");
    if (!window.confirm(msg)) return false;
    try {
        const r = await mkBulkDeleteCampaigns(ids);
        toast.success(`Deleted ${r.deleted}${r.archived ? `, archived ${r.archived}` : ""}.`);
        (r.refused || []).forEach((x) => toast.error(`${x.name || "Campaign"}: ${x.reason}`));
        return true;
    } catch (e) { toast.error(formatApiError(e)); return false; }
}

function CampaignList({ onOpen }) {
    const { user } = useAuth();
    const [rows, setRows] = useState(null);
    const sel = useSelection();
    const load = useCallback(() => { mkCampaigns().then(setRows).catch(() => setRows([])); }, []);
    useEffect(load, [load]);
    const del = async (ids) => { if (await deleteCampaigns(ids, rows)) { sel.clear(); load(); } };
    const create = async (channel) => {
        try { const c = await mkNewCampaign({ channel, name: channel === "email" ? "New email campaign" : "New WhatsApp campaign" }); onOpen(c.id); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <button type="button" className={`${btn} bg-[#002B5C] text-white inline-flex items-center gap-2`} onClick={() => create("email")} data-testid="mk-new-email"><Mail size={15} /> New email campaign</button>
                <button type="button" className={`${btn} border border-[#15803D] text-[#15803D] inline-flex items-center gap-2`} onClick={() => create("whatsapp")}><MessageCircle size={15} /> New WhatsApp campaign</button>
            </div>
            <BulkBar count={sel.sel.size} onClear={sel.clear}>
                {canDelete(user) && <button type="button" className={bulkBtn} onClick={() => del([...sel.sel])} data-testid="mk-camp-bulk-delete">Delete</button>}
            </BulkBar>
            {!rows ? <p className="text-sm text-[#4B5563]">Loading…</p> : (
                <div className="bg-white border border-[#E5E7EB] p-4">
                    <CampaignTable rows={rows} onOpen={onOpen} sel={canDelete(user) ? sel : undefined} onDelete={canDelete(user) ? del : undefined} />
                </div>
            )}
        </div>
    );
}

function CampaignView({ id, onBack, onOpen }) {
    const { user } = useAuth();
    const [c, setC] = useState(null);
    const load = useCallback(() => { mkCampaign(id).then(setC).catch((e) => toast.error(formatApiError(e))); }, [id]);
    useEffect(load, [load]);
    if (!c) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    const editable = ["draft", "scheduled"].includes(c.status);
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="underline text-sm" onClick={onBack}>← All campaigns</button>
                <span className={`text-[10px] font-mono uppercase border px-1.5 py-0.5 ${CAMP_TONE[c.status] || ""}`}>{c.status}</span>
                <button type="button" className="ml-auto border px-3 py-1 text-sm" onClick={async () => { try { const d = await mkDuplicate(id); toast.success("Copied as a new draft."); onOpen(d.id); } catch (e) { toast.error(formatApiError(e)); } }}>Duplicate</button>
                {canDelete(user) && <button type="button" className="border border-[#CC0033] text-[#CC0033] px-3 py-1 text-sm inline-flex items-center gap-1"
                    onClick={async () => { if (await deleteCampaigns([id], [c])) onBack(); }} data-testid="mk-camp-delete"><Trash2 size={13} /> Delete</button>}
            </div>
            {editable ? <CampaignEditor c={c} setC={setC} reload={load} /> : <CampaignReport id={id} status={c.status} reload={load} />}
        </div>
    );
}

const BLOCK_TYPES = [["heading", "Heading"], ["text", "Text"], ["image", "Image"], ["button", "Button"], ["book", "Book"], ["divider", "Divider"], ["spacer", "Space"]];

function CampaignEditor({ c, setC, reload }) {
    const [saving, setSaving] = useState(false);
    const [preview, setPreview] = useState("");
    const [lists, setLists] = useState([]);
    const [aud, setAud] = useState(null);
    const [testTo, setTestTo] = useState("");
    const [schedule, setSchedule] = useState("");
    const isEmail = c.channel === "email";
    useEffect(() => { mkLists().then(setLists).catch(() => {}); }, []);
    const patch = (p) => setC((x) => ({ ...x, ...p }));
    const save = async (quiet) => {
        setSaving(true);
        try {
            const body = { name: c.name, subject: c.subject, preheader: c.preheader, blocks: c.blocks, audience: c.audience,
                wa_template: c.wa_template, wa_language: c.wa_language, wa_variables: c.wa_variables };
            const saved = await mkSaveCampaign(c.id, body);
            setC(saved);
            if (isEmail) mkPreview(c.id).then((r) => setPreview(r.html)).catch(() => {});
            mkAudience(c.id).then(setAud).catch(() => {});
            if (!quiet) toast.success("Saved.");
            return saved;
        } catch (e) { toast.error(formatApiError(e)); return null; } finally { setSaving(false); }
    };
    useEffect(() => {
        if (isEmail) mkPreview(c.id).then((r) => setPreview(r.html)).catch(() => {});
        mkAudience(c.id).then(setAud).catch(() => {});
    }, [c.id, isEmail]);
    const setBlocks = (blocks) => patch({ blocks });
    const blocks = c.blocks || [];
    const audSel = c.audience || { list_ids: [] };
    const statuses = audSel.statuses?.length ? audSel.statuses : SELECTABLE.map(([k]) => k);
    const toggleStatus = async (k) => {
        const next = statuses.includes(k) ? statuses.filter((x) => x !== k) : [...statuses, k];
        if (!next.length) return toast.error("Tick at least one.");
        const audience = { ...audSel, statuses: next };
        patch({ audience });
        try {  // save just the audience and recount straight away — no extra click
            await mkSaveCampaign(c.id, { audience });
            setAud(await mkAudience(c.id));
        } catch (e) { toast.error(formatApiError(e)); }
    };
    const toggleList = (lid) => {
        const ids = new Set(audSel.list_ids || []);
        if (ids.has(lid)) ids.delete(lid); else ids.add(lid);
        patch({ audience: { ...audSel, list_ids: [...ids] } });
    };
    const send = async () => {
        const s = await save(true);
        if (!s) return;
        const a = await mkAudience(c.id).catch(() => null);
        if (!a?.total) return toast.error("Nobody in this audience can be sent to — no one has opted in, or all are unsubscribed / bounced.");
        const whenTxt = schedule ? `at ${new Date(schedule).toLocaleString("en-IN")}` : "now";
        const checks = isEmail && a.ses_on && a.needs_check > 0
            ? `\n\nFirst, ${a.needs_check} addresses get an Amazon SES mailbox check (≈ ₹${a.check_cost_inr}). Any that fail, or can't be checked, are skipped automatically.` : "";
        const guard = isEmail ? "\nIf bounces spike, unproven addresses are dropped and sending carries on; a second spike pauses it." : "";
        if (!window.confirm(`Send "${c.name}" to up to ${a.total.toLocaleString("en-IN")} ${isEmail ? "email addresses" : "WhatsApp numbers"} ${whenTxt}?${checks}\n\nEstimated sending cost ≈ ₹${a.estimated_cost_inr}.${guard}`)) return;
        try {
            const r = await mkSend(c.id, a.total, schedule ? new Date(schedule).toISOString() : null);
            toast.success(`Checking mailboxes, then ${schedule ? "scheduling" : "sending"} — up to ${r.recipients} people.`);
            reload();
        } catch (e) { toast.error(formatApiError(e)); }
    };
    const test = async () => {
        if (!testTo.trim()) return toast.error(isEmail ? "Type an email address to test with." : "Type a WhatsApp number to test with.");
        if (!(await save(true))) return;
        try { await mkTestSend(c.id, testTo.trim()); toast.success(isEmail ? `Test sent to ${testTo}.` : "Test sent (to the WhatsApp test number)."); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6" data-testid="mk-editor">
            <div className="space-y-4">
                <Panel title="Details">
                    <div className="space-y-2 text-sm">
                        <label className="block">Campaign name (internal)<input className={box} value={c.name || ""} onChange={(e) => patch({ name: e.target.value })} /></label>
                        {isEmail ? (
                            <>
                                <label className="block">Subject line <span className="text-xs text-[#6B7280]">— {"{{first_name}}"} personalises</span>
                                    <input className={box} value={c.subject || ""} onChange={(e) => patch({ subject: e.target.value })} data-testid="mk-subject" /></label>
                                <label className="block">Preview text (shown after the subject in the inbox)<input className={box} value={c.preheader || ""} onChange={(e) => patch({ preheader: e.target.value })} /></label>
                                <div className="text-xs text-[#6B7280]">Subject {(c.subject || "").length} characters — under 50 reads best on phones.</div>
                            </>
                        ) : (
                            <WaFields c={c} patch={patch} />
                        )}
                    </div>
                </Panel>
                {isEmail && (
                    <Panel title="Content" right={<span className="text-xs text-[#6B7280]">{blocks.length} blocks</span>}>
                        <BlockEditor blocks={blocks} setBlocks={setBlocks} />
                    </Panel>
                )}
                <Panel title="Audience">
                    <div className="space-y-2 text-sm">
                        {lists.map((l) => (
                            <label key={l.id} className="flex items-center gap-2">
                                <input type="checkbox" checked={(audSel.list_ids || []).includes(l.id)} onChange={() => toggleList(l.id)} />
                                {l.name} <span className="text-xs text-[#6B7280]">{l.kind === "segment" ? "segment" : "list"} · {l.count ?? 0} contacts</span>
                            </label>
                        ))}
                        {!lists.length && <p className="text-[#6B7280]">No lists yet — import or sync contacts first (Verify &amp; import / Contacts).</p>}
                        {isEmail && (
                            <div className="border-t border-[#E5E7EB] pt-2" data-testid="mk-statuses">
                                <div className="text-xs text-[#4B5563] mb-1">Send to addresses that are:</div>
                                <div className="flex flex-wrap gap-x-5 gap-y-1">
                                    {SELECTABLE.map(([k, label, hint]) => (
                                        <label key={k} className="flex items-center gap-2" title={hint}>
                                            <input type="checkbox" checked={statuses.includes(k)} onChange={() => toggleStatus(k)} data-testid={`mk-status-${k}`} />
                                            <span style={{ color: STATUS_COLORS[k] }} className="font-medium">{label}</span>
                                            <span className="text-xs text-[#6B7280]">({aud?.by_status?.[k] ?? 0})</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="text-[11px] text-[#6B7280] mt-1">Not-yet-checked addresses are checked on Send, then go only if their result is ticked. Invalid and bounced never go.</div>
                            </div>
                        )}
                        {aud && (
                            <div className="bg-[#F5F7FA] p-3 text-sm space-y-1" data-testid="mk-audience">
                                <div><b>Up to {aud.total.toLocaleString("en-IN")}</b> {isEmail ? "opted-in contacts" : "contacts with WhatsApp opt-in"} (unsubscribed and bounced are always excluded)</div>
                                <div className="text-xs text-[#4B5563]">{Object.entries(aud.by_status || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")} · est. sending cost ≈ ₹{aud.estimated_cost_inr}</div>
                                {isEmail && aud.ses_on && (
                                    <div className="text-xs text-[#4B5563]" data-testid="mk-audience-checks">
                                        {aud.needs_check > 0
                                            ? <>On Send, <b>{aud.needs_check}</b> get an Amazon SES mailbox check first (≈ ₹{aud.check_cost_inr}); ones that fail are skipped automatically.
                                                {aud.needs_check > aud.checks_left && <span className="text-[#CC0033]"> Only {aud.checks_left} checks left in this month's budget — the rest will be skipped.</span>}</>
                                            : "Everyone here is already checked or proven."}
                                    </div>
                                )}
                                {isEmail && Object.keys(aud.risky_by_kind || {}).length > 0 && (
                                    <ul className="text-xs text-[#B4750F]">
                                        {Object.entries(aud.risky_by_kind).map(([k, v]) => (
                                            <li key={k}>{v.n} risky — {RISK_LABEL[k] || k}: {ACTION_LABEL[v.action] || v.action}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                        <button type="button" className="underline text-xs" onClick={() => save()}>Save &amp; recount</button>
                    </div>
                </Panel>
                <Panel title="Test and send">
                    <div className="flex flex-wrap gap-2 text-sm">
                        <input className={`${box} flex-1 min-w-[200px]`} placeholder={isEmail ? "you@oakbridge.in" : "+91 98xxxxxxxx (goes to the WhatsApp test number)"} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                        <button type="button" className={`${btn} border border-[#002B5C] text-[#002B5C]`} onClick={test} disabled={saving}>Send test</button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
                        <label>Schedule (optional) <input type="datetime-local" className="border border-[#E5E7EB] px-2 py-1.5 ml-1" value={schedule} onChange={(e) => setSchedule(e.target.value)} /></label>
                        <button type="button" className={`${btn} border`} onClick={() => save()} disabled={saving}>Save draft</button>
                        <button type="button" className={`${btn} bg-[#CC0033] text-white ml-auto`} onClick={send} disabled={saving} data-testid="mk-send">{schedule ? "Schedule" : "Send now"}</button>
                    </div>
                </Panel>
            </div>
            {isEmail && (
                <div className="space-y-2 xl:sticky xl:top-4 self-start">
                    <div className="text-sm text-[#4B5563]">Preview (saved version, sample name “Asha”)</div>
                    <iframe title="Email preview" sandbox="" srcDoc={preview || "<p style='font-family:sans-serif;color:#6B7280;padding:20px'>Save to see the preview.</p>"}
                        className="w-full h-[760px] bg-white border border-[#E5E7EB]" data-testid="mk-preview" />
                </div>
            )}
        </div>
    );
}

function WaFields({ c, patch }) {
    const vars = c.wa_variables || [];
    const setVar = (i, p) => patch({ wa_variables: vars.map((v, k) => (k === i ? { ...v, ...p } : v)) });
    return (
        <div className="space-y-2">
            <label className="block">Approved Interakt template name<input className={`${box} font-mono`} value={c.wa_template || ""} onChange={(e) => patch({ wa_template: e.target.value.trim() })} placeholder="e.g. new_release_offer" /></label>
            <label className="block">Language code<input className={`${box} font-mono w-32`} value={c.wa_language || "en"} onChange={(e) => patch({ wa_language: e.target.value.trim() })} /></label>
            <div className="text-xs text-[#4B5563]">Template variables, in order ({"{{1}}"}, {"{{2}}"}…):</div>
            {vars.map((v, i) => (
                <div key={i} className="flex gap-2 items-center">
                    <span className="text-xs w-10">{`{{${i + 1}}}`}</span>
                    <select className="border border-[#E5E7EB] px-2 py-1.5 text-sm" value={v.source || "static"} onChange={(e) => setVar(i, { source: e.target.value })}>
                        <option value="first_name">Contact's first name</option><option value="name">Contact's full name</option><option value="static">Fixed text</option>
                    </select>
                    {v.source === "static" && <input className={`${box} flex-1`} value={v.value || ""} onChange={(e) => setVar(i, { value: e.target.value })} />}
                    <button type="button" aria-label="Remove variable" onClick={() => patch({ wa_variables: vars.filter((_, k) => k !== i) })}><X size={14} /></button>
                </div>
            ))}
            <button type="button" className="underline text-xs" onClick={() => patch({ wa_variables: [...vars, { source: "static", value: "" }] })}>+ Add variable</button>
            <p className="text-xs text-[#6B7280]">Goes only to contacts who opted in to WhatsApp marketing. Uses Interakt's Off / Test / Live switch (Admin → WhatsApp).</p>
        </div>
    );
}

function BlockEditor({ blocks, setBlocks }) {
    const upd = (i, p) => setBlocks(blocks.map((b, k) => (k === i ? { ...b, ...p } : b)));
    const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= blocks.length) return;
        const n = [...blocks];
        [n[i], n[j]] = [n[j], n[i]];
        setBlocks(n);
    };
    return (
        <div className="space-y-3">
            {blocks.map((b, i) => (
                <div key={i} className="border border-[#E5E7EB] p-3 space-y-2 text-sm" data-testid="mk-block">
                    <div className="flex items-center gap-2 text-xs text-[#4B5563]">
                        <b className="uppercase tracking-wider">{b.type}</b>
                        <span className="ml-auto inline-flex gap-1">
                            <button type="button" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                            <button type="button" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                            <button type="button" aria-label="Remove block" onClick={() => setBlocks(blocks.filter((_, k) => k !== i))}><Trash2 size={14} className="text-[#CC0033]" /></button>
                        </span>
                    </div>
                    {b.type === "heading" && <input className={box} value={b.text || ""} onChange={(e) => upd(i, { text: e.target.value })} placeholder="Heading — {{first_name}} works here" />}
                    {b.type === "text" && (
                        <>
                            <textarea rows={4} className={box} value={b.text || ""} onChange={(e) => upd(i, { text: e.target.value })} placeholder="Text. **bold**, *italic*, [link text](https://www.oakbridge.in/...)" />
                            <div className="text-[11px] text-[#6B7280]">**bold** · *italic* · [text](https://link) · {"{{first_name}}"}</div>
                        </>
                    )}
                    {b.type === "image" && (
                        <>
                            <input className={box} value={b.src || ""} onChange={(e) => upd(i, { src: e.target.value })} placeholder="Image URL (https://…) — copy from Media Library" />
                            <input className={box} value={b.alt || ""} onChange={(e) => upd(i, { alt: e.target.value })} placeholder="Alt text (what the image shows)" />
                            <input className={box} value={b.url || ""} onChange={(e) => upd(i, { url: e.target.value })} placeholder="Link when clicked (optional)" />
                        </>
                    )}
                    {b.type === "button" && (
                        <div className="grid sm:grid-cols-2 gap-2">
                            <input className={box} value={b.label || ""} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Button text" />
                            <input className={box} value={b.url || ""} onChange={(e) => upd(i, { url: e.target.value })} placeholder="https://www.oakbridge.in/…" />
                        </div>
                    )}
                    {b.type === "book" && <BookPicker block={b} onPick={(p) => upd(i, p)} />}
                </div>
            ))}
            <div className="flex flex-wrap gap-2">
                {BLOCK_TYPES.map(([t, l]) => (
                    <button key={t} type="button" className="border px-2 py-1 text-xs inline-flex items-center gap-1" onClick={() => setBlocks([...blocks, { type: t }])}><Plus size={12} />{l}</button>
                ))}
            </div>
        </div>
    );
}

function BookPicker({ block, onPick }) {
    const [q, setQ] = useState("");
    const dq = useDebounced(q);
    const [res, setRes] = useState([]);
    useEffect(() => {
        if (!dq.trim()) { setRes([]); return; }
        fetchBooks({ search: dq, limit: 8 }).then((r) => setRes(Array.isArray(r) ? r : r?.items || [])).catch(() => setRes([]));
    }, [dq]);
    return (
        <div className="space-y-2">
            {block.title && <div className="text-sm"><b>{block.title}</b> — {block.author} {block.price}</div>}
            <input className={box} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalogue…" />
            {res.length > 0 && (
                <ul className="border border-[#E5E7EB] divide-y max-h-56 overflow-auto">
                    {res.map((b) => (
                        <li key={b.id}>
                            <button type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#F5F7FA]" onClick={() => {
                                onPick({ book_id: b.id, title: b.title, author: b.author, price: b.price ? `₹${b.price}` : "",
                                    cover: mediaUrl(b.cover_image) || b.cover_image || "", url: `${SITE}/books/${b.id}` });
                                setQ("");
                            }}>{b.title} <span className="text-[#6B7280]">— {b.author}</span></button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function CampaignReport({ id, status, reload }) {
    const [r, setR] = useState(null);
    const load = useCallback(() => { mkReport(id).then(setR).catch((e) => toast.error(formatApiError(e))); }, [id]);
    useEffect(() => {
        load();
        if (!["sending", "preparing"].includes(status)) return undefined;
        const t = setInterval(() => { load(); if (status === "preparing") reload(); }, status === "preparing" ? 5000 : 15000);  // live while checking / sending
        return () => clearInterval(t);
    }, [load, status, reload]);
    const act = async (a) => {
        if (a === "cancel" && !window.confirm("Cancel this campaign? Messages not yet sent will not go.")) return;
        try { await mkCampaignAction(id, a); toast.success("Done."); reload(); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (!r) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    const s = r.stats || {};
    const isWa = r.campaign.channel === "whatsapp";
    return (
        <div className="space-y-4" data-testid="mk-report">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-serif text-2xl text-[#002B5C]">{r.campaign.name}</h2>
                {r.campaign.subject && <span className="text-sm text-[#4B5563]">“{r.campaign.subject}”</span>}
                <span className="ml-auto flex gap-2">
                    {["sending", "scheduled"].includes(status) && <button type="button" className="border px-3 py-1 text-sm" onClick={() => act("pause")}>Pause</button>}
                    {status === "paused" && <button type="button" className="border border-[#15803D] text-[#15803D] px-3 py-1 text-sm" onClick={() => act("resume")}>Resume</button>}
                    {["preparing", "sending", "scheduled", "paused"].includes(status) && <button type="button" className="border border-[#CC0033] text-[#CC0033] px-3 py-1 text-sm" onClick={() => act("cancel")}>Cancel</button>}
                </span>
            </div>
            {r.campaign.paused_reason && <div className="border border-[#CC0033] text-[#CC0033] p-2 text-sm">{r.campaign.paused_reason}</div>}
            {status === "preparing" && (
                <div className="border border-[#7c3aed] text-[#5b21b6] p-2 text-sm" data-testid="mk-preparing">
                    Checking mailboxes before sending… {r.campaign.prepare?.checked ?? 0} of {r.campaign.prepare?.to_check ?? "?"} checked. Sending starts by itself.
                </div>
            )}
            {r.campaign.prepare_error && <div className="border border-[#CC0033] text-[#CC0033] p-2 text-sm">Could not prepare: {r.campaign.prepare_error}</div>}
            {r.campaign.recovery && (
                <div className="border border-[#F59E0B] text-[#92400e] p-2 text-sm" data-testid="mk-recovery">
                    Bounce spike at {when(r.campaign.recovery.at)} ({r.campaign.recovery.reason}): {r.campaign.recovery.dropped} unproven addresses were dropped
                    {r.campaign.recovery.rechecked ? `, ${r.campaign.recovery.rechecked} re-checked` : ""} and sending carried on.
                </div>
            )}
            {r.campaign.tail_stopped_at && <div className="border border-[#F59E0B] text-[#92400e] p-2 text-sm">The catch-all tail stopped itself at {when(r.campaign.tail_stopped_at)} — too many of those bounced.</div>}
            {r.campaign.note && <div className="border p-2 text-sm">{r.campaign.note}</div>}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                <Kpi label="Sent" value={(s.sent || 0).toLocaleString("en-IN")} sub={s.queued ? `${s.queued} waiting` : ""} />
                <Kpi label="Delivered" value={pct(r.rates.delivery)} />
                <Kpi label={isWa ? "Read" : "Opened"} value={pct(r.rates.open)} />
                <Kpi label="Clicked" value={pct(r.rates.click)} sub={isWa ? "" : `CTOR ${pct(r.rates.ctor)}`} />
                <Kpi label="Bounced" value={pct(r.rates.bounce, 2)} warn={(r.rates.bounce || 0) > 0.02} />
                <Kpi label="Unsubscribed" value={pct(r.rates.unsubscribe, 2)} />
                <Kpi label="Orders" value={s.paid || 0} sub={`${s.orders || 0} started`} />
                <Kpi label="Revenue" value={inr(s.revenue)} sub={isWa && s.cost ? `cost ${inr(s.cost)}` : ""} />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
                <Panel title="Funnel"><Funnel steps={r.funnel.map((f) => (isWa && f.step === "Opened" ? { ...f, step: "Read" } : f))} /></Panel>
                <Panel title="Opens and clicks by hour">
                    <HourChart timeline={r.timeline} />
                </Panel>
            </div>
            {r.links.length > 0 && (
                <Panel title="Links clicked">
                    <table className="w-full text-sm"><tbody>{r.links.map((l) => (
                        <tr key={l.url} className="border-t"><td className="py-1.5 break-all pr-4">{l.url}</td><td className="text-right font-medium">{l.clicks}</td></tr>
                    ))}</tbody></table>
                </Panel>
            )}
            {(r.skipped || []).length > 0 && (
                <Panel title={`Not sent (${r.skipped.reduce((a, x) => a + x.n, 0)})`}>
                    <table className="w-full text-xs" data-testid="mk-skipped"><tbody>{r.skipped.map((x) => (
                        <tr key={x.reason} className="border-t"><td className="py-1 pr-3">{x.reason}</td><td className="text-right font-medium">{x.n}</td></tr>
                    ))}</tbody></table>
                </Panel>
            )}
            {r.problems.length > 0 && (
                <Panel title={`Bounces, complaints and failures (${r.problems.length})`}>
                    <table className="w-full text-xs"><tbody>{r.problems.map((p, i) => (
                        <tr key={i} className="border-t"><td className="py-1 pr-3 font-mono">{p.to}</td><td className="pr-3">{p.status}{p.bounce_type ? ` (${p.bounce_type})` : ""}</td><td className="text-[#6B7280]">{p.error}</td></tr>
                    ))}</tbody></table>
                    <p className="text-xs text-[#6B7280] mt-2">Hard bounces and complaints are removed from all future sends automatically.</p>
                </Panel>
            )}
        </div>
    );
}

function HourChart({ timeline = {} }) {
    const hours = Object.keys(timeline);
    if (!hours.length) return <p className="text-sm text-[#6B7280]">No opens or clicks yet.</p>;
    const max = Math.max(1, ...hours.map((h) => timeline[h].opened));
    // Keys are UTC hours ("2026-10-09T09") from the server; show them in the
    // admin's own time zone (IST), or 09h reads as five and a half hours off.
    const local = (h) => new Date(`${h}:00:00Z`).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true });
    return (
        <div>
            {/* h-full on each column: without it the column is as tall as its
                content, so the bars' percentage heights resolve to 0 and a
                real open shows as an empty chart. */}
            <div className="flex items-end gap-[2px] h-32">
                {hours.map((h) => (
                    <div key={h} className="flex-1 h-full flex flex-col justify-end max-w-[48px]" title={`${local(h)} — ${timeline[h].opened} opens, ${timeline[h].clicked} clicks`}>
                        <div style={{ height: `${(timeline[h].clicked / max) * 100}%`, background: "#F59E0B" }} />
                        <div style={{ height: `${((timeline[h].opened - timeline[h].clicked) / max) * 100}%`, background: "#38bdf8" }} />
                    </div>
                ))}
            </div>
            <div className="flex justify-between text-[10px] text-[#6B7280] mt-1"><span>{local(hours[0])}</span>{hours.length > 1 && <span>{local(hours[hours.length - 1])}</span>}</div>
            <div className="text-xs mt-1"><i className="inline-block w-3 h-3 bg-[#38bdf8] mr-1" />opens <i className="inline-block w-3 h-3 bg-[#F59E0B] ml-3 mr-1" />clicks</div>
        </div>
    );
}

/* ------------------------------------------------------------- contacts --- */
function Contacts() {
    const { user } = useAuth();
    const [q, setQ] = useState("");
    const dq = useDebounced(q);
    const [status, setStatus] = useState("");
    const [consent, setConsent] = useState("");
    const [page, setPage] = useState(1);
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState(false);
    const sel = useSelection();
    const [allMatching, setAllMatching] = useState(false);
    const load = useCallback(() => {
        mkContacts({ q: dq || undefined, status: status || undefined, consent: consent || undefined, page }).then(setD).catch(() => setD({ rows: [], total: 0 }));
    }, [dq, status, consent, page]);
    useEffect(load, [load]);
    const clearSel = sel.clear;
    useEffect(() => { setPage(1); clearSel(); setAllMatching(false); }, [dq, status, consent, clearSel]);
    const pageIds = (d?.rows || []).map((c) => c.id);
    const pageAllOn = pageIds.length > 0 && pageIds.every((x) => sel.sel.has(x));
    const count = allMatching ? (d?.total || 0) : sel.sel.size;
    const bulk = async (action) => {
        if (action === "erase") {
            const typed = window.prompt(`Erase ${count} contact${count === 1 ? "" : "s"} completely (privacy deletion)?\nThis can't be undone, and they can never be re-imported.\n\nType ERASE to confirm.`);
            if (typed !== "ERASE") return;
        } else if (!window.confirm(`Unsubscribe ${count} contact${count === 1 ? "" : "s"} from marketing email? Only they can opt in again.`)) return;
        try {
            const body = { action, expected: count, ...(allMatching
                ? { all_matching: { q: dq || undefined, status: status || undefined, consent: consent || undefined } }
                : { ids: [...sel.sel] }) };
            const r = await mkBulkContacts(body);
            toast.success(`${action === "erase" ? "Erased" : "Unsubscribed"} ${r.done}.`);
            sel.clear(); setAllMatching(false); load();
        } catch (e) { toast.error(formatApiError(e)); }
    };
    const sync = async () => {
        setBusy(true);
        try { const r = await mkSync(); toast.success(`Synced. ${r.contacts} contacts in total.`); load(); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const unsub = async (cid, field) => { try { await mkPatchContact(cid, { [field]: "unsubscribed" }); load(); } catch (e) { toast.error(formatApiError(e)); } };
    const erase = async (cid) => {
        if (!window.confirm("Erase this person completely (privacy request)? They can never be re-imported by accident.")) return;
        try { await mkDeleteContact(cid); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const selCls = "border border-[#E5E7EB] bg-white px-2 py-2 text-sm";
    return (
        <div className="space-y-3" data-testid="mk-contacts">
            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative w-full sm:w-80">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
                    <input className={`${box} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, name, phone, source…" />
                </div>
                <select className={selCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">Any address status</option>{Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className={selCls} value={consent} onChange={(e) => setConsent(e.target.value)}>
                    <option value="">Any email consent</option>{["subscribed", "pending", "none", "unsubscribed", "complained"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button type="button" className={`${btn} border ml-auto`} disabled={busy} onClick={sync} title="Newsletter sign-ups, paying customers and confirmed accounts">Sync website contacts</button>
            </div>
            {d && (
                <div className="text-xs text-[#4B5563]">{d.total.toLocaleString("en-IN")} contacts · {Object.entries(d.by_consent || {}).map(([k, v]) => `${k || "none"} ${v}`).join(" · ")}</div>
            )}
            <BulkBar count={count} onClear={() => { sel.clear(); setAllMatching(false); }}>
                <button type="button" className={bulkBtn} onClick={() => bulk("unsubscribe")} data-testid="mk-contacts-bulk-unsub">Unsubscribe</button>
                {canDelete(user) && <button type="button" className={bulkBtn} onClick={() => bulk("erase")} data-testid="mk-contacts-bulk-erase">Erase</button>}
            </BulkBar>
            {d && pageAllOn && !allMatching && d.total > pageIds.length && (
                <div className="text-xs bg-[#F5F7FA] p-2">All {pageIds.length} on this page are selected.{" "}
                    <button type="button" className="underline" onClick={() => setAllMatching(true)} data-testid="mk-contacts-select-matching">Select all {d.total.toLocaleString("en-IN")} matching contacts</button></div>
            )}
            {allMatching && <div className="text-xs bg-[#F5F7FA] p-2">All {d?.total?.toLocaleString("en-IN")} contacts matching the current search and filters are selected.</div>}
            {!d ? <p className="text-sm text-[#4B5563]">Loading…</p> : (
                <div className="bg-white border border-[#E5E7EB] overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="text-left text-[#4B5563]">
                            <th className="pl-2 w-6"><input type="checkbox" aria-label="Select all on this page" checked={allMatching || pageAllOn} disabled={allMatching}
                                onChange={(e) => sel.setAll(pageIds, e.target.checked)} data-testid="mk-contacts-select-page" /></th>
                            <th className="p-2">Email</th><th>Name</th><th>Address</th><th>Email consent</th><th>WhatsApp</th><th>Source</th><th className="text-right">Sent/Open/Click</th><th></th></tr></thead>
                        <tbody>
                            {d.rows.map((c) => (
                                <tr key={c.id} className="border-t align-top">
                                    <td className="pl-2 pt-2"><input type="checkbox" aria-label={`Select ${c.email}`} checked={allMatching || sel.sel.has(c.id)} disabled={allMatching} onChange={() => sel.toggle(c.id)} /></td>
                                    <td className="p-2 font-mono text-xs">{c.email}</td>
                                    <td className="text-xs">{c.name}<div className="text-[#6B7280]">{c.phone}</div></td>
                                    <td className="text-xs"><span style={{ color: STATUS_COLORS[c.email_status] }} className="font-medium">{c.email_status}</span>
                                        {c.ses_checked && <span className="ml-1 text-[10px] border border-[#E5E7EB] px-1" title="Mailbox checked by Amazon SES">SES ✓</span>}
                                        {c.email_status === "risky" && c.risk_kind && <div className="text-[#B4750F]">{RISK_LABEL[c.risk_kind] || c.risk_kind}</div>}
                                        {c.reasons?.length ? <div className="text-[#6B7280] max-w-[24ch]">{c.reasons.join("; ")}</div> : null}</td>
                                    <td className="text-xs">{c.email_consent?.status}{c.email_consent?.status === "subscribed" && <button type="button" className="block underline text-[#CC0033]" onClick={() => unsub(c.id, "email_consent")}>unsubscribe</button>}</td>
                                    <td className="text-xs">{c.wa_consent?.status}{c.wa_consent?.status === "subscribed" && <button type="button" className="block underline text-[#CC0033]" onClick={() => unsub(c.id, "wa_consent")}>opt out</button>}</td>
                                    <td className="text-xs text-[#4B5563] max-w-[20ch]">{c.source}</td>
                                    <td className="text-right text-xs">{c.stats?.sent || 0}/{c.stats?.opened || 0}/{c.stats?.clicked || 0}</td>
                                    <td className="text-right pr-2">{canDelete(user) && <button type="button" aria-label="Erase contact" onClick={() => erase(c.id)}><Trash2 size={14} className="text-[#CC0033]" /></button>}</td>
                                </tr>
                            ))}
                            {!d.rows.length && <tr><td colSpan={9} className="p-4 text-[#4B5563]">No contacts {dq || status || consent ? "match" : "yet — import a list or press Sync website contacts"}.</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}
            {d && d.total > d.per && (
                <div className="flex gap-2 items-center text-sm">
                    <button type="button" className="border px-3 py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                    Page {page} of {Math.ceil(d.total / d.per)}
                    <button type="button" className="border px-3 py-1" disabled={page * d.per >= d.total} onClick={() => setPage(page + 1)}>Next</button>
                </div>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------- lists --- */
const RULES = [["bought_category", "Bought from a category"], ["customers", "Paying customers"], ["abandoned_cart", "Has items left in cart"], ["source", "Came from (source)"], ["status", "Address status"]];

function Lists() {
    const { user } = useAuth();
    const sel = useSelection();
    const [lists, setLists] = useState(null);
    const [cats, setCats] = useState([]);
    const [name, setName] = useState("");
    const [kind, setKind] = useState("static");
    const [rules, setRules] = useState([]);
    const load = useCallback(() => { mkLists().then(setLists).catch(() => setLists([])); }, []);
    useEffect(load, [load]);
    useEffect(() => { fetchCategories().then((c) => setCats(Array.isArray(c) ? c : [])).catch(() => {}); }, []);
    const create = async () => {
        if (!name.trim()) return toast.error("Give it a name.");
        try { await mkCreateList({ name, kind, rules: kind === "segment" ? rules : [] }); setName(""); setRules([]); toast.success("Created."); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const setRule = (i, p) => setRules(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));
    const delLists = async (ids) => {
        const names = (lists || []).filter((l) => ids.includes(l.id)).map((l) => `“${l.name}”`);
        if (!window.confirm(`Delete ${ids.length === 1 ? names[0] : `${ids.length} lists / segments`}? The contacts in them stay.`)) return;
        try { const r = await mkBulkDeleteLists(ids); toast.success(`Deleted ${r.deleted}.`); sel.clear(); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const reverify = async (lid) => {
        try { const r = await mkReverify(lid); toast.success(`Re-checked: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(", ")}`); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <div className="grid lg:grid-cols-2 gap-6">
            <Panel title="Lists and segments">
                {canDelete(user) && <BulkBar count={sel.sel.size} onClear={sel.clear}>
                    <button type="button" className={bulkBtn} onClick={() => delLists([...sel.sel])} data-testid="mk-lists-bulk-delete">Delete</button>
                </BulkBar>}
                {!lists ? <p className="text-sm">Loading…</p> : (
                    <ul className="divide-y text-sm" data-testid="mk-lists">
                        {canDelete(user) && lists.length > 0 && (
                            <li className="py-2 text-xs text-[#4B5563]"><label className="flex items-center gap-2">
                                <input type="checkbox" checked={lists.every((l) => sel.sel.has(l.id))} onChange={(e) => sel.setAll(lists.map((l) => l.id), e.target.checked)} data-testid="mk-lists-select-all" /> Select all</label></li>
                        )}
                        {lists.map((l) => (
                            <li key={l.id} className="py-2 flex items-center gap-3">
                                {canDelete(user) && <input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.sel.has(l.id)} onChange={() => sel.toggle(l.id)} />}
                                <div className="flex-1"><b>{l.name}</b> <span className="text-xs text-[#6B7280]">{l.kind}</span>
                                    <div className="text-xs text-[#4B5563]">{l.count ?? 0} contacts{l.kind === "static" ? ` · ${l.sendable ?? 0} can be emailed` : ""}{l.rules?.length ? ` · ${l.rules.map((r) => r.type).join(" + ")}` : ""}</div></div>
                                {l.kind === "static" && <button type="button" className="text-xs underline" onClick={() => reverify(l.id)}>Re-verify</button>}
                                {canDelete(user) && <button type="button" aria-label="Delete list" onClick={() => delLists([l.id])}><Trash2 size={14} className="text-[#CC0033]" /></button>}
                            </li>
                        ))}
                        {!lists.length && <li className="py-4 text-[#6B7280]">None yet.</li>}
                    </ul>
                )}
            </Panel>
            <Panel title="New list or segment">
                <div className="space-y-3 text-sm">
                    <input className={box} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. UPSC buyers 2026" />
                    <div className="flex gap-3">
                        <label><input type="radio" checked={kind === "static"} onChange={() => setKind("static")} /> Static list (filled by imports)</label>
                        <label><input type="radio" checked={kind === "segment"} onChange={() => setKind("segment")} /> Segment (rules, always up to date)</label>
                    </div>
                    {kind === "segment" && (
                        <div className="space-y-2">
                            {rules.map((r, i) => (
                                <div key={i} className="flex flex-wrap gap-2 items-center bg-[#F5F7FA] p-2">
                                    <select className="border px-2 py-1" value={r.type} onChange={(e) => setRule(i, { type: e.target.value })}>{RULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                                    {r.type === "bought_category" && (
                                        <>
                                            <select className="border px-2 py-1" value={r.category || ""} onChange={(e) => setRule(i, { category: e.target.value })}>
                                                <option value="">category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                            in the last <input type="number" className="border px-2 py-1 w-20" value={r.days || 180} onChange={(e) => setRule(i, { days: Number(e.target.value) })} /> days
                                        </>
                                    )}
                                    {r.type === "customers" && <>who paid in the last <input type="number" className="border px-2 py-1 w-20" value={r.days || 365} onChange={(e) => setRule(i, { days: Number(e.target.value) })} /> days</>}
                                    {r.type === "source" && <input className="border px-2 py-1" value={r.value || ""} onChange={(e) => setRule(i, { value: e.target.value })} placeholder="newsletter / checkout / import: …" />}
                                    {r.type === "status" && <select className="border px-2 py-1" value={r.value || "verified"} onChange={(e) => setRule(i, { value: e.target.value })}>{["verified", "valid", "risky"].map((s) => <option key={s}>{s}</option>)}</select>}
                                    <button type="button" aria-label="Remove rule" className="ml-auto" onClick={() => setRules(rules.filter((_, k) => k !== i))}><X size={14} /></button>
                                </div>
                            ))}
                            <button type="button" className="underline text-xs" onClick={() => setRules([...rules, { type: "bought_category", days: 180 }])}>+ Add rule (all rules must match)</button>
                        </div>
                    )}
                    <button type="button" className={`${btn} bg-[#002B5C] text-white`} onClick={create}>Create</button>
                    <p className="text-xs text-[#6B7280]">Campaigns always skip people who haven't opted in, unsubscribed, bounced or complained — whatever the list says.</p>
                </div>
            </Panel>
        </div>
    );
}

/* ------------------------------------------------------- verify / import --- */
function VerifyImport() {
    const [paste, setPaste] = useState("");
    const [useSes, setUseSes] = useState(true);
    const [quick, setQuick] = useState(null);
    const [file, setFile] = useState(null);
    const [report, setReport] = useState(null);
    const [opts, setOpts] = useState({ list_name: "", consent_email: false, consent_whatsapp: false, consent_source: "", autofix: true });
    const [pick, setPick] = useState({ verified: true, valid: true, risky: true });
    const [busy, setBusy] = useState(false);
    const fileIn = useRef(null);
    const runQuick = async () => {
        const emails = paste.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
        if (!emails.length) return;
        setBusy(true);
        try { setQuick(await mkVerify(emails, true, useSes)); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const run = async (dry) => {
        if (!file) return toast.error("Choose an Excel (.xlsx) or CSV file.");
        if (!dry && (opts.consent_email || opts.consent_whatsapp) && opts.consent_source.trim().length < 3) return toast.error("Say where these people agreed to hear from you.");
        setBusy(true);
        try {
            const r = await mkImport(file, { ...opts, dry_run: dry, statuses: Object.keys(pick).filter((k) => pick[k]).join(",") });
            setReport(r);
            if (!dry) toast.success(`Imported ${r.saved} contacts into the list.`);
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const c = report?.counts || {};
    return (
        <div className="grid xl:grid-cols-2 gap-6" data-testid="mk-verify">
            <Panel title="Check addresses (paste up to 200)">
                <textarea rows={6} className={box} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"one per line, or separated by commas\nrohan@gmial.com\ninfo@school.edu.in"} />
                <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={useSes} onChange={(e) => setUseSes(e.target.checked)} />
                    Also ask Amazon SES whether each mailbox exists (≈ $0.01 each, never twice for the same address)</label>
                <button type="button" className={`${btn} bg-[#002B5C] text-white mt-2`} onClick={runQuick} disabled={busy}>{busy ? "Checking…" : "Check"}</button>
                {quick && (
                    <table className="w-full text-xs mt-3" data-testid="mk-quick-results"><tbody>
                        {quick.results.map((r, i) => (
                            <tr key={i} className="border-t"><td className="py-1 font-mono pr-2">{r.email || r.input}</td>
                                <td className="pr-2 font-medium" style={{ color: STATUS_COLORS[r.status] }}>{r.status}</td>
                                <td className="text-[#6B7280]">{r.reasons.join("; ")}</td></tr>
                        ))}
                    </tbody></table>
                )}
            </Panel>
            <Panel title="Import a list (Excel or CSV)">
                <div className="space-y-3 text-sm">
                    <input ref={fileIn} type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setReport(null); }} />
                    <p className="text-xs text-[#6B7280]">Needs an “email” column; “name” and “phone” are picked up if present. Up to 50,000 rows.</p>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={opts.autofix} onChange={(e) => setOpts({ ...opts, autofix: e.target.checked })} /> Fix obvious typos (gmial.com → gmail.com)</label>
                    <button type="button" className={`${btn} border border-[#002B5C] text-[#002B5C]`} onClick={() => run(true)} disabled={busy || !file} data-testid="mk-dry-run">{busy ? "Checking…" : "1. Check the file (nothing is saved)"}</button>
                    {report && (
                        <div className="space-y-3" data-testid="mk-import-report">
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                                {[["total", "Rows"], ["verified", "Verified"], ["valid", "Valid"], ["risky", "Risky"], ["invalid", "Invalid"], ["suppressed", "Bounced/unsub before"]].map(([k, l]) => {
                                    const selectable = k in pick;
                                    const on = selectable && pick[k];
                                    const body = (
                                        <>
                                            <div className="text-lg font-serif" style={{ color: STATUS_COLORS[k] || "#002B5C" }}>{c[k] || 0}</div>
                                            <div className="text-[10px] text-[#6B7280]">{l}</div>
                                            {selectable && report.dry_run && <input type="checkbox" className="mt-1" checked={on} readOnly tabIndex={-1} aria-hidden="true" />}
                                        </>
                                    );
                                    return selectable && report.dry_run ? (
                                        <button key={k} type="button" aria-pressed={on} onClick={() => setPick({ ...pick, [k]: !pick[k] })} data-testid={`mk-pick-${k}`}
                                            className={`border p-2 ${on ? "border-[#002B5C] bg-white" : "border-[#E5E7EB] opacity-60"}`} title={on ? "Will be imported — click to leave out" : "Left out — click to import"}>
                                            {body}
                                        </button>
                                    ) : <div key={k} className="border border-[#E5E7EB] p-2">{body}</div>;
                                })}
                            </div>
                            {report.ses && report.ses.enabled && report.ses.to_check > 0 && (
                                <div className="text-xs bg-[#F5F7FA] p-2" data-testid="mk-import-ses">
                                    {report.dry_run ? "After import, " : "Now running in the background: "}
                                    <b>{report.ses.to_check}</b> address{report.ses.to_check === 1 ? "" : "es"} get an Amazon SES mailbox check (≈ ₹{report.ses.est_inr}).
                                    Ones SES says don't exist become invalid; any still unchecked are checked automatically when a campaign is sent.
                                    <SesUsage u={report.ses} />
                                </div>
                            )}
                            <div className="text-xs text-[#4B5563]">{c.duplicates_in_file || 0} duplicates removed · {c.fixed || 0} typos fixed · columns: email “{report.columns.email}”{report.columns.name ? `, name “${report.columns.name}”` : ""}{report.columns.phone ? `, phone “${report.columns.phone}”` : ""}</div>
                            {Object.entries(report.sample || {}).filter(([k]) => ["invalid", "risky", "suppressed"].includes(k)).map(([k, rows]) => (
                                <details key={k} className="text-xs"><summary className="cursor-pointer" style={{ color: STATUS_COLORS[k] }}>{k}: examples</summary>
                                    <ul className="mt-1 space-y-0.5">{rows.map((r, i) => <li key={i} className="font-mono">{r.input} <span className="text-[#6B7280] font-sans">— {r.reasons.join("; ")}</span></li>)}</ul>
                                </details>
                            ))}
                            {report.dry_run && (
                                <div className="border-t pt-3 space-y-2">
                                    <input className={box} placeholder="List name, e.g. Law Summit 2026 attendees" value={opts.list_name} onChange={(e) => setOpts({ ...opts, list_name: e.target.value })} />
                                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={opts.consent_email} onChange={(e) => setOpts({ ...opts, consent_email: e.target.checked })} />These people agreed to receive marketing <b>emails</b> from Oakbridge</label>
                                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={opts.consent_whatsapp} onChange={(e) => setOpts({ ...opts, consent_whatsapp: e.target.checked })} />…and marketing <b>WhatsApp</b> messages</label>
                                    {(opts.consent_email || opts.consent_whatsapp) && (
                                        <input className={box} placeholder="Where did they agree? e.g. 'Summit registration form, opt-in box'" value={opts.consent_source} onChange={(e) => setOpts({ ...opts, consent_source: e.target.value })} />
                                    )}
                                    <p className="text-xs text-[#6B7280]">Without consent the contacts are saved but no campaign will go to them. Invalid and previously bounced/unsubscribed addresses are never imported.</p>
                                    <button type="button" className={`${btn} bg-[#002B5C] text-white`} onClick={() => run(false)} data-testid="mk-import"
                                        disabled={busy || !Object.values(pick).some(Boolean)}>2. Import {["verified", "valid", "risky"].reduce((a, k) => a + (pick[k] ? c[k] || 0 : 0), 0)} contacts</button>
                                    <p className="text-xs text-[#6B7280]">Click Verified / Valid / Risky above to choose which to import.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Panel>
            <Panel title="How verification works (free)">
                <ol className="list-decimal pl-5 text-sm space-y-1 text-[#374151]">
                    <li>Format, duplicates (one Gmail inbox counted once), obvious typos.</li>
                    <li>Throwaway domains and role addresses (info@, admin@ — marked risky).</li>
                    <li>Does the domain receive email at all (its mail server is looked up).</li>
                    <li>Already proven: confirmed accounts and anyone we delivered to before → <b style={{ color: STATUS_COLORS.verified }}>verified</b>.</li>
                    <li><b>Amazon SES mailbox check</b> for everyone not yet proven: does the mailbox exist, is it random or throwaway (≈ $0.01 each, within the monthly cap in Settings).</li>
                    <li>Bounced, complained or unsubscribed before → never mailed again.</li>
                    <li>While sending: verified first, risky last; the campaign auto-pauses above the bounce limit.</li>
                </ol>
                <p className="text-xs text-[#6B7280] mt-2">SES gives a confidence, not a guarantee: the odd address it passes may still bounce once — it is then suppressed automatically.</p>
            </Panel>
        </div>
    );
}

/* ------------------------------------------------------------- settings --- */
function Settings() {
    const { user } = useAuth();
    const su = isSuperadmin(user?.role);
    const [s, setS] = useState(null);
    const [h, setH] = useState(null);
    const load = useCallback(() => {
        mkSettings().then((x) => setS({ ...x, extra_disposable_text: (x.extra_disposable || []).join("\n") })).catch(() => setS({ error: true }));
        mkHealth().then(setH).catch(() => setH({ ok: false }));
    }, []);
    useEffect(load, [load]);
    if (!s) return <p className="text-sm">Loading…</p>;
    if (s.error) return <p className="text-sm text-[#CC0033]">Could not load.</p>;
    const save = async () => {
        try {
            const body = { from_name: s.from_name, from_email: s.from_email, reply_to: s.reply_to, footer: s.footer, logo: s.logo,
                double_opt_in: s.double_opt_in, include_role_addresses: s.include_role_addresses, max_bounce: Number(s.max_bounce),
                ses_validation: !!s.ses_validation, ses_budget_inr: Math.max(0, Number(s.ses_budget_inr) || 0), usd_inr: Number(s.usd_inr) || 88,
                risk_policy: s.risk_policy, tail_max_bounce: Number(s.tail_max_bounce),
                wa_rate_marketing: Number(s.wa_rate_marketing), wa_rate_utility: Number(s.wa_rate_utility),
                extra_disposable: s.extra_disposable_text.split(/\s+/).filter(Boolean) };
            await mkSaveSettings(body);
            toast.success("Saved.");
            load();
        } catch (e) { toast.error(formatApiError(e)); }
    };
    const F = (k, label, props = {}) => (
        <label className="block text-sm">{label}<input className={box} value={s[k] ?? ""} disabled={!su} onChange={(e) => setS({ ...s, [k]: e.target.value })} {...props} /></label>
    );
    return (
        <div className="grid xl:grid-cols-2 gap-6" data-testid="mk-settings">
            <Panel title="Sender">
                <div className="space-y-2">
                    {F("from_name", "From name")}
                    {F("from_email", "From address (must be verified in SES)")}
                    {F("reply_to", "Reply-to (optional)")}
                    {F("logo", "Logo image URL for the email header (optional)")}
                    <label className="block text-sm">Footer (company name and postal address — required in marketing email)
                        <textarea rows={3} className={box} value={s.footer || ""} disabled={!su} onChange={(e) => setS({ ...s, footer: e.target.value })} /></label>
                </div>
            </Panel>
            <Panel title="Rules">
                <div className="space-y-2 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!s.double_opt_in} disabled={!su} onChange={(e) => setS({ ...s, double_opt_in: e.target.checked })} />Double opt-in for website sign-ups (they confirm by email first)</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!s.include_role_addresses} disabled={!su} onChange={(e) => setS({ ...s, include_role_addresses: e.target.checked })} />Treat role addresses (info@, admin@) as normal</label>
                    {F("max_bounce", "Auto-pause when bounces exceed (0.02 = 2%)", { type: "number", step: "0.005" })}
                    <div className="border-t border-[#E5E7EB] pt-2 space-y-2">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!s.ses_validation} disabled={!su} onChange={(e) => setS({ ...s, ses_validation: e.target.checked })} data-testid="mk-ses-validation" />
                            Check every new address with Amazon SES Email Validation before mailing it (≈ $0.01 per address)</label>
                        <div className="grid grid-cols-2 gap-2">
                            {F("ses_budget_inr", "Monthly budget for mailbox checks, ₹", { type: "number", step: "50", min: "0" })}
                            {F("usd_inr", "USD → ₹ rate (for estimates)", { type: "number", step: "0.5" })}
                        </div>
                        <SesUsage u={s.ses_usage} />
                        {s.waiting_checks > 0 && <p className="text-xs text-[#6B7280]">{s.waiting_checks} contacts not checked yet — they're checked in the background, or when a campaign is sent to them.</p>}
                        <div className="text-sm font-medium text-[#002B5C] pt-1">Risky addresses — what campaigns do with them</div>
                        {["role", "catch_all", "unconfirmed"].map((kk) => (
                            <label key={kk} className="flex items-center justify-between gap-2 text-sm">
                                <span>{RISK_LABEL[kk]}</span>
                                <select className="border border-[#E5E7EB] px-2 py-1" disabled={!su} value={(s.risk_policy || {})[kk] || "skip"}
                                    onChange={(e) => setS({ ...s, risk_policy: { ...(s.risk_policy || {}), [kk]: e.target.value } })} data-testid={`mk-risk-${kk}`}>
                                    <option value="send">Send</option><option value="tail">Send last (stops itself if it bounces)</option><option value="skip">Skip</option>
                                </select>
                            </label>
                        ))}
                        {F("tail_max_bounce", "“Send last” stops itself above this bounce rate (0.03 = 3%)", { type: "number", step: "0.005" })}
                    </div>
                    {F("wa_rate_marketing", "WhatsApp marketing cost per message, ₹ (for estimates)", { type: "number", step: "0.01" })}
                    {F("wa_rate_utility", "WhatsApp utility cost per message, ₹", { type: "number", step: "0.01" })}
                    <label className="block">Extra throwaway domains to block (one per line)
                        <textarea rows={3} className={box} value={s.extra_disposable_text} disabled={!su} onChange={(e) => setS({ ...s, extra_disposable_text: e.target.value })} /></label>
                </div>
            </Panel>
            <Panel title="Amazon SES">
                {!h ? <p className="text-sm">Checking…</p> : h.ok ? (
                    <ul className="text-sm space-y-1" data-testid="mk-ses-health">
                        <li>Region: <b>{h.region}</b></li>
                        <li>Sending enabled: <b className={h.sending_enabled ? "text-[#15803D]" : "text-[#CC0033]"}>{String(h.sending_enabled)}</b></li>
                        <li>Production access: <b className={h.production ? "text-[#15803D]" : "text-[#B4750F]"}>{h.production ? "yes" : "no — sandbox: only verified recipients"}</b></li>
                        <li>Quota: {h.sent_24h ?? 0} of {h.max_24h ?? "?"} in 24h · up to {h.max_rate ?? "?"}/second</li>
                        <li>Sender identity: {h.identity ? <><b>{h.identity.name}</b> — {h.identity.verified ? "verified" : "NOT verified"}, DKIM {h.identity.dkim || "?"}</> : <span className="text-[#CC0033]">not found in this region</span>}</li>
                        <li>Last 30 days: bounce {pct(h.last30?.bounce_rate, 2)} · complaints {pct(h.last30?.complaint_rate, 2)}</li>
                    </ul>
                ) : <p className="text-sm text-[#CC0033]">Could not reach SES: {h.error}</p>}
            </Panel>
            <Panel title="Bounce & complaint events (SNS)">
                <div className="text-sm space-y-2">
                    <div>Configuration set: <b>{s.configuration_set || "not set (SES_CONFIGURATION_SET)"}</b></div>
                    <div>Subscribe this HTTPS endpoint to the SNS topic that receives the configuration set's events:
                        <code className="block mt-1 p-2 bg-[#F5F7FA] text-xs break-all" data-testid="mk-sns-url">{s.sns_url}</code></div>
                    <div className="text-xs text-[#4B5563]">Event types: Delivery, Bounce, Complaint, Reject. Leave Open/Click tracking OFF in SES — the site tracks those itself.</div>
                    <div className="text-xs">Last event: {s.last_ses_event ? `${s.last_ses_event.type} at ${when(s.last_ses_event.at)}` : "none received yet"}</div>
                    <div className="text-xs">AWS suppression list copied into Contacts daily — last: {s.suppression_sync?.suppression_synced_at ? `${when(s.suppression_sync.suppression_synced_at)} (+${s.suppression_sync.suppression_last_added ?? 0})` : "not yet"}{" "}
                        <button type="button" className="underline" onClick={async () => {
                            try { const r = await mkSuppressionSync(); if (r.ok === false) toast.error(`AWS said: ${r.error}`); else toast.success(`Synced: ${r.suppressed ?? 0} newly suppressed.`); load(); } catch (e) { toast.error(formatApiError(e)); }
                        }}>Sync now</button></div>
                </div>
            </Panel>
            {su ? <button type="button" className={`${btn} bg-[#002B5C] text-white w-max`} onClick={save}>Save settings</button>
                : <p className="text-xs text-[#6B7280]">Only a superadmin can change these.</p>}
        </div>
    );
}
