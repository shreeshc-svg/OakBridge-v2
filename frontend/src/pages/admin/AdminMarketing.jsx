import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Mail, MessageCircle, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
    mkDashboard, mkHealth, mkProviders, mkSettings, mkSaveSettings, mkVerify, mkImport, mkImportEstimate, mkImports, mkImportApprove, mkImportReject, mkReverify, mkSync, mkContacts, mkPatchContact,
    mkDeleteContact, mkLists, mkCreateList, mkCampaigns, mkNewCampaign, mkCampaign, mkSaveCampaign, mkDuplicate,
    mkAudience, mkPreview, mkTemplates, mkNewTemplate, mkSaveTemplate, mkDeleteTemplate, mkUseTemplate, mkTemplatePreview, mkUploadEmailImage, mkExportCampaign, mkExportContacts, mkCleanup, mkGrowthFunnel, mkPartners, mkNewPartner, mkSavePartner, mkAutomations, mkSaveAutomations, mkAutomationsPreview, MERCHANT_FEED_URL, mkTestSend, mkSend, mkCampaignAction, mkReport, mkDismissAlert, mkSuppressionSync,
    mkBulkContacts, mkBulkDeleteLists, mkBulkDeleteCampaigns, mkRenameCampaign, mkLearn, mkDisposableRefresh, mkSystemHealth, nlOverview, nlSave, nlDraftNow, nlApprove, nlSkip, fetchBooks, fetchCategories, mediaUrl, formatApiError,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin, canDelete } from "../../lib/rbac";
import { LineChart, BarChart, Funnel, Donut, Kpi, pct, inr } from "../../components/marketing/Charts";
import { StepsTable, GrowthInsights, OfficeNetwork } from "../../components/marketing/GrowthInsights";
import { GROWTH_PERIODS, growthPeriod, growthPeriodLabel } from "../../lib/dateRange";

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
const TABS = [["dash", "Dashboard"], ["growth", "Growth"], ["campaigns", "Campaigns"], ["templates", "Templates"], ["newsletter", "Newsletter"], ["contacts", "Contacts"], ["lists", "Lists & segments"], ["verify", "Verify & import"], ["settings", "Settings"]];
const STATUS_COLORS = { verified: "#15803D", valid: "#38bdf8", risky: "#F59E0B", invalid: "#CC0033", suppressed: "#6B7280", unknown: "#D1D5DB" };
const SELECTABLE = [["verified", "Verified", "proven: confirmed account or delivered before"],
    ["valid", "Valid", "mailbox checked"], ["risky", "Risky", "follows the risk rules in Settings"]];
// What a campaign to a static list would do, by the current risky-address
// rules (backend adm_lists): confirmed + risky sent + risky sent last; skipped.
const listReach = (l) => {
    const r = l.risky && typeof l.risky === "object" ? l.risky : { send: 0, tail: 0, skip: 0 };
    const parts = [`${l.confirmed ?? l.sendable ?? 0} confirmed`];
    if (r.send) parts.push(`${r.send} unconfirmed sent`);
    if (r.tail) parts.push(`${r.tail} unconfirmed sent last`);
    const head = `${l.sendable ?? 0} would be emailed (${parts.join(" + ")})`;
    return r.skip ? `${head} · ${r.skip} skipped by your risky-address rules` : head;
};

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
    // ?campaign=<id> (from Admin → Users → "Email selected") opens that draft.
    const deep = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("campaign") : null;
    const [tab, setTab] = useState(deep ? "campaigns" : "dash");
    const [openCampaign, setOpenCampaign] = useState(deep || null);
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
                    : <CampaignList onOpen={setOpenCampaign} onTemplates={() => setTab("templates")} />)}
                {tab === "growth" && <Growth onOpen={(id) => { setTab("campaigns"); setOpenCampaign(id); }} />}
                {tab === "templates" && <Templates onOpen={(id) => { setTab("campaigns"); setOpenCampaign(id); }} />}
                {tab === "contacts" && <Contacts />}
                {tab === "lists" && <Lists />}
                {tab === "verify" && <VerifyImport />}
                {tab === "newsletter" && <Newsletter onOpen={(id) => { setTab("campaigns"); setOpenCampaign(id); }} />}
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
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
            <AccuracyPanel a={d.accuracy} onLearned={() => mkDashboard(days).then(setD).catch(() => {})} />
            <Panel title="Campaigns in this period">
                <CampaignTable rows={d.campaigns} onOpen={onOpen} />
            </Panel>
        </div>
    );
}

/** 0-100 confidence chip, coloured by band. */
function ScoreChip({ score, th }) {
    if (score == null) return null;
    const v = th?.valid ?? 65;
    const iv = th?.invalid ?? 35;
    const col = score >= v ? "#15803D" : score >= iv ? "#B4750F" : "#CC0033";
    return <span className="ml-1 text-[10px] font-mono border px-1" style={{ color: col, borderColor: col }} title="Confidence the address works (0–100)">{score}</span>;
}

/** Dashboard: how right the flags were, and what the learning changed. */
function AccuracyPanel({ a, onLearned }) {
    const [busy, setBusy] = useState(false);
    if (!a) return null;
    const rows = ["verified", "valid", "risky"].map((k) => [k, a.bands?.[k]]);
    const learn = async () => {
        setBusy(true);
        try { const r = await mkLearn(); toast.success(r.sent ? `Learned from ${r.sent} sends.` : "Not enough sends yet to learn from."); onLearned(); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const adj = Object.entries(a.adjust || {}).filter(([, v]) => v);
    return (
        <Panel title="Address accuracy & self-learning" right={<button type="button" className="text-xs underline" disabled={busy} onClick={learn}>{busy ? "Learning…" : "Learn now"}</button>}>
            <div className="grid md:grid-cols-2 gap-4 text-sm" data-testid="mk-accuracy">
                <div>
                    <div className="text-xs text-[#4B5563] mb-1">What actually bounced, by what we believed when sending (last 90 days)</div>
                    <table className="w-full text-sm"><thead><tr className="text-left text-xs text-[#6B7280]"><th className="py-1">Flagged as</th><th className="text-right">Sent</th><th className="text-right">Hard bounces</th></tr></thead>
                        <tbody>{rows.map(([k, b]) => (
                            <tr key={k} className="border-t"><td className="py-1" style={{ color: STATUS_COLORS[k] }}>{k}</td>
                                <td className="text-right">{b?.sent ?? 0}</td>
                                <td className={`text-right ${(b?.rate || 0) > 0.02 ? "text-[#CC0033] font-medium" : ""}`}>{b ? pct(b.rate, 1) : "—"}</td></tr>
                        ))}</tbody></table>
                    <p className="text-[11px] text-[#6B7280] mt-1">Good flags: verified ≈ 0%, valid under 2%, risky clearly higher.</p>
                </div>
                <div>
                    <div className="text-xs text-[#4B5563]">Valid from score <b>{a.thresholds?.valid}</b> · invalid below <b>{a.thresholds?.invalid}</b> · learning {a.auto ? "on" : "off"}
                        {a.learned_at && <> · last learned {when(a.learned_at)}</>}</div>
                    {adj.length ? (
                        <ul className="text-xs mt-2 space-y-0.5">{adj.map(([k, v]) => (
                            <li key={k}>{a.labels?.[k] || k}: {a.base?.[k] >= 0 ? "+" : ""}{a.base?.[k]} → <b>{(a.base?.[k] || 0) + v >= 0 ? "+" : ""}{(a.base?.[k] || 0) + v}</b>
                                <span className="text-[#6B7280]"> (learned {v > 0 ? "+" : ""}{v} from {a.samples?.[k]?.sent ?? "?"} sends)</span></li>
                        ))}</ul>
                    ) : <p className="text-xs text-[#6B7280] mt-2">Nothing learned yet — each signal needs about 30 sent emails before its weight moves. It runs daily on its own.</p>}
                </div>
            </div>
        </Panel>
    );
}

/** Settings: what the checker has learned from real bounces (backend learn_providers). */
function LearnedProviders() {
    const [d, setD] = useState(null);
    useEffect(() => { mkProviders().then(setD).catch(() => setD({ rows: [] })); }, []);
    if (!d) return null;
    return (
        <Panel title="Learned from bounces">
            <p className="text-xs text-[#6B7280] mb-2">
                Updated before every campaign. <b>Skipped provider</b>: its unconfirmed addresses bounced above {Math.round((d.rules?.max_bounce || 0.08) * 100)}% over {d.rules?.min_sends || 20}+ sends, so they are skipped until proven (a delivered, opened or clicked email).{" "}
                <b>No paid checks</b>: Amazon can't confirm mailboxes there, so we stop paying ₹0.88 per address. <b>Dead company domain</b>: several different people bounced.
            </p>
            {!d.rows?.length ? <p className="text-sm text-[#6B7280]">Nothing learned yet.</p> : (
                <table className="w-full text-xs" data-testid="mk-learned"><thead><tr className="text-left text-[#4B5563]"><th className="py-1">Provider</th><th>Learned</th><th className="text-right">Unconfirmed sent</th><th className="text-right">Bounced</th><th className="text-right">SES checks (confirmed)</th></tr></thead>
                    <tbody>{d.rows.map((r) => (
                        <tr key={r.domain} className="border-t"><td className="py-1 font-mono">{r.domain}</td>
                            <td>{[r.bad_provider && "skipped provider", r.ses_unverifiable && "no paid checks", r.bad && "dead company domain"].filter(Boolean).join(" · ")}</td>
                            <td className="text-right">{r.unproven_sent ?? 0}</td><td className="text-right">{r.unproven_bounced ?? 0}</td>
                            <td className="text-right">{r.ses_checks ?? 0} ({r.ses_confirmed ?? 0})</td></tr>
                    ))}</tbody></table>
            )}
        </Panel>
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

function CampaignTable({ rows = [], onOpen, sel, onDelete, onRename }) {
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
                            <td className="py-2">{c.channel === "whatsapp" ? <MessageCircle size={13} className="inline mr-1 text-[#15803D]" /> : <Mail size={13} className="inline mr-1 text-[#002B5C]" />}{c.name}
                                {onRename && <button type="button" aria-label={`Rename ${c.name}`} title="Rename" className="ml-2 text-[#6B7280] hover:text-[#002B5C] align-middle"
                                    onClick={(e) => { e.stopPropagation(); onRename(c); }} data-testid="mk-camp-rename"><Pencil size={12} /></button>}</td>
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
/** Rename any campaign (internal name — safe even after sending). Returns the new name or null. */
async function renameCampaign(id, current) {
    const name = window.prompt("Campaign name (only your team sees this)", current || "");
    if (name === null || !name.trim() || name.trim() === current) return null;
    try { const r = await mkRenameCampaign(id, name.trim()); toast.success("Renamed."); return r.name; }
    catch (e) { toast.error(formatApiError(e)); return null; }
}

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

function CampaignList({ onOpen, onTemplates }) {
    const { user } = useAuth();
    const [rows, setRows] = useState(null);
    const sel = useSelection();
    const load = useCallback(() => { mkCampaigns().then(setRows).catch(() => setRows([])); }, []);
    useEffect(load, [load]);
    const del = async (ids) => { if (await deleteCampaigns(ids, rows)) { sel.clear(); load(); } };
    const create = async (channel, kind) => {
        const suggested = kind === "reconfirm" ? "Re-confirm subscribers" : channel === "email" ? "New email campaign" : "New WhatsApp campaign";
        const asked = window.prompt("Name this campaign (only your team sees this)", suggested);
        if (asked === null) return;
        const name = asked.trim() || suggested;
        try { const c = await mkNewCampaign({ channel, name, kind }); onOpen(c.id); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <button type="button" className={`${btn} bg-[#002B5C] text-white inline-flex items-center gap-2`} onClick={() => create("email")} data-testid="mk-new-email"><Mail size={15} /> New email campaign</button>
                <button type="button" className={`${btn} border border-[#002B5C] text-[#002B5C]`} onClick={onTemplates} data-testid="mk-from-template">Start from a template</button>
                <button type="button" className={`${btn} border border-[#15803D] text-[#15803D] inline-flex items-center gap-2`} onClick={() => create("whatsapp")}><MessageCircle size={15} /> New WhatsApp campaign</button>
                <button type="button" className={`${btn} border border-[#7c3aed] text-[#7c3aed]`} onClick={() => create("email", "reconfirm")} data-testid="mk-new-reconfirm"
                    title="Ask an old list to click to stay subscribed; those who don't stop getting campaigns">New re-confirm campaign</button>
            </div>
            <BulkBar count={sel.sel.size} onClear={sel.clear}>
                {canDelete(user) && <button type="button" className={bulkBtn} onClick={() => del([...sel.sel])} data-testid="mk-camp-bulk-delete">Delete</button>}
            </BulkBar>
            {!rows ? <p className="text-sm text-[#4B5563]">Loading…</p> : (
                <div className="bg-white border border-[#E5E7EB] p-4">
                    <CampaignTable rows={rows} onOpen={onOpen} sel={canDelete(user) ? sel : undefined} onDelete={canDelete(user) ? del : undefined}
                        onRename={async (c) => { if (await renameCampaign(c.id, c.name)) load(); }} />
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
                <span className="font-medium text-[#002B5C]">{c.name}</span>
                <button type="button" aria-label="Rename campaign" title="Rename" className="text-[#6B7280] hover:text-[#002B5C]" data-testid="mk-camp-rename-view"
                    onClick={async () => { const n = await renameCampaign(c.id, c.name); if (n) setC({ ...c, name: n }); }}><Pencil size={14} /></button>
                <button type="button" className="ml-auto border px-3 py-1 text-sm" onClick={async () => { try { const d = await mkDuplicate(id); toast.success("Copied as a new draft."); onOpen(d.id); } catch (e) { toast.error(formatApiError(e)); } }}>Duplicate</button>
                {canDelete(user) && <button type="button" className="border border-[#CC0033] text-[#CC0033] px-3 py-1 text-sm inline-flex items-center gap-1"
                    onClick={async () => { if (await deleteCampaigns([id], [c])) onBack(); }} data-testid="mk-camp-delete"><Trash2 size={13} /> Delete</button>}
            </div>
            {editable ? <CampaignEditor c={c} setC={setC} reload={load} /> : <CampaignReport id={id} status={c.status} reload={load} />}
        </div>
    );
}

const BLOCK_TYPES = [["heading", "Heading"], ["text", "Text"], ["image", "Image"], ["button", "Button"], ["book", "Book"], ["for_you", "Picked for you"], ["divider", "Divider"], ["spacer", "Space"]];

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
                wa_template: c.wa_template, wa_language: c.wa_language, wa_variables: c.wa_variables,
                ...(c.kind === "reconfirm" ? { reconfirm_days: Number(c.reconfirm_days) || 30 } : {}) };
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
    const saveAsTemplate = async () => {
        const s = await save(true);
        if (!s) return;
        const name = window.prompt("Name the template (your team sees this in Templates)", c.name || "");
        if (name === null) return;
        try { await mkNewTemplate({ name: name.trim() || c.name, from_campaign_id: c.id }); toast.success("Saved to Templates."); } catch (e) { toast.error(formatApiError(e)); }
    };
    const send = async () => {
        // Template placeholders like "[book title]" left in (markdown links
        // "[text](url)" are not placeholders).
        const left = placeholdersIn([c.subject, c.preheader, ...(c.blocks || []).flatMap((b) => [b.text, b.label])]);
        if (left.length && !window.confirm(`This email still has placeholder text: ${left.slice(0, 6).join(", ")}.\n\nSend anyway?`)) return;
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
                {c.kind === "reconfirm" && (
                    <div className="border border-[#7c3aed] bg-white p-3 text-sm space-y-2" data-testid="mk-reconfirm-info">
                        <b className="text-[#5b21b6]">Re-confirm campaign</b>
                        <p>Anyone who <b>clicks any link</b> in it is re-confirmed: their address becomes verified and their consent is renewed (opens don't count — Apple Mail opens everything).
                            Those who don't click stop getting campaigns after the window below. Inactive (retired) addresses are included — this is their way back.</p>
                        <label className="flex items-center gap-2">Window <input type="number" min="7" max="90" className="border border-[#E5E7EB] px-2 py-1 w-20" value={c.reconfirm_days || 30}
                            onChange={(e) => patch({ reconfirm_days: e.target.value })} /> days</label>
                    </div>
                )}
                <Panel title="Details">
                    <div className="space-y-2 text-sm">
                        <label className="block">Campaign name (internal)<input className={box} value={c.name || ""} onChange={(e) => patch({ name: e.target.value })} /></label>
                        {isEmail ? (
                            <>
                                <label className="block">Subject line <span className="text-xs text-[#6B7280]">— variables like {"{{first_name}}"} work here (list below)</span>
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
                        <div className="mt-3"><VariablesHelp /></div>
                        <button type="button" className="mt-3 underline text-xs" onClick={saveAsTemplate} data-testid="mk-save-as-template">Save this email as a template</button>
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

/* ----------------------------------------------------------------- growth --- */
const pctTxt = (v) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`);

function Growth({ onOpen }) {
    const { user } = useAuth();
    const su = isSuperadmin(user?.role);
    // Period: a preset (Today … Last year) or a custom from/to — lib/dateRange.
    const [pkey, setPkey] = useState("30d");
    const [cFrom, setCFrom] = useState("");
    const [cTo, setCTo] = useState("");
    const period = growthPeriod(pkey, { from: cFrom, to: cTo });
    const pk = period ? `${period.start}_${period.end}` : "";
    const [f, setF] = useState(null);
    const [partners, setPartners] = useState(null);
    const [kinds, setKinds] = useState({});
    const [auto, setAuto] = useState(null);
    const [preview, setPreview] = useState(null);
    const [np, setNp] = useState({ name: "", kind: "author", code: "", discount_percent: 10, email: "" });
    const loadFunnel = useCallback(() => { if (period) mkGrowthFunnel(period).then(setF).catch((e) => toast.error(formatApiError(e))); }, [pk]); // eslint-disable-line react-hooks/exhaustive-deps
    const loadPartners = useCallback(() => { mkPartners().then((r) => { setPartners(r.partners || []); setKinds(r.kinds || {}); }).catch(() => setPartners([])); }, []);
    const loadAuto = useCallback(() => { mkAutomations().then(setAuto).catch(() => {}); }, []);
    useEffect(loadFunnel, [loadFunnel]);
    useEffect(() => { loadPartners(); loadAuto(); }, [loadPartners, loadAuto]);
    const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast.success("Copied."); } catch { toast.message(t); } };
    const addPartner = async () => {
        if (!np.name.trim() || !np.code.trim()) return toast.error("Name and code are needed.");
        if (!window.confirm(`Create partner “${np.name}” with code ${np.code.toUpperCase()} (${np.discount_percent}% off for their readers)?`)) return;
        try { const p = await mkNewPartner(np); toast.success("Partner created — copy their link below."); copy(p.link); setNp({ ...np, name: "", code: "", email: "" }); loadPartners(); }
        catch (e) { toast.error(formatApiError(e)); }
    };
    const togglePartner = async (p) => {
        if (!window.confirm(`${p.active ? "Switch off" : "Switch on"} ${p.name}? ${p.active ? "Their discount code stops working." : ""}`)) return;
        try { await mkSavePartner(p.id, { active: !p.active }); loadPartners(); } catch (e) { toast.error(formatApiError(e)); }
    };
    const saveAuto = async (key, patch) => {
        const next = { ...auto.config[key], ...patch };
        if (patch.enabled !== undefined && !window.confirm(`${patch.enabled ? "Switch on" : "Switch off"} the ${key === "abandoned" ? "abandoned-checkout" : "review-request"} email?`)) return;
        try { const r = await mkSaveAutomations({ [key]: next }); setAuto({ ...auto, config: r.config }); toast.success("Saved."); } catch (e) { toast.error(formatApiError(e)); }
    };
    const runPreview = async () => { try { setPreview(await mkAutomationsPreview()); } catch (e) { toast.error(formatApiError(e)); } };
    const inp = "border border-[#E5E7EB] px-2 py-1.5 text-sm";
    return (
        <div className="space-y-6" data-testid="mk-growth">
            <Panel title="Where buyers come from" right={
                <div className="flex flex-wrap items-center gap-2 justify-end">
                    <select className={inp} value={pkey} onChange={(e) => setPkey(e.target.value)} data-testid="mk-growth-period" aria-label="Period">
                        {GROWTH_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    {pkey === "custom" && (
                        <>
                            <input type="date" className={inp} value={cFrom} onChange={(e) => setCFrom(e.target.value)} aria-label="From" />
                            <span className="text-xs text-[#6B7280]">to</span>
                            <input type="date" className={inp} value={cTo} onChange={(e) => setCTo(e.target.value)} aria-label="To" />
                        </>
                    )}
                </div>}>
                {!f ? <p className="text-sm text-[#4B5563]">Loading…</p> : (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                            <Kpi label="Visits" value={f.total.visits.toLocaleString("en-IN")} />
                            <Kpi label="Checkouts started" value={f.total.checkouts} />
                            <Kpi label="Paid orders" value={f.total.paid} />
                            <Kpi label="Revenue" value={inr(f.total.revenue)} sub={`${pctTxt(f.total.visit_to_paid)} of visits buy`} />
                        </div>
                        <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="mk-growth-funnel">
                            <thead><tr className="text-left text-[#4B5563]"><th className="py-1">Channel</th><th className="text-right">Visits</th><th className="text-right">Checkouts</th><th className="text-right">Paid</th><th className="text-right">Revenue</th><th className="text-right">Visit → paid</th><th className="text-right">Checkout → paid</th></tr></thead>
                            <tbody>{f.rows.filter((r) => r.visits || r.checkouts).map((r) => (
                                <tr key={r.channel} className="border-t border-[#E5E7EB]"><td className="py-1">{r.channel}</td><td className="text-right">{r.visits}</td><td className="text-right">{r.checkouts}</td>
                                    <td className="text-right font-medium">{r.paid}</td><td className="text-right">{inr(r.revenue)}</td><td className="text-right">{pctTxt(r.visit_to_paid)}</td><td className="text-right">{pctTxt(r.checkout_to_paid)}</td></tr>
                            ))}</tbody>
                        </table></div>
                        <p className="text-xs text-[#6B7280] mt-2">
                            <b className="text-[#002B5C]">{growthPeriodLabel({ start: f.since, end: f.until || f.since })}.</b>{" "}
                            {f.empty
                                ? <>Visits were not being counted yet in this period (counting began later), so there is nothing to compare. </>
                                : f.clamped && <>Visits have only been counted since {growthPeriodLabel({ start: f.since, end: f.since })}, so the period starts there and the rates compare like with like. </>}
                            Visits are counted once per browser session without cookies; bots, staff browsers and the office network are excluded, and so are staff accounts' own orders.
                            Orders use the link the buyer first arrived from (remembered for 30 days when they allowed analytics cookies). A partner code wins over everything else.
                        </p>
                        <StepsTable f={f} />
                        <GrowthInsights period={period} />
                        <OfficeNetwork />
                    </>
                )}
            </Panel>

            <Panel title="Partner links (authors, educators, coaching, dealers)">
                <div className="grid sm:grid-cols-6 gap-2 text-sm" data-testid="mk-partner-new">
                    <input className={`${inp} sm:col-span-2`} placeholder="Name (e.g. Justice K Kannan)" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
                    <select className={inp} value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}>
                        {Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <input className={inp} placeholder="Code e.g. KANNAN10" value={np.code} onChange={(e) => setNp({ ...np, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} />
                    <label className="flex items-center gap-1"><input className={`${inp} w-16`} type="number" min="0" max="50" value={np.discount_percent} onChange={(e) => setNp({ ...np, discount_percent: Number(e.target.value) })} />% off</label>
                    <button type="button" className={`${btn} bg-[#002B5C] text-white`} onClick={addPartner} data-testid="mk-partner-add">Create</button>
                </div>
                <p className="text-xs text-[#6B7280] mt-1">Each partner gets a link (their readers' discount is applied automatically at checkout) and a code they can tell people. Every sale through either is credited to them.</p>
                {!partners ? null : !partners.length ? <p className="text-sm text-[#6B7280] mt-3">No partners yet.</p> : (
                    <div className="overflow-x-auto mt-3"><table className="w-full text-sm" data-testid="mk-partners">
                        <thead><tr className="text-left text-[#4B5563]"><th className="py-1">Partner</th><th>Code</th><th>Link</th><th className="text-right">Visits</th><th className="text-right">Orders</th><th className="text-right">Copies</th><th className="text-right">Revenue</th><th></th></tr></thead>
                        <tbody>{partners.map((p) => (
                            <tr key={p.id} className={`border-t border-[#E5E7EB] ${p.active ? "" : "opacity-50"}`}>
                                <td className="py-1">{p.name}<div className="text-xs text-[#6B7280]">{kinds[p.kind] || p.kind} · {p.discount_percent}% off</div></td>
                                <td className="font-mono">{p.code}</td>
                                <td><button type="button" className="underline text-xs" onClick={() => copy(p.link)}>Copy link</button></td>
                                <td className="text-right">{p.visits}</td><td className="text-right font-medium">{p.orders}</td><td className="text-right">{p.copies}</td><td className="text-right">{inr(p.revenue)}</td>
                                <td className="text-right"><button type="button" className="text-xs underline" onClick={() => togglePartner(p)}>{p.active ? "Switch off" : "Switch on"}</button></td>
                            </tr>
                        ))}</tbody>
                    </table><p className="text-xs text-[#6B7280] mt-1">Last 90 days.</p></div>
                )}
            </Panel>

            <Panel title="Automated emails">
                {!auto ? <p className="text-sm text-[#4B5563]">Loading…</p> : (
                    <div className="space-y-4 text-sm">
                        {[["abandoned", "Abandoned checkout", "Reached payment but didn't pay. One reminder per order with their books and a “Complete my order” button — only to people who agreed to marketing emails, at most once a week."],
                            ["review", "Review request", "After an order is marked delivered: one email asking for a review of the books they haven't reviewed yet. Not to anyone who unsubscribed or bounced."]].map(([k, title, desc]) => (
                            <div key={k} className="border border-[#E5E7EB] p-3" data-testid={`mk-auto-${k}`}>
                                <div className="flex flex-wrap items-center gap-3">
                                    <b className="text-[#002B5C]">{title}</b>
                                    <span className={`text-[10px] font-mono uppercase border px-1.5 py-0.5 ${auto.config[k].enabled ? "border-[#15803D] text-[#15803D]" : "text-[#6B7280]"}`}>{auto.config[k].enabled ? "On" : "Off"}</span>
                                    <span className="text-xs text-[#6B7280]">{auto.stats?.[k]?.sent || 0} sent</span>
                                    {auto.stats?.[k]?.sent > 0 && <button type="button" className="text-xs underline" onClick={() => onOpen(auto.stats[k].campaign_id)}>Report</button>}
                                    {su && <button type="button" className={`${btn} border ml-auto`} onClick={() => saveAuto(k, { enabled: !auto.config[k].enabled })}>{auto.config[k].enabled ? "Switch off" : "Switch on"}</button>}
                                </div>
                                <p className="text-xs text-[#4B5563] mt-1">{desc}</p>
                                {k === "abandoned"
                                    ? <label className="text-xs mt-2 flex items-center gap-2">Send after <input type="number" min="1" max="24" className={`${inp} w-16`} disabled={!su} defaultValue={auto.config.abandoned.delay_hours} onBlur={(e) => su && Number(e.target.value) !== auto.config.abandoned.delay_hours && saveAuto("abandoned", { delay_hours: Number(e.target.value) })} /> hours</label>
                                    : <label className="text-xs mt-2 flex items-center gap-2">Send <input type="number" min="3" max="30" className={`${inp} w-16`} disabled={!su} defaultValue={auto.config.review.days_after_delivery} onBlur={(e) => su && Number(e.target.value) !== auto.config.review.days_after_delivery && saveAuto("review", { days_after_delivery: Number(e.target.value) })} /> days after delivery</label>}
                            </div>
                        ))}
                        <button type="button" className="underline text-xs" onClick={runPreview} data-testid="mk-auto-preview">How many would go out right now?</button>
                        {preview && <div className="text-xs bg-[#F5F7FA] p-2">Abandoned checkout: {preview.abandoned.sent} · Review request: {preview.review.sent}
                            {Object.entries({ ...preview.abandoned.skipped, ...preview.review.skipped }).map(([k, n]) => ` · skipped ${n}: ${k}`).join("")}</div>}
                        {!su && <p className="text-xs text-[#6B7280]">Only a superadmin can switch these on or off.</p>}
                    </div>
                )}
            </Panel>

            <Panel title="Google Merchant Center (free listings)">
                <div className="text-sm space-y-2" data-testid="mk-merchant">
                    <p>Your books in Google Shopping, Images and Search with cover, price and stock — free. Set up once:</p>
                    <ol className="list-decimal pl-5 space-y-1">
                        <li>merchants.google.com → create the account for <b>oakbridge.in</b> (verify the site; shipping: free delivery).</li>
                        <li>Products → Add products → <b>Scheduled fetch</b>, daily, with this URL:</li>
                    </ol>
                    <div className="flex gap-2 items-center"><code className="text-xs bg-[#F5F7FA] px-2 py-1 break-all">{MERCHANT_FEED_URL}</code>
                        <button type="button" className="underline text-xs" onClick={() => copy(MERCHANT_FEED_URL)}>Copy</button></div>
                    <p className="text-xs text-[#6B7280]">Updated live from the catalogue (price, sale price, stock, pre-orders). Sales from it show as “Google Shopping” above.</p>
                </div>
            </Panel>
        </div>
    );
}

/* ------------------------------------------------- export + clean-up --- */
function ExportButtons({ onExport, label = "Export", testid }) {
    const [busy, setBusy] = useState("");
    const run = async (fmt) => {
        setBusy(fmt);
        try { await onExport(fmt); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
    };
    return (
        <span className="inline-flex gap-1" data-testid={testid}>
            <button type="button" className="border px-3 py-1 text-sm" disabled={!!busy} onClick={() => run("xlsx")}>{busy === "xlsx" ? "Preparing…" : `${label} (Excel)`}</button>
            <button type="button" className="border px-3 py-1 text-sm" disabled={!!busy} onClick={() => run("csv")}>{busy === "csv" ? "…" : "CSV"}</button>
        </span>
    );
}

const CLEANUP_DEFAULT = { bounced: true, blocked: true, invalid: true, complained: false, unsubscribed: false };
const CLEANUP_LABELS = {
    bounced: "Bounced (hard bounce, or 3 soft bounces)", blocked: "Blocked by AWS (address unlikely to exist)",
    invalid: "Invalid (failed our checks)", complained: "Marked our email as spam", unsubscribed: "Unsubscribed",
};

/* Remove bounced / blocked / invalid contacts after a send. A hash of each
   address is kept so syncs and old files can't add them back (marketing.py
   adm_contacts_cleanup). Count first; download them; then remove. */
function CleanupPanel({ campaignId = null, onDone = () => {} }) {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [kinds, setKinds] = useState(CLEANUP_DEFAULT);
    const [res, setRes] = useState(null);
    const [busy, setBusy] = useState(false);
    const chosen = Object.keys(kinds).filter((k) => kinds[k]);
    const count = async () => {
        setBusy(true);
        try { setRes(await mkCleanup({ kinds: chosen, campaign_id: campaignId, dry_run: true })); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!res?.total) return;
        if (!window.confirm(`Remove ${res.total} contact(s) from Contacts and every list?\n\n${Object.entries(res.by_kind).map(([k, n]) => `${n} ${CLEANUP_LABELS[k] || k}`).join("\n")}\n\nThey can't be synced or imported back by accident (only their own new sign-up adds them again). Campaign reports keep their history.\nTip: download them first.`)) return;
        setBusy(true);
        try {
            const r = await mkCleanup({ kinds: chosen, campaign_id: campaignId, dry_run: false, expected: res.total });
            toast.success(`Removed ${r.removed} contact(s).`);
            setRes(null); onDone();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    if (!open) {
        return (
            <button type="button" className="text-sm underline text-[#002B5C]" onClick={() => setOpen(true)} data-testid="mk-cleanup-open">
                {campaignId ? "Clean up this campaign's bounced & invalid addresses…" : "Clean up the database (remove bounced & invalid)…"}
            </button>
        );
    }
    return (
        <div className="border border-[#E5E7EB] bg-white p-4 space-y-3 text-sm" data-testid="mk-cleanup">
            <div className="flex items-center">
                <b className="text-[#002B5C]">{campaignId ? "Clean up after this campaign" : "Clean up the database"}</b>
                <button type="button" className="ml-auto" aria-label="Close" onClick={() => { setOpen(false); setRes(null); }}><X size={16} /></button>
            </div>
            <div className="grid sm:grid-cols-2 gap-1">
                {Object.keys(CLEANUP_LABELS).map((k) => (
                    <label key={k} className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={!!kinds[k]} onChange={(e) => { setKinds({ ...kinds, [k]: e.target.checked }); setRes(null); }} />
                        {CLEANUP_LABELS[k]}
                    </label>
                ))}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
                <button type="button" className={`${btn} border border-[#002B5C] text-[#002B5C]`} disabled={busy || !chosen.length} onClick={count} data-testid="mk-cleanup-count">
                    {busy && !res ? "Counting…" : "1. Count them"}</button>
                {res && (
                    <>
                        <span>{res.total} contact(s){res.total ? `: ${Object.entries(res.by_kind).map(([k, n]) => `${n} ${k}`).join(", ")}` : ""}</span>
                        {res.total > 0 && !campaignId && (
                            <button type="button" className={`${btn} border`} onClick={() => mkExportContacts({ removed: "only" }, "xlsx").catch((e) => toast.error(formatApiError(e)))}>
                                2. Download all bounced &amp; invalid (Excel)</button>
                        )}
                        {res.total > 0 && campaignId && (
                            <button type="button" className={`${btn} border`} onClick={() => mkExportCampaign(campaignId, "xlsx").catch((e) => toast.error(formatApiError(e)))}>
                                2. Download the report (Excel)</button>
                        )}
                        {res.total > 0 && (canDelete(user)
                            ? <button type="button" className={`${btn} bg-[#CC0033] text-white`} disabled={busy} onClick={remove} data-testid="mk-cleanup-remove">3. Remove {res.total}</button>
                            : <span className="text-xs text-[#B4750F]">A superadmin can remove them.</span>)}
                    </>
                )}
            </div>
            <p className="text-xs text-[#6B7280]">
                These addresses are already never mailed. Removing them tidies Contacts and your lists; a fingerprint of each address is kept so
                an order sync or an old spreadsheet can't bring it back. Complaints and unsubscribes are off by default — they are people's own “no”.
            </p>
        </div>
    );
}

/* -------------------------------------------------------------- templates --- */
// "[book title]" in a starter template is a placeholder to replace; a
// markdown link "[text](https://…)" is not.
const placeholdersIn = (texts) => {
    const out = new Set();
    for (const t of texts) for (const m of String(t || "").matchAll(/\[([^\]\n]{2,40})\](?!\()/g)) out.add(`[${m[1]}]`);
    return [...out];
};

// The merge variables, from the server (marketing_core.VARIABLES) so this
// list can never offer one the renderer doesn't fill. Click copies.
let VARS_CACHE = null;
function VariablesHelp({ compact = false }) {
    const [vars, setVars] = useState(VARS_CACHE);
    useEffect(() => { if (!VARS_CACHE) mkTemplates().then((r) => { VARS_CACHE = r.variables || []; setVars(VARS_CACHE); }).catch(() => {}); }, []);
    if (!vars) return null;
    const copy = async (k) => {
        try { await navigator.clipboard.writeText(`{{${k}}}`); toast.success(`Copied {{${k}}} — paste it into the subject or text.`); }
        catch { toast.message(`{{${k}}}`); }
    };
    return (
        <div className="border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-xs space-y-2" data-testid="mk-variables">
            <div className="font-medium text-[#002B5C]">Personalise with variables {compact ? "" : "(subject, preview text, headings, text and buttons)"}</div>
            <div className="flex flex-wrap gap-1.5">
                {vars.map((v) => (
                    <button key={v.key} type="button" onClick={() => copy(v.key)} title={`${v.label} — e.g. “${v.example}”${v.default ? `; if unknown: “${v.default}”` : ""}`}
                        className="font-mono border border-[#E5E7EB] bg-white px-2 py-1 hover:border-[#002B5C]">{`{{${v.key}}}`}</button>
                ))}
            </div>
            <div className="text-[#6B7280]">
                Fallback when a contact has no value: <span className="font-mono">{"{{first_name|Reader}}"}</span>. Unknown variables block sending. The unsubscribe link is added to every email automatically.
            </div>
        </div>
    );
}

function TemplateEditor({ t, onClose, onSaved }) {
    const [f, setF] = useState({ name: t.name || "", description: t.description || "", subject: t.subject || "", preheader: t.preheader || "", blocks: t.blocks || [] });
    const [busy, setBusy] = useState(false);
    const [pv, setPv] = useState(null);
    const dF = useDebounced(f, 700);
    useEffect(() => {
        mkTemplatePreview({ subject: dF.subject, preheader: dF.preheader, blocks: dF.blocks }).then(setPv).catch(() => {});
    }, [dF]);
    const save = async () => {
        if (!f.name.trim()) return toast.error("Give the template a name.");
        setBusy(true);
        try { await mkSaveTemplate(t.id, f); toast.success("Template saved."); onSaved(); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    return (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6" data-testid="mk-template-editor">
            <div className="space-y-4">
                <button type="button" className="underline text-sm" onClick={onClose}>← All templates</button>
                <Panel title="Template">
                    <div className="space-y-2 text-sm">
                        <label className="block">Name (internal)<input className={box} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="mk-template-name" /></label>
                        <label className="block">What it's for<input className={box} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
                        <label className="block">Subject line<input className={box} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} data-testid="mk-template-subject" /></label>
                        <label className="block">Preview text<input className={box} value={f.preheader} onChange={(e) => setF({ ...f, preheader: e.target.value })} /></label>
                    </div>
                </Panel>
                <Panel title="Content" right={<span className="text-xs text-[#6B7280]">{f.blocks.length} blocks</span>}>
                    <BlockEditor blocks={f.blocks} setBlocks={(blocks) => setF({ ...f, blocks })} />
                </Panel>
                <VariablesHelp />
                <div className="flex gap-2">
                    <button type="button" className={`${btn} bg-[#002B5C] text-white`} onClick={save} disabled={busy} data-testid="mk-template-save">{busy ? "Saving…" : "Save template"}</button>
                    <button type="button" className={`${btn} border`} onClick={onClose}>Cancel</button>
                </div>
            </div>
            <div className="space-y-2 xl:sticky xl:top-4 self-start">
                <div className="text-sm text-[#4B5563]">Preview (sample recipient “Asha Verma”) — subject: <b>{pv?.subject || "—"}</b></div>
                {pv?.unknown_variables?.length > 0 && (
                    <div className="text-xs border border-[#CC0033] text-[#CC0033] p-2" data-testid="mk-template-unknown">
                        Unknown variable(s): {pv.unknown_variables.map((v) => `{{${v}}}`).join(", ")} — campaigns using them can't be sent.
                    </div>
                )}
                <iframe title="Template preview" sandbox="" srcDoc={pv?.html || ""} className="w-full h-[760px] bg-white border border-[#E5E7EB]" />
            </div>
        </div>
    );
}

function Templates({ onOpen }) {
    const { user } = useAuth();
    const [rows, setRows] = useState(null);
    const [editing, setEditing] = useState(null);
    const load = useCallback(() => { mkTemplates().then((r) => setRows(r.templates || [])).catch((e) => { toast.error(formatApiError(e)); setRows([]); }); }, []);
    useEffect(load, [load]);
    const use = async (t) => {
        const name = window.prompt("Name the new campaign (only your team sees this)", t.name);
        if (name === null) return;
        try { const c = await mkUseTemplate(t.id, name.trim() || t.name); toast.success("Draft campaign created from the template."); onOpen(c.id); } catch (e) { toast.error(formatApiError(e)); }
    };
    const copy = async (t) => {
        try { const n = await mkNewTemplate({ from_template_id: t.id }); toast.success("Copied — edit your copy."); load(); setEditing(n); } catch (e) { toast.error(formatApiError(e)); }
    };
    const blank = async () => {
        const name = window.prompt("Name the new template", "");
        if (name === null) return;
        try { const n = await mkNewTemplate({ name: name.trim() || "Untitled template", blocks: [{ type: "heading", text: "Hi {{first_name}}" }, { type: "text", text: "" }] }); load(); setEditing(n); } catch (e) { toast.error(formatApiError(e)); }
    };
    const del = async (t) => {
        if (!window.confirm(`Delete the template “${t.name}”? Campaigns already made from it keep their own copy.`)) return;
        try { await mkDeleteTemplate(t.id); toast.success("Template deleted."); load(); } catch (e) { toast.error(formatApiError(e)); }
    };
    if (editing) return <TemplateEditor t={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />;
    if (!rows) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    const mine = rows.filter((t) => !t.starter);
    const starters = rows.filter((t) => t.starter);
    const card = (t) => (
        <div key={t.id} className="bg-white border border-[#E5E7EB] p-4 flex flex-col gap-2" data-testid="mk-template">
            <div className="flex items-start gap-2">
                <div className="font-medium text-[#002B5C]">{t.name}</div>
                {t.starter && <span className="ml-auto text-[10px] font-mono uppercase border px-1.5 py-0.5 text-[#4B5563]">Built-in</span>}
            </div>
            {t.description && <div className="text-xs text-[#4B5563]">{t.description}</div>}
            <div className="text-xs text-[#6B7280] truncate">Subject: {t.subject || "—"}</div>
            {!t.starter && t.updated_by && <div className="text-[11px] text-[#9CA3AF]">Edited by {t.updated_by}</div>}
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <button type="button" className={`${btn} bg-[#002B5C] text-white`} onClick={() => use(t)} data-testid="mk-template-use">Use</button>
                {t.starter
                    ? <button type="button" className={`${btn} border`} onClick={() => copy(t)}>Duplicate to edit</button>
                    : <button type="button" className={`${btn} border`} onClick={() => setEditing(t)}>Edit</button>}
                {!t.starter && <button type="button" className={`${btn} border`} onClick={() => copy(t)}>Duplicate</button>}
                {!t.starter && canDelete(user) && <button type="button" className={`${btn} border border-[#CC0033] text-[#CC0033]`} onClick={() => del(t)}>Delete</button>}
            </div>
        </div>
    );
    return (
        <div className="space-y-6" data-testid="mk-templates">
            <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-[#4B5563] flex-1">Reusable email designs. <b>Use</b> makes a new draft campaign (a copy — editing the template later doesn't change it). Save any campaign as a template from its editor.</p>
                <button type="button" className={`${btn} bg-[#002B5C] text-white inline-flex items-center gap-2`} onClick={blank} data-testid="mk-template-new"><Plus size={14} /> New template</button>
            </div>
            <VariablesHelp />
            <Panel title={`Your templates (${mine.length})`}>
                {mine.length ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{mine.map(card)}</div>
                    : <p className="text-sm text-[#6B7280]">None yet — duplicate a built-in one below, or save a campaign as a template.</p>}
            </Panel>
            <Panel title="Built-in templates">
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{starters.map(card)}</div>
            </Panel>
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
                            <ImageDrop src={b.src} onUploaded={(url) => upd(i, { src: url })} />
                            <input className={box} value={b.src || ""} onChange={(e) => upd(i, { src: e.target.value })} placeholder="…or paste an image URL (https://…)" />
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
                    {b.type === "for_you" && (
                        <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-center">
                            <input className={box} value={b.text ?? "Picked for you"} onChange={(e) => upd(i, { text: e.target.value })} placeholder="Small heading above the books" />
                            <label className="text-xs flex items-center gap-2">Books
                                <select className="border border-[#E5E7EB] px-2 py-1" value={b.count || 3} onChange={(e) => upd(i, { count: Number(e.target.value) })}>
                                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </label>
                            <div className="sm:col-span-2 text-[11px] text-[#6B7280]">Each reader gets different books: the newest releases closest to what they bought, carted or asked to be told about — never one they already own. People with no history get the newest releases. The preview shows the newest releases.</div>
                        </div>
                    )}
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

/* Drag & drop (or click) an image into an email block. The server resizes it
   to 1200 px, re-encodes it and returns an absolute https URL — the only kind
   a mail app can load. */
function ImageDrop({ src, onUploaded }) {
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const pick = useRef(null);
    const upload = async (file) => {
        if (!file) return;
        if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.type)) return toast.error("Use a JPEG, PNG, GIF or WebP image.");
        if (file.size > 8 * 1024 * 1024) return toast.error("Image too large (max 8 MB).");
        setBusy(true);
        try { const r = await mkUploadEmailImage(file); onUploaded(r.url); toast.success(`Image added (${Math.round(r.bytes / 1024)} KB).`); }
        catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    return (
        <div
            role="button"
            tabIndex={0}
            data-testid="mk-image-drop"
            onClick={() => pick.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files?.[0]); }}
            className={`flex items-center gap-3 border-2 border-dashed p-3 cursor-pointer ${over ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#E5E7EB]"}`}
        >
            {src ? <img src={src} alt="" className="w-20 h-14 object-cover border border-[#E5E7EB] bg-white" /> : null}
            <span className="text-xs text-[#4B5563]">
                {busy ? "Uploading…" : src ? "Drop a new image here, or click to replace" : "Drag & drop an image here, or click to choose (JPEG, PNG, GIF, WebP · max 8 MB)"}
            </span>
            <input ref={pick} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
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
                    <ExportButtons onExport={(fmt) => mkExportCampaign(id, fmt)} label="Export report" testid="mk-report-export" />
                    {["sending", "scheduled"].includes(status) && <button type="button" className="border px-3 py-1 text-sm" onClick={() => act("pause")}>Pause</button>}
                    {status === "paused" && <button type="button" className="border border-[#15803D] text-[#15803D] px-3 py-1 text-sm" onClick={() => act("resume")}>Resume</button>}
                    {["preparing", "sending", "scheduled", "paused"].includes(status) && <button type="button" className="border border-[#CC0033] text-[#CC0033] px-3 py-1 text-sm" onClick={() => act("cancel")}>Cancel</button>}
                </span>
            </div>
            {r.campaign.paused_reason && <div className="border border-[#CC0033] text-[#CC0033] p-2 text-sm">{r.campaign.paused_reason}</div>}
            {["sent", "cancelled", "paused"].includes(status) && !isWa && <CleanupPanel campaignId={id} />}
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
            {r.campaign.kind === "reconfirm" && (
                <div className="border border-[#7c3aed] text-[#5b21b6] p-2 text-sm" data-testid="mk-reconfirm-report">
                    Re-confirm: <b>{(r.stats || {}).clicked || 0}</b> clicked and stay subscribed.{" "}
                    {r.campaign.lapsed_at ? <>After {r.campaign.reconfirm_days} days, <b>{r.campaign.lapsed_count}</b> who didn't click stopped getting campaigns ({when(r.campaign.lapsed_at)}).</>
                        : <>Those who don't click stop getting campaigns {r.campaign.reconfirm_days || 30} days after sending finishes.</>}
                </div>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                <Kpi label="Sent" value={(s.sent || 0).toLocaleString("en-IN")} sub={s.queued ? `${s.queued} waiting` : ""} />
                <Kpi label="Delivered" value={pct(r.rates.delivery)} />
                <Kpi label={isWa ? "Read" : "Opened"} value={pct(r.rates.open)} />
                <Kpi label="Clicked" value={pct(r.rates.click)} sub={isWa ? "" : `CTOR ${pct(r.rates.ctor)}`} />
                {/* Hard bounces in the big number; soft bounces and "no report yet"
                    underneath, so delivered + these add up to Sent. */}
                <Kpi
                    label="Bounced"
                    value={pct(r.rates.bounce, 2)}
                    warn={(r.rates.bounce || 0) > 0.02}
                    sub={isWa ? "" : [s.soft_bounced ? `${s.soft_bounced} soft` : "", s.no_report ? `${s.no_report} no report yet` : ""].filter(Boolean).join(" · ")}
                />
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
            {(r.providers || []).length > 0 && (
                <Panel title="Bounces by provider">
                    <table className="w-full text-xs" data-testid="mk-providers"><thead><tr className="text-left text-[#4B5563]"><th className="py-1">Provider</th><th className="text-right">Sent</th><th className="text-right">Delivered</th><th className="text-right">Bounced</th><th className="text-right">Bounce rate</th></tr></thead>
                        <tbody>{r.providers.map((p) => (
                            <tr key={p.provider} className="border-t"><td className="py-1 font-mono">{p.provider}</td><td className="text-right">{p.sent}</td><td className="text-right">{p.delivered}</td>
                                <td className="text-right">{p.bounced}</td><td className={`text-right ${(p.bounce_rate || 0) > 0.08 ? "text-[#CC0033] font-medium" : ""}`}>{pct(p.bounce_rate, 1)}</td></tr>
                        ))}</tbody></table>
                    <p className="text-xs text-[#6B7280] mt-2">Providers whose unconfirmed addresses bounce above 8% (20+ sends) are learned automatically and skipped next time — see Settings → Learned from bounces.</p>
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
                        <tr key={i} className="border-t"><td className="py-1 pr-3 font-mono">{p.to}</td><td className="pr-3">{p.status === "sent" && p.bounce_type ? `soft bounce (${p.bounce_type})` : `${p.status}${p.bounce_type ? ` (${p.bounce_type})` : ""}`}</td><td className="text-[#6B7280]">{p.error}</td></tr>
                    ))}</tbody></table>
                    <p className="text-xs text-[#6B7280] mt-2">Hard bounces and complaints are removed from all future sends automatically. A soft bounce (full mailbox, server busy) is retried next campaign; three in a row and the address is removed.</p>
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
    // Bounced / blocked / invalid addresses are hidden by default — kept as
    // records (that is what keeps them out of every campaign and every future
    // import), just out of the way.
    const [removed, setRemoved] = useState("hide");
    const [page, setPage] = useState(1);
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState(false);
    const sel = useSelection();
    const [allMatching, setAllMatching] = useState(false);
    const load = useCallback(() => {
        mkContacts({ q: dq || undefined, status: status || undefined, consent: consent || undefined, removed, page }).then(setD).catch(() => setD({ rows: [], total: 0 }));
    }, [dq, status, consent, removed, page]);
    useEffect(load, [load]);
    const clearSel = sel.clear;
    useEffect(() => { setPage(1); clearSel(); setAllMatching(false); }, [dq, status, consent, removed, clearSel]);
    const pageIds = (d?.rows || []).map((c) => c.id);
    const pageAllOn = pageIds.length > 0 && pageIds.every((x) => sel.sel.has(x));
    const count = allMatching ? (d?.total || 0) : sel.sel.size;
    const bulk = async (action) => {
        if (action === "erase") {
            const typed = window.prompt(`Erase ${count} contact${count === 1 ? "" : "s"} for a PRIVACY REQUEST?\nThey will be blocked from ever being imported again (only their own new sign-up brings them back).\nTo just remove them, use Delete instead.\n\nType ERASE to confirm.`);
            if (typed !== "ERASE") return;
        } else if (action === "delete") {
            if (!window.confirm(`Delete ${count} contact${count === 1 ? "" : "s"}? They can be imported again later.`)) return;
        } else if (!window.confirm(`Unsubscribe ${count} contact${count === 1 ? "" : "s"} from marketing email? Only they can opt in again.`)) return;
        try {
            const body = { action, expected: count, ...(allMatching
                ? { all_matching: { q: dq || undefined, status: status || undefined, consent: consent || undefined, removed } }
                : { ids: [...sel.sel] }) };
            const r = await mkBulkContacts(body);
            toast.success(`${{ erase: "Erased", delete: "Deleted", unsubscribe: "Unsubscribed" }[action]} ${r.done}.`);
            sel.clear(); setAllMatching(false); load();
        } catch (e) { toast.error(formatApiError(e)); }
    };
    const sync = async () => {
        setBusy(true);
        try { const r = await mkSync(); toast.success(`Synced. ${r.contacts} contacts in total.`); load(); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const unsub = async (cid, field) => { try { await mkPatchContact(cid, { [field]: "unsubscribed" }); load(); } catch (e) { toast.error(formatApiError(e)); } };
    // Delete = remove the record (can be imported again). Erase = privacy
    // request: blocked from ever being re-imported. Different on purpose.
    const removeOne = async (cid) => {
        if (!window.confirm("Delete this contact?\nThey can be imported again later. (For a privacy request, tick them and use Erase instead.)")) return;
        try { await mkDeleteContact(cid, false); toast.success("Deleted."); load(); } catch (e) { toast.error(formatApiError(e)); }
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
                <select className={selCls} value={removed} onChange={(e) => setRemoved(e.target.value)} data-testid="mk-contacts-removed"
                    title="Bounced, complained, blocked by AWS or invalid — never mailed">
                    <option value="hide">Hide bounced &amp; invalid{d?.removed_count ? ` (${d.removed_count})` : ""}</option>
                    <option value="only">Only bounced &amp; invalid</option>
                    <option value="show">Show all</option>
                </select>
                <select className={selCls} value={consent} onChange={(e) => setConsent(e.target.value)}>
                    <option value="">Any email consent</option>{["subscribed", "pending", "none", "lapsed", "unsubscribed", "complained"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <ExportButtons label="Export" testid="mk-contacts-export"
                    onExport={(fmt) => mkExportContacts({ q: dq || undefined, status: status || undefined, consent: consent || undefined, removed }, fmt)} />
                <button type="button" className={`${btn} border ml-auto`} disabled={busy} onClick={sync} title="Newsletter sign-ups, paying customers and confirmed accounts">Sync website contacts</button>
            </div>
            <CleanupPanel onDone={load} />
            {d && (
                <div className="text-xs text-[#4B5563]">{d.total.toLocaleString("en-IN")} contacts shown · {Object.entries(d.by_consent || {}).map(([k, v]) => `${k || "none"} ${v}`).join(" · ")}
                    {removed === "hide" && d.removed_count > 0 && !status && (
                        <> · <b>{d.removed_count}</b> bounced / invalid hidden — never mailed, kept so they can't be re-imported</>
                    )}
                </div>
            )}
            <BulkBar count={count} onClear={() => { sel.clear(); setAllMatching(false); }}>
                <button type="button" className={bulkBtn} onClick={() => bulk("unsubscribe")} data-testid="mk-contacts-bulk-unsub">Unsubscribe</button>
                {canDelete(user) && <button type="button" className={bulkBtn} onClick={() => bulk("delete")} data-testid="mk-contacts-bulk-delete"
                    title="Remove the records — they can be imported again later">Delete</button>}
                {canDelete(user) && <button type="button" className={bulkBtn} onClick={() => bulk("erase")} data-testid="mk-contacts-bulk-erase"
                    title="Privacy request — they can never be re-imported (only their own new sign-up brings them back)">Erase (privacy)</button>}
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
                                        {!["verified", "invalid", "suppressed"].includes(c.email_status) && <ScoreChip score={c.score} />}
                                        {c.ses_checked && <span className="ml-1 text-[10px] border border-[#E5E7EB] px-1" title="Mailbox checked by Amazon SES">SES ✓</span>}
                                        {c.email_status === "risky" && c.risk_kind && <div className="text-[#B4750F]">{RISK_LABEL[c.risk_kind] || c.risk_kind}</div>}
                                        {(c.since_engaged || 0) >= 6 && <div className="text-[#B4750F]">no opens or clicks in {c.since_engaged} emails</div>}
                                        {c.reasons?.length ? <div className="text-[#6B7280] max-w-[24ch]">{c.reasons.join("; ")}</div> : null}</td>
                                    <td className="text-xs">{c.email_consent?.status}{c.email_consent?.status === "subscribed" && <button type="button" className="block underline text-[#CC0033]" onClick={() => unsub(c.id, "email_consent")}>unsubscribe</button>}</td>
                                    <td className="text-xs">{c.wa_consent?.status}{c.wa_consent?.status === "subscribed" && <button type="button" className="block underline text-[#CC0033]" onClick={() => unsub(c.id, "wa_consent")}>opt out</button>}</td>
                                    <td className="text-xs text-[#4B5563] max-w-[20ch]">{c.source}</td>
                                    <td className="text-right text-xs">{c.stats?.sent || 0}/{c.stats?.opened || 0}/{c.stats?.clicked || 0}</td>
                                    <td className="text-right pr-2">{canDelete(user) && <button type="button" aria-label="Delete contact" onClick={() => removeOne(c.id)}><Trash2 size={14} className="text-[#CC0033]" /></button>}</td>
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
                                    <div className="text-xs text-[#4B5563]">{l.count ?? 0} contacts{l.kind === "static" ? ` · ${listReach(l)}` : ""}{l.rules?.length ? ` · ${l.rules.map((r) => r.type).join(" + ")}` : ""}</div></div>
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

/** Every imported row with its verdict, score and why — filterable, 100 at a time. */
function RowReport({ rows }) {
    const [f, setF] = useState("");
    const [n, setN] = useState(100);
    if (!rows.length) return null;
    const shown = rows.filter((r) => !f || r.status === f);
    return (
        <details className="text-xs" data-testid="mk-row-report">
            <summary className="cursor-pointer text-[#002B5C]">Every address ({rows.length}{rows.length >= 2000 ? ", first 2,000" : ""})</summary>
            <div className="mt-2 flex flex-wrap gap-2">
                {["", "verified", "valid", "risky", "unknown", "invalid", "suppressed"].map((k) => (
                    <button key={k || "all"} type="button" onClick={() => { setF(k); setN(100); }}
                        className={`border px-2 py-0.5 ${f === k ? "border-[#002B5C] text-[#002B5C]" : "border-[#E5E7EB]"}`}>
                        {k || "all"} ({k ? rows.filter((r) => r.status === k).length : rows.length})</button>
                ))}
            </div>
            <table className="w-full mt-2"><tbody>
                {shown.slice(0, n).map((r, i) => (
                    <tr key={i} className="border-t align-top">
                        <td className="py-1 pr-2 font-mono break-all">{r.email}<div className="text-[#6B7280] font-sans">{r.name}</div></td>
                        <td className="pr-2 whitespace-nowrap font-medium" style={{ color: STATUS_COLORS[r.status] }}>{r.status}
                            {!["verified", "invalid", "suppressed"].includes(r.status) && <ScoreChip score={r.score} />}</td>
                        <td className="text-[#6B7280]">{(r.why || []).join("; ")}{r.risk_kind ? ` · ${RISK_LABEL[r.risk_kind] || r.risk_kind}` : ""}</td>
                    </tr>
                ))}
            </tbody></table>
            {shown.length > n && <button type="button" className="underline mt-1" onClick={() => setN(n + 200)}>Show more ({shown.length - n} left)</button>}
        </details>
    );
}

/* ------------------------------------------------------- verify / import --- */
function VerifyImport() {
    const [paste, setPaste] = useState("");
    const [useSes, setUseSes] = useState(true);
    const [quick, setQuick] = useState(null);
    const [file, setFile] = useState(null);
    const [report, setReport] = useState(null);
    // audience replaces the old "these people agreed" tick box: "known" =
    // existing clients/customers (imported as consented, recorded with the
    // approver's name), "unknown" = permission email first (marketing.py).
    const [opts, setOpts] = useState({ list_name: "", audience: "", consent_whatsapp: false, consent_source: "", autofix: true });
    const [est, setEst] = useState(null);
    const [estBusy, setEstBusy] = useState(false);
    const [pending, setPending] = useState([]);
    const loadPending = useCallback(() => { mkImports("pending").then((r) => setPending(r.imports || [])).catch(() => {}); }, []);
    useEffect(() => { loadPending(); }, [loadPending]);
    const estimate = useCallback(async (f, autofix) => {
        if (!f) { setEst(null); return; }
        setEstBusy(true);
        try { setEst(await mkImportEstimate({ file: f, autofix })); } catch (e) { setEst({ error: formatApiError(e) }); } finally { setEstBusy(false); }
    }, []);
    const [pick, setPick] = useState({ verified: true, valid: true, risky: true });
    const [sesLive, setSesLive] = useState(true);
    const [readd, setReadd] = useState(false);
    const { user } = useAuth();
    const [busy, setBusy] = useState(false);
    const fileIn = useRef(null);
    const runQuick = async () => {
        const emails = paste.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
        if (!emails.length) return;
        if (useSes) {
            let q = null;
            try { q = await mkImportEstimate({ emails: emails.join("\n") }); } catch { /* the prompt still asks */ }
            const msg = q && q.enabled
                ? `Check ${emails.length} address(es) with Amazon SES?\n\n${q.to_check} have never been checked: up to ₹${q.est_inr} (₹${q.per_check_inr} each).\n${q.already_checked} already checked or proven: free.\nMonthly budget left: ₹${q.budget_left_inr}.`
                : `Check ${emails.length} address(es)?`;
            if (!window.confirm(msg)) return;
        }
        setBusy(true);
        try { setQuick(await mkVerify(emails, true, useSes)); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const chosenCount = (rep) => ["verified", "valid", "risky"].reduce((a, k) => a + (pick[k] ? (rep?.counts || {})[k] || 0 : 0), 0);
    const run = async (dry) => {
        if (!file) return toast.error("Choose an Excel (.xlsx) or CSV file.");
        if (!dry && !opts.audience) return toast.error("Choose who these people are.");
        if (!dry && opts.consent_whatsapp && opts.consent_source.trim().length < 3) return toast.error("Say where these people agreed to WhatsApp messages.");
        // OK/Cancel before anything is spent or sent for approval.
        if (dry) {
            const paid = sesLive && est && est.enabled && est.to_check > 0;
            if (!window.confirm(paid
                ? `Check this file?\n\nAmazon SES will check up to ${est.to_check} address(es) never checked before: up to ₹${est.est_inr}` +
                  `${est.company_domains ? ` (+ up to ₹${est.domain_tests_max_inr} for company-domain tests)` : ""}.\nMonthly budget left: ₹${est.budget_left_inr}.\n\nNothing is saved to Contacts.`
                : "Check this file? Free checks only — nothing is spent and nothing is saved to Contacts.")) return;
        } else if (!window.confirm(
            `Send ${chosenCount(report)} contact(s) for approval as “${opts.list_name.trim() || "Import (today)"}”?\n\n` +
            (opts.audience === "known"
                ? "Known clients/customers: they can receive marketing emails once approved."
                : "Not known to us: they will only get ONE permission email (a re-confirm campaign); a click opts them in.") +
            "\n\nNothing is saved until someone else with Marketing access approves it.")) return;
        setBusy(true);
        try {
            const r = await mkImport(file, { ...opts, dry_run: dry, statuses: Object.keys(pick).filter((k) => pick[k]).join(","), ses_live: sesLive, readd_erased: readd });
            setReport(r);
            if (!dry) {
                toast.success(`${r.would_save} contact(s) sent for approval. Someone else with Marketing access must approve them.`, { duration: 10000 });
                loadPending();
            }
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const decide = async (imp, approve) => {
        const who = imp.audience === "known" ? "known clients/customers (they can receive marketing emails)" : "not known to us (one permission email only)";
        if (approve) {
            if (!window.confirm(`Approve “${imp.list_name}”?\n\n${imp.would_save} contact(s), ${who}.\nUploaded by ${imp.by} from ${imp.file}.\n\nThey will be saved to Contacts now.`)) return;
        } else if (!window.confirm(`Reject “${imp.list_name}”? Nothing will be saved.`)) return;
        setBusy(true);
        try {
            if (approve) {
                const r = await mkImportApprove(imp.id);
                toast.success(`Approved: ${r.saved} saved to “${imp.list_name}”.${r.permission_pending ? ` ${r.permission_pending} will get a permission email first.` : ""}`, { duration: 10000 });
            } else {
                await mkImportReject(imp.id);
                toast.success("Rejected — nothing was saved.");
            }
            loadPending();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const c = report?.counts || {};
    return (
        <div className="grid xl:grid-cols-2 gap-6" data-testid="mk-verify">
            {pending.length > 0 && (
                <div className="xl:col-span-2 border-2 border-[#F59E0B] bg-white p-4 space-y-3" data-testid="mk-pending-imports">
                    <div className="font-serif text-lg text-[#002B5C]">Imports waiting for approval ({pending.length})</div>
                    {pending.map((imp) => (
                        <div key={imp.id} className="border border-[#E5E7EB] p-3 text-sm space-y-1" data-testid="mk-pending-import">
                            <div className="font-medium text-[#002B5C]">“{imp.list_name}” — {imp.would_save} contact(s)</div>
                            <div className="text-xs text-[#4B5563]">
                                {imp.audience === "known" ? "Known clients/customers → can receive marketing emails" : "Not known to us → one permission email only"}
                                {" · "}uploaded by {imp.by} · {imp.file} · {new Date(imp.at).toLocaleString()}
                                {imp.ses_after > 0 ? ` · ${imp.ses_after} still get an AWS mailbox check after approval` : ""}
                            </div>
                            {(imp.sample || []).length > 0 && (
                                <details className="text-xs"><summary className="cursor-pointer">First {imp.sample.length} contacts</summary>
                                    <ul className="mt-1 font-mono">{imp.sample.map((r, i) => <li key={i}>{r.email}{r.name ? ` — ${r.name}` : ""} <span style={{ color: STATUS_COLORS[r.status] }}>({r.status})</span></li>)}</ul>
                                </details>
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                                <button type="button" className={`${btn} bg-[#15803D] text-white`} disabled={busy || !imp.can_approve}
                                    onClick={() => decide(imp, true)} data-testid="mk-import-approve">Approve</button>
                                <button type="button" className={`${btn} border border-[#CC0033] text-[#CC0033]`} disabled={busy}
                                    onClick={() => decide(imp, false)} data-testid="mk-import-reject">Reject</button>
                                {!imp.can_approve && <span className="text-xs text-[#B4750F] self-center">{imp.approval_refusal}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <Panel title="Check addresses (paste up to 200)">
                <textarea rows={6} className={box} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"one per line, or separated by commas\nrohan@gmial.com\ninfo@school.edu.in"} />
                <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={useSes} onChange={(e) => setUseSes(e.target.checked)} />
                    Also ask Amazon SES whether each mailbox exists (≈ $0.01 each, never twice for the same address)</label>
                <button type="button" className={`${btn} bg-[#002B5C] text-white mt-2`} onClick={runQuick} disabled={busy}>{busy ? "Checking…" : "Check"}</button>
                {quick && (
                    <table className="w-full text-xs mt-3" data-testid="mk-quick-results"><tbody>
                        {quick.results.map((r, i) => (
                            <tr key={i} className="border-t"><td className="py-1 font-mono pr-2">{r.email || r.input}</td>
                                <td className="pr-2 font-medium whitespace-nowrap" style={{ color: STATUS_COLORS[r.status] }}>{r.status}{!["verified", "invalid", "suppressed"].includes(r.status) && <ScoreChip score={r.score} />}</td>
                                <td className="text-[#6B7280]">{r.reasons.join("; ")}</td></tr>
                        ))}
                    </tbody></table>
                )}
            </Panel>
            <Panel title="Import a list (Excel or CSV)">
                <div className="space-y-3 text-sm">
                    <input ref={fileIn} type="file" accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setReport(null); estimate(f, opts.autofix); }} />
                    <p className="text-xs text-[#6B7280]">Needs an “email” column; “name” and “phone” are picked up if present. Up to 50,000 rows.</p>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={opts.autofix} onChange={(e) => { setOpts({ ...opts, autofix: e.target.checked }); estimate(file, e.target.checked); }} /> Fix obvious typos (gmial.com → gmail.com)</label>
                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={sesLive} onChange={(e) => setSesLive(e.target.checked)} data-testid="mk-import-ses-live" />
                        <span>Also ask Amazon SES whether each mailbox exists (≈ $0.01 per new address, never twice for the same one — within the monthly budget)</span></label>
                    {canDelete(user) && (
                        <label className="flex items-start gap-2 text-[#B4750F]"><input type="checkbox" className="mt-1" checked={readd} onChange={(e) => { setReadd(e.target.checked); setReport(null); }} data-testid="mk-import-readd" />
                            <span>Re-add people who were <b>erased</b> earlier — only if they asked to be added back (logged)</span></label>
                    )}
                    {file && (
                        <div className="text-xs border border-[#E5E7EB] bg-[#F5F7FA] p-2" data-testid="mk-import-cost">
                            {estBusy ? "Working out the cost…" : !est ? null : est.error ? <span className="text-[#CC0033]">{est.error}</span> : (
                                <>
                                    <div className="font-medium text-[#002B5C]">
                                        Cost of checking this file: {sesLive && est.enabled ? <>up to <b>₹{est.est_inr}</b></> : <b>₹0 (free checks only)</b>}
                                    </div>
                                    <div className="text-[#4B5563] mt-0.5">
                                        {est.addresses} address{est.addresses === 1 ? "" : "es"} · {est.already_checked} already checked or proven (free) · {est.to_check} new
                                        {est.enabled ? ` × ₹${est.per_check_inr}` : ""}
                                        {sesLive && est.enabled && est.company_domains > 0 ? ` · + up to ₹${est.domain_tests_max_inr} for ${est.company_domains} company-domain test(s)` : ""}
                                        {est.enabled ? ` · monthly budget left ₹${est.budget_left_inr} of ₹${est.budget_inr}` : " · AWS checks are switched off in Settings"}
                                    </div>
                                    {!sesLive && est.enabled && est.to_check > 0 && (
                                        <div className="text-[#4B5563]">After approval, these {est.to_check} are checked with AWS in the background (≈ ₹{est.est_inr}, within the monthly budget).</div>
                                    )}
                                    {sesLive && est.over_budget && (
                                        <div className="text-[#B4750F]">More than this month's budget allows — the rest are checked next month or when a campaign is sent.</div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    <button type="button" className={`${btn} border border-[#002B5C] text-[#002B5C]`} onClick={() => run(true)} disabled={busy || !file} data-testid="mk-dry-run">{busy ? "Checking…" : "1. Check the file (nothing is saved)"}</button>
                    {report && (
                        <div className="space-y-3" data-testid="mk-import-report">
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                                {[["total", "Rows"], ["verified", "Verified"], ["valid", "Valid"], ["risky", "Risky"], ["invalid", "Invalid"], ["suppressed", "Blocked before"]].map(([k, l]) => {
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
                                    {report.dry_run ? (sesLive ? "Not checked yet (monthly budget used up, or AWS didn't answer) — after import, " : "Not checked yet — after import, ") : "Now running in the background: "}
                                    <b>{report.ses.to_check}</b> address{report.ses.to_check === 1 ? "" : "es"} get an Amazon SES mailbox check (≈ ₹{report.ses.est_inr}).
                                    Ones SES says don't exist become invalid; any still unchecked are checked automatically when a campaign is sent.
                                    <SesUsage u={report.ses} />
                                </div>
                            )}
                            {report.erased > 0 && report.dry_run && (
                                <div className="text-xs border border-[#B4750F] text-[#92400e] p-2" data-testid="mk-import-erased">
                                    {report.erased} address{report.erased === 1 ? " was" : "es were"} <b>erased</b> earlier (Contacts → Erase) and won't be imported — counted under “Blocked before”.
                                    {canDelete(user) ? " If they asked to be added back, tick “Re-add people who were erased” above and check again." : " A superadmin can re-add them if they asked to be."}
                                </div>
                            )}
                            {!report.dry_run && (
                                <div className="text-xs border border-[#15803D] text-[#15803D] p-2" data-testid="mk-import-sent">
                                    {report.would_save} contact(s) are waiting for approval (see the top of this page). Nothing is in Contacts yet.
                                </div>
                            )}
                            {!report.dry_run && Object.keys(report.skipped || {}).length > 0 && (
                                <div className="text-xs bg-[#F5F7FA] p-2" data-testid="mk-import-skipped">Will not be imported: {Object.entries(report.skipped).map(([k, n]) => `${n} ${k}`).join(" · ")}</div>
                            )}
                            <RowReport rows={report.rows || []} />
                            <div className="text-xs text-[#4B5563]">{c.duplicates_in_file || 0} duplicates removed · {c.fixed || 0} typos fixed · columns: email “{report.columns.email}”{report.columns.name ? `, name “${report.columns.name}”` : ""}{report.columns.phone ? `, phone “${report.columns.phone}”` : ""}</div>
                            {Object.entries(report.sample || {}).filter(([k]) => ["invalid", "risky", "suppressed"].includes(k)).map(([k, rows]) => (
                                <details key={k} className="text-xs"><summary className="cursor-pointer" style={{ color: STATUS_COLORS[k] }}>{k}: examples</summary>
                                    <ul className="mt-1 space-y-0.5">{rows.map((r, i) => <li key={i} className="font-mono">{r.input} <span className="text-[#6B7280] font-sans">— {r.reasons.join("; ")}</span></li>)}</ul>
                                </details>
                            ))}
                            {report.dry_run && (
                                <div className="border-t pt-3 space-y-2">
                                    <input className={box} placeholder="List name, e.g. Law Summit 2026 attendees" value={opts.list_name} onChange={(e) => setOpts({ ...opts, list_name: e.target.value })} />
                                    <fieldset className="space-y-1" data-testid="mk-import-audience">
                                        <legend className="font-medium text-[#002B5C]">Who are these people?</legend>
                                        <label className="flex items-start gap-2"><input type="radio" name="mk-aud" className="mt-1" checked={opts.audience === "known"} onChange={() => setOpts({ ...opts, audience: "known" })} />
                                            <span><b>Known clients / customers</b> of Oakbridge or its founders — can receive marketing emails once approved (recorded with the approver's name).</span></label>
                                        <label className="flex items-start gap-2"><input type="radio" name="mk-aud" className="mt-1" checked={opts.audience === "unknown"} onChange={() => setOpts({ ...opts, audience: "unknown" })} />
                                            <span><b>Not known to us</b> — they get ONE permission email (a re-confirm campaign); a click opts them in, no click means never mailed again.</span></label>
                                    </fieldset>
                                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={opts.consent_whatsapp} onChange={(e) => setOpts({ ...opts, consent_whatsapp: e.target.checked })} />They also agreed to marketing <b>WhatsApp</b> messages</label>
                                    {opts.consent_whatsapp && (
                                        <input className={box} placeholder="Where did they agree to WhatsApp? e.g. 'Summit registration form, opt-in box'" value={opts.consent_source} onChange={(e) => setOpts({ ...opts, consent_source: e.target.value })} />
                                    )}
                                    <p className="text-xs text-[#6B7280]">Invalid and previously bounced/unsubscribed addresses are never imported. Every email has a one-click unsubscribe.</p>
                                    <button type="button" className={`${btn} bg-[#002B5C] text-white`} onClick={() => run(false)} data-testid="mk-import"
                                        disabled={busy || !Object.values(pick).some(Boolean) || !opts.audience}>2. Send {chosenCount(report)} contacts for approval</button>
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

/** Settings -> System health: is the site fast, and is background work keeping up? */
function SystemHealth() {
    const [h, setH] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => {
        setBusy(true);
        mkSystemHealth().then(setH).catch((e) => setH({ error: formatApiError(e) })).finally(() => setBusy(false));
    }, []);
    useEffect(load, [load]);
    if (!h) return <p className="text-sm">Checking…</p>;
    if (h.error) return <p className="text-sm text-[#CC0033]">{h.error}</p>;
    const q = h.queue || {};
    const w = q.worker || {};
    const ok = (b) => <b className={b ? "text-[#15803D]" : "text-[#CC0033]"}>{b ? "OK" : "needs a look"}</b>;
    const row = (r) => (
        <tr key={r.route} className="border-t"><td className="py-1 pr-2 font-mono break-all">{r.route}</td>
            <td className="text-right">{r.p50} ms</td><td className={`text-right ${r.p95 > 800 ? "text-[#CC0033]" : ""}`}>{r.p95} ms</td>
            <td className="text-right">{r.n}</td><td className="text-right">{r.errors_5xx || ""}</td></tr>
    );
    return (
        <div className="text-sm space-y-3" data-testid="mk-system-health">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>Background work: <b>{q.mode === "external" ? "separate worker" : "inside the website (inline)"}</b></span>
                {/* Shown whenever a worker has checked in — also in inline mode, so
                    you can see it come alive before switching WORKER_MODE. */}
                {(q.mode === "external" || w.seconds_ago != null) && (
                    <span>Worker: {q.worker_alive ? <b className="text-[#15803D]">running</b> : <b className="text-[#CC0033]">not running</b>}{" "}
                        {w.seconds_ago != null && <span className="text-xs text-[#6B7280]">(last heartbeat {w.seconds_ago}s ago)</span>}</span>
                )}
                <span>Queue lag: {ok(h.checks?.queue_lag_ok)} <span className="text-xs text-[#6B7280]">{q.lag_seconds != null ? `${q.lag_seconds}s` : "nothing waiting"}</span></span>
                <button type="button" className="underline ml-auto" disabled={busy} onClick={load}>{busy ? "Refreshing…" : "Refresh"}</button>
            </div>
            <div className="text-xs text-[#4B5563]">Jobs: {Object.entries(q.counts || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}
                {" "}· Website memory: {h.memory_mb ?? "?"} MB · up {h.uptime_min} min</div>
            <div className="text-xs text-[#4B5563]">Public cache: {h.cache?.entries ?? 0} pages, {Math.round((h.cache?.bytes || 0) / 1024)} KB,
                hit rate {h.cache?.hit_rate != null ? `${Math.round(h.cache.hit_rate * 100)}%` : "—"} ({h.cache?.hits ?? 0} hits / {h.cache?.misses ?? 0} misses)</div>
            {(q.recent_dead || []).length > 0 && (
                <div className="text-xs border border-[#CC0033] p-2">Stopped after 3 failures: {q.recent_dead.map((d) => `${d.kind} (${d.error})`).join(" · ")}</div>
            )}
            <details>
                <summary className="cursor-pointer text-[#002B5C]">Slowest endpoints (since the last restart)</summary>
                <table className="w-full text-xs mt-2"><thead><tr className="text-left text-[#6B7280]"><th>Endpoint</th><th className="text-right">typical</th>
                    <th className="text-right">slowest 5%</th><th className="text-right">requests</th><th className="text-right">5xx</th></tr></thead>
                    <tbody>{(h.slowest || []).map(row)}</tbody></table>
            </details>
            <details>
                <summary className="cursor-pointer text-[#002B5C]">Storefront book endpoints</summary>
                <table className="w-full text-xs mt-2"><tbody>{(h.storefront || []).map(row)}</tbody></table>
            </details>
        </div>
    );
}

/* ----------------------------------------------------------- newsletter --- */
const NL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NL_TONE = { drafted: "border-[#7c3aed] text-[#7c3aed]", approved: "border-[#38bdf8] text-[#0369a1]", sent: "border-[#15803D] text-[#15803D]",
    skipped: "border-[#9CA3AF] text-[#6B7280]", missed: "border-[#CC0033] text-[#CC0033]", cancelled: "border-[#9CA3AF] text-[#9CA3AF]" };
const istTime = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** Marketing -> Newsletter: the automatic schedule, its settings, and every issue. */
function Newsletter({ onOpen }) {
    const { user } = useAuth();
    const su = isSuperadmin(user?.role);
    const [d, setD] = useState(null);
    const [cfg, setCfg] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => { nlOverview().then((r) => { setD(r); setCfg(r.config); }).catch((e) => toast.error(formatApiError(e))); }, []);
    useEffect(load, [load]);
    if (!d || !cfg) return <p className="text-sm">Loading…</p>;
    const set = (p) => setCfg({ ...cfg, ...p });
    const save = async () => {
        if (cfg.enabled && cfg.mode === "autopilot" && !window.confirm("Autopilot sends each issue to every subscriber without anyone approving it. Turn it on?")) return;
        setBusy(true);
        try { const r = await nlSave(cfg); setD(r); setCfg(r.config); toast.success("Saved."); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const act = async (fn, msg) => { setBusy(true); try { await fn(); toast.success(msg); load(); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); } };
    const inp = "border border-[#E5E7EB] px-2 py-1.5 text-sm";
    const sec = cfg.sections || {};
    const ann = cfg.announcement || {};
    return (
        <div className="space-y-6" data-testid="mk-newsletter">
            <div className={`border p-3 text-sm ${d.config.enabled ? "border-[#15803D] bg-white" : "border-[#E5E7EB] bg-[#F5F7FA]"}`}>
                {d.config.enabled ? (
                    <>Newsletter is <b className="text-[#15803D]">on</b> · {d.describe} · next issue <b>{istTime(d.next_slot)}</b>,
                        draft built {istTime(d.draft_at)} · {d.config.mode === "approve" ? "needs approval" : <b className="text-[#B4750F]">autopilot</b>}
                        · ≈ {d.audience_now} subscribers</>
                ) : <>Newsletter is <b>off</b>. Choose a schedule below and switch it on.</>}
            </div>
            <div className="grid xl:grid-cols-2 gap-6">
                <Panel title="Schedule">
                    <div className="space-y-3 text-sm">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.enabled} disabled={!su} onChange={(e) => set({ enabled: e.target.checked })} data-testid="nl-enabled" /> Send the newsletter automatically</label>
                        <div className="flex flex-wrap gap-2 items-center">
                            <select className={inp} value={cfg.frequency} disabled={!su} onChange={(e) => set({ frequency: e.target.value })} data-testid="nl-frequency">
                                <option value="weekly">Every week</option><option value="fortnightly">Every two weeks</option><option value="monthly">Every month</option>
                            </select>
                            {cfg.frequency === "monthly" && (
                                <select className={inp} value={cfg.week_of_month} disabled={!su} onChange={(e) => set({ week_of_month: Number(e.target.value) })}>
                                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{["1st", "2nd", "3rd", "4th"][n - 1]}</option>)}
                                </select>
                            )}
                            <select className={inp} value={cfg.weekday} disabled={!su} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                                {NL_DAYS.map((x, i) => <option key={x} value={i}>{x}</option>)}
                            </select>
                            at <input type="time" className={inp} value={cfg.time} disabled={!su} onChange={(e) => set({ time: e.target.value })} /> IST
                        </div>
                        <label className="block">Build the draft <input type="number" min="1" max="7" className={`${inp} w-16 mx-1`} value={cfg.lead_days} disabled={!su}
                            onChange={(e) => set({ lead_days: Number(e.target.value) })} /> days before sending</label>
                        <div className="space-y-1">
                            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={cfg.mode === "approve"} disabled={!su} onChange={() => set({ mode: "approve" })} />
                                <span><b>Approve each issue</b> — you get a dashboard alert; it is sent only after someone approves it. Unapproved issues are never sent late.</span></label>
                            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={cfg.mode === "autopilot"} disabled={!su} onChange={() => set({ mode: "autopilot" })} />
                                <span><b>Autopilot</b> — sent on schedule without approval.</span></label>
                        </div>
                        <label className="block">Send to
                            <select className={`${inp} ml-2`} value={cfg.audience} disabled={!su} onChange={(e) => set({ audience: e.target.value })}>
                                <option value="all_subscribed">Everyone who opted in to marketing emails</option>
                                <option value="newsletter_only">Only newsletter sign-ups</option>
                            </select></label>
                        <p className="text-xs text-[#6B7280]">Only people who agreed to marketing emails ever receive it; waitlist sign-ups don't count as newsletter consent. Every issue has one-click unsubscribe.</p>
                    </div>
                </Panel>
                <Panel title="What goes in each issue">
                    <div className="space-y-3 text-sm">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!sec.new_releases} disabled={!su} onChange={(e) => set({ sections: { ...sec, new_releases: e.target.checked } })} /> New releases since the last issue</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!sec.bestsellers} disabled={!su} onChange={(e) => set({ sections: { ...sec, bestsellers: e.target.checked } })} /> Readers' favourites (your home-page bestsellers)</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!sec.announcement} disabled={!su} onChange={(e) => set({ sections: { ...sec, announcement: e.target.checked } })} /> Announcement (event, offer, news)</label>
                        {sec.announcement && (
                            <div className="space-y-2 pl-6">
                                <input className={`${inp} w-full`} placeholder="Title, e.g. Law Summit 2026" value={ann.title} disabled={!su} onChange={(e) => set({ announcement: { ...ann, title: e.target.value } })} />
                                <textarea rows={3} className={`${inp} w-full`} placeholder="Text" value={ann.text} disabled={!su} onChange={(e) => set({ announcement: { ...ann, text: e.target.value } })} />
                                <div className="grid grid-cols-2 gap-2">
                                    <input className={inp} placeholder="Button label" value={ann.button_label} disabled={!su} onChange={(e) => set({ announcement: { ...ann, button_label: e.target.value } })} />
                                    <input className={inp} placeholder="https://www.oakbridge.in/…" value={ann.button_url} disabled={!su} onChange={(e) => set({ announcement: { ...ann, button_url: e.target.value } })} />
                                </div>
                            </div>
                        )}
                        <div className="flex flex-wrap gap-3">
                            <label>Books per section <input type="number" min="1" max="8" className={`${inp} w-16 ml-1`} value={cfg.max_books} disabled={!su} onChange={(e) => set({ max_books: Number(e.target.value) })} /></label>
                            <label>Skip the issue if fewer than <input type="number" min="1" max="10" className={`${inp} w-16 mx-1`} value={cfg.min_items} disabled={!su} onChange={(e) => set({ min_items: Number(e.target.value) })} /> books</label>
                        </div>
                        <label className="block">Subject <span className="text-xs text-[#6B7280]">— {"{month}"} becomes e.g. "November 2026"</span>
                            <input className={`${inp} w-full`} value={cfg.subject} disabled={!su} onChange={(e) => set({ subject: e.target.value })} /></label>
                        <label className="block">Preview text<input className={`${inp} w-full`} value={cfg.preheader} disabled={!su} onChange={(e) => set({ preheader: e.target.value })} /></label>
                        <label className="block">Opening line <span className="text-xs text-[#6B7280]">— {"{{first_name}}"}, {"{period}"}</span>
                            <input className={`${inp} w-full`} value={cfg.intro} disabled={!su} onChange={(e) => set({ intro: e.target.value })} /></label>
                        <p className="text-xs text-[#6B7280]">An issue with no new releases and no announcement is skipped automatically — subscribers never get the same list twice.</p>
                    </div>
                </Panel>
            </div>
            <div className="flex flex-wrap gap-2">
                {su ? <button type="button" className={`${btn} bg-[#002B5C] text-white`} disabled={busy} onClick={save} data-testid="nl-save">Save schedule</button>
                    : <span className="text-xs text-[#6B7280]">Only a superadmin can change the schedule.</span>}
                <button type="button" className={`${btn} border`} disabled={busy} onClick={() => act(nlDraftNow, "Next issue built — see below.")}>Build the next issue now</button>
            </div>
            <Panel title="Issues">
                <table className="w-full text-sm" data-testid="nl-issues"><thead><tr className="text-left text-[#4B5563]"><th className="py-2">Send time (IST)</th><th>Status</th><th>Contents</th><th className="text-right">Sent / open / click</th><th></th></tr></thead>
                    <tbody>{(d.issues || []).map((i) => {
                        const st = i.campaign?.stats || {};
                        const base = st.delivered || st.sent || 0;
                        return (
                            <tr key={i.id} className="border-t align-top">
                                <td className="py-2">{istTime(i.slot)}</td>
                                <td><span className={`text-[10px] font-mono uppercase border px-1.5 py-0.5 ${NL_TONE[i.status] || ""}`}>{i.status}</span>
                                    {i.reason && <div className="text-xs text-[#6B7280] max-w-[28ch]">{i.reason}</div>}</td>
                                <td className="text-xs">{i.counts ? `${i.counts.new_releases} new · ${i.counts.bestsellers} favourites${i.counts.announcement ? " · announcement" : ""}` : ""}</td>
                                <td className="text-right text-xs">{st.sent ? `${st.sent} / ${pct(base ? (st.opened || 0) / base : null)} / ${pct(base ? (st.clicked || 0) / base : null)}` : "—"}</td>
                                <td className="text-right whitespace-nowrap">
                                    {i.campaign_id && <button type="button" className="underline text-xs mr-2" onClick={() => onOpen(i.campaign_id)}>{i.status === "drafted" ? "Review / edit" : "Open"}</button>}
                                    {i.status === "drafted" && <>
                                        <button type="button" className="text-xs border border-[#15803D] text-[#15803D] px-2 py-0.5 mr-1" disabled={busy}
                                            onClick={() => window.confirm(`Send this issue at ${istTime(i.slot)} to everyone eligible?`) && act(() => nlApprove(i.id), "Approved — it will go out on schedule.")}
                                            data-testid="nl-approve">Approve</button>
                                        <button type="button" className="text-xs border px-2 py-0.5" disabled={busy}
                                            onClick={() => window.confirm("Skip this issue? It will not be sent.") && act(() => nlSkip(i.id), "Skipped.")}>Skip</button>
                                    </>}
                                </td>
                            </tr>
                        );
                    })}
                        {!(d.issues || []).length && <tr><td colSpan={5} className="py-4 text-[#6B7280]">No issues yet — the first draft is built {d.config.lead_days} days before the next send time, or press “Build the next issue now”.</td></tr>}
                    </tbody></table>
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
                risk_policy: Object.fromEntries(Object.entries(s.risk_policy || {}).map(([k, v]) => [k, k !== "role" && v === "send" ? "tail" : v])), tail_max_bounce: Number(s.tail_max_bounce),
                score_valid: Math.round(Number(s.score_valid) || 65), score_invalid: Math.round(Number(s.score_invalid) || 35), auto_learn: !!s.auto_learn,
                inactive_after: Math.max(0, Math.round(Number(s.inactive_after) || 0)), sunset_after: Math.max(0, Math.round(Number(s.sunset_after) || 0)),
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
                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!!s.include_role_addresses} disabled={!su} onChange={(e) => setS({ ...s, include_role_addresses: e.target.checked })} data-testid="mk-role-valid" />
                        <span>Treat role addresses (info@, contact@, admin@…) as <b>valid</b> <span className="text-xs text-[#6B7280]">— right when schools, colleges and firms buy from you. Contacts are re-rated as soon as you save.</span></span></label>
                    {F("max_bounce", "Auto-pause when bounces exceed (0.02 = 2%; max 0.04 — AWS reviews your account at 5%)", { type: "number", step: "0.005", max: "0.04" })}
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
                                {/* Unconfirmed / catch-all can't be mixed into the main send any
                                    more (backend core.TAIL_ONLY_KINDS) — at most "Send last". */}
                                <select className="border border-[#E5E7EB] px-2 py-1" disabled={!su}
                                    value={kk !== "role" && (s.risk_policy || {})[kk] === "send" ? "tail" : (s.risk_policy || {})[kk] || "skip"}
                                    onChange={(e) => setS({ ...s, risk_policy: { ...(s.risk_policy || {}), [kk]: e.target.value } })} data-testid={`mk-risk-${kk}`}>
                                    {kk === "role" && <option value="send">Send</option>}
                                    <option value="tail">Send last (small batches, stops itself if it bounces)</option><option value="skip">Skip</option>
                                </select>
                            </label>
                        ))}
                        {F("tail_max_bounce", "“Send last” stops itself above this bounce rate (0.03 = 3%; max 0.04)", { type: "number", step: "0.005", max: "0.04" })}
                        <div className="text-sm font-medium text-[#002B5C] pt-1">Confidence score (0–100)</div>
                        <div className="grid grid-cols-2 gap-2">
                            {F("score_valid", "Valid from", { type: "number", min: "50", max: "90" })}
                            {F("score_invalid", "Invalid below", { type: "number", min: "10", max: "60" })}
                        </div>
                        <div className="text-sm font-medium text-[#002B5C] pt-1">Inactive addresses (counted in campaign emails since the last open or click)</div>
                        <div className="grid grid-cols-2 gap-2">
                            {F("inactive_after", "Mark inactive after (lowers the score)", { type: "number", min: "0", max: "100" })}
                            {F("sunset_after", "Stop mailing after (0 = never)", { type: "number", min: "0", max: "100" })}
                        </div>
                        <p className="text-xs text-[#6B7280]">Abandoned inboxes are where providers set spam traps. A re-confirm campaign is the way back for stopped addresses.</p>
                        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={s.auto_learn !== false} disabled={!su}
                            onChange={(e) => setS({ ...s, auto_learn: e.target.checked })} data-testid="mk-auto-learn" />
                            <span>Learn from real bounces <span className="text-xs text-[#6B7280]">— daily, it adjusts how much each signal counts (±20 at most) and moves “Valid from” one step at a time (55–85). See the Dashboard for what it changed.</span></span></label>
                    </div>
                    {F("wa_rate_marketing", "WhatsApp marketing cost per message, ₹ (for estimates)", { type: "number", step: "0.01" })}
                    {F("wa_rate_utility", "WhatsApp utility cost per message, ₹", { type: "number", step: "0.01" })}
                    <label className="block">Extra throwaway domains to block (one per line)
                        <textarea rows={3} className={box} value={s.extra_disposable_text} disabled={!su} onChange={(e) => setS({ ...s, extra_disposable_text: e.target.value })} /></label>
                </div>
            </Panel>
            <Panel title="System health">
                <SystemHealth />
            </Panel>
            <LearnedProviders />
            <Panel title="Amazon SES">
                {!h ? <p className="text-sm">Checking…</p> : h.ok ? (
                    <ul className="text-sm space-y-1" data-testid="mk-ses-health">
                        <li>Region: <b>{h.region}</b></li>
                        <li>Sending enabled: <b className={h.sending_enabled ? "text-[#15803D]" : "text-[#CC0033]"}>{String(h.sending_enabled)}</b></li>
                        <li>Production access: <b className={h.production ? "text-[#15803D]" : "text-[#B4750F]"}>{h.production ? "yes" : "no — sandbox: only verified recipients"}</b></li>
                        <li>Quota: {h.sent_24h ?? 0} of {h.max_24h ?? "?"} in 24h · up to {h.max_rate ?? "?"}/second</li>
                        <li>Sender identity: {h.identity ? <><b>{h.identity.name}</b> — {h.identity.verified ? "verified" : "NOT verified"}, DKIM {h.identity.dkim || "?"}</> : <span className="text-[#CC0033]">not found in this region</span>}</li>
                        <li>Last 30 days (our campaigns): bounce {pct(h.last30?.bounce_rate, 2)} · complaints {pct(h.last30?.complaint_rate, 2)}</li>
                        <li data-testid="mk-aws-reputation">
                            AWS account reputation:{" "}
                            {h.enforcement && <b className={h.enforcement === "HEALTHY" ? "text-[#15803D]" : "text-[#CC0033]"}>{h.enforcement === "HEALTHY" ? "healthy" : h.enforcement}</b>}
                            {h.aws_reputation?.error ? (
                                <span className="text-xs text-[#6B7280]"> · bounce/complaint rates need the cloudwatch:GetMetricStatistics permission on the SES IAM user</span>
                            ) : h.aws_reputation && (
                                <>
                                    {" "}· bounce <b className={(h.aws_reputation.bounce_rate || 0) >= 0.05 ? "text-[#CC0033]" : (h.aws_reputation.bounce_rate || 0) >= 0.02 ? "text-[#B4750F]" : "text-[#15803D]"}>{pct(h.aws_reputation.bounce_rate, 2)}</b>
                                    {" "}· complaints <b className={(h.aws_reputation.complaint_rate || 0) >= 0.001 ? "text-[#CC0033]" : "text-[#15803D]"}>{pct(h.aws_reputation.complaint_rate, 3)}</b>
                                    <span className="block text-xs text-[#6B7280]">AWS reviews the account at 5% bounces / 0.1% complaints and may pause it at 10% / 0.5%.</span>
                                </>
                            )}
                        </li>
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
                    <div className="text-xs">Throwaway-domain list: {s.disposable?.count ? `${s.disposable.count.toLocaleString("en-IN")} domains, updated ${when(s.disposable.at)}` : "not downloaded yet"} (weekly){" "}
                        <button type="button" className="underline" onClick={async () => {
                            try { const r = await mkDisposableRefresh(); if (r.ok) toast.success(`Updated: ${r.count} domains.`); else toast.error("Could not update — see Dashboard alerts."); load(); } catch (e) { toast.error(formatApiError(e)); }
                        }}>Update now</button></div>
                </div>
            </Panel>
            <Panel title="Order-email delivery proof (Resend)">
                <div className="text-sm space-y-2" data-testid="mk-resend">
                    <p>When Resend delivers an order or account email, that address is marked <b>verified</b> for free — no SES check needed. Bounces and spam complaints there stop marketing too.</p>
                    <div>Status: {s.resend?.configured ? <b className="text-[#15803D]">connected</b> : <b className="text-[#B4750F]">not set up — add RESEND_WEBHOOK_SECRET on Render</b>}
                        {s.resend?.last_event && <> · last event {s.resend.last_event.type.replace("resend:", "")} at {when(s.resend.last_event.at)}</>}
                        {" "}· {s.resend?.proven ?? 0} addresses proven this way</div>
                    <div className="text-xs">Resend → Webhooks → Add endpoint: <code className="bg-[#F5F7FA] px-1 break-all">{s.resend?.url}</code> · events: email.delivered, email.bounced, email.complained, email.suppressed</div>
                </div>
            </Panel>
            {su ? <button type="button" className={`${btn} bg-[#002B5C] text-white w-max`} onClick={save}>Save settings</button>
                : <p className="text-xs text-[#6B7280]">Only a superadmin can change these.</p>}
        </div>
    );
}
