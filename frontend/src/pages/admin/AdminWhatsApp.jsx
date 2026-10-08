import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Search, X } from "lucide-react";
import {
    adminWaStatus, adminWaConfig, adminWaTest, adminWaMessages, adminWaStats, adminWaReplies,
    adminWaReplyRead, adminWaEvents, formatApiError,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin } from "../../lib/rbac";

/**
 * Admin → WhatsApp: the Interakt connection (backend/interakt.py).
 *
 *   Replies    customers' WhatsApp messages, each linked to their latest order
 *   Messages   every template we sent, with sent / delivered / read / failed
 *   Stats      totals by message and by day (test sends excluded)
 *   Settings   Off / Test / Live, test number, template names, webhook URL
 *
 * ?order=OAK-123 opens Replies + Messages filtered to that order (linked from
 * Admin → Orders).
 */
const TABS = [["replies", "Replies"], ["messages", "Messages"], ["stats", "Delivery stats"], ["settings", "Settings"]];
const KIND_LABEL = {
    order_confirmed: "Order confirmed", order_shipped: "Order shipped",
    order_cancelled: "Order cancelled", cart_reminder: "Cart reminder",
};
const STATUS_TONE = {
    queued: "text-[#4B5563]", accepted: "text-[#4B5563]", sent: "text-[#002B5C]",
    delivered: "text-[#15803D]", read: "text-[#15803D] font-medium", failed: "text-[#CC0033] font-medium",
};
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN") : "—");

function SearchInput({ value, onChange, placeholder }) {
    return (
        <div className="relative w-full sm:w-80">
            <Search size={15} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]" />
            <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
                className="w-full border border-[#E5E7EB] bg-white pl-9 pr-8 py-2 text-sm focus:border-[#002B5C] outline-none" />
            {value && (
                <button type="button" aria-label="Clear search" onClick={() => onChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#4B5563] hover:text-[#CC0033]"><X size={15} strokeWidth={1.5} /></button>
            )}
        </div>
    );
}

function useDebounced(v, ms = 300) {
    const [d, setD] = useState(v);
    useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
    return d;
}

export default function AdminWhatsApp() {
    const { user } = useAuth();
    const [params, setParams] = useSearchParams();
    const order = params.get("order") || "";
    const [tab, setTab] = useState("replies");
    const [status, setStatus] = useState(null);
    const loadStatus = useCallback(() => { adminWaStatus().then(setStatus).catch(() => setStatus({ error: true })); }, []);
    useEffect(loadStatus, [loadStatus]);
    const mode = status?.mode;
    return (
        <div data-testid="admin-whatsapp-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Interakt</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">WhatsApp</h1>
                </div>
                {status && !status.error && (
                    <div className="text-sm flex items-center gap-2" data-testid="wa-mode">
                        <span className={`px-2 py-0.5 font-mono text-[11px] tracking-widest border ${mode === "live" ? "border-[#15803D] text-[#15803D]" : mode === "test" ? "border-[#B4750F] text-[#B4750F]" : "border-[#4B5563] text-[#4B5563]"}`}>
                            {String(mode || "off").toUpperCase()}
                        </span>
                        {!status.api_key_set && <span className="text-[#CC0033]">API key not set on the server</span>}
                    </div>
                )}
            </div>
            {order && (
                <div className="mt-4 text-sm bg-[#F5F7FA] border border-[#E5E7EB] px-3 py-2 flex items-center gap-3">
                    Showing order <b>{order}</b>
                    <button type="button" className="underline" onClick={() => setParams({})}>Show all</button>
                </div>
            )}
            <div className="mt-6 flex gap-2 border-b border-[#E5E7EB]">
                {TABS.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                        className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === k ? "border-[#002B5C] text-[#002B5C] font-medium" : "border-transparent text-[#4B5563]"}`}>
                        {l}
                    </button>
                ))}
            </div>
            <div className="mt-6">
                {tab === "replies" && <RepliesTab order={order} />}
                {tab === "messages" && <MessagesTab order={order} />}
                {tab === "stats" && <StatsTab />}
                {tab === "settings" && <SettingsTab status={status} reload={loadStatus} canEdit={isSuperadmin(user?.role)} />}
            </div>
        </div>
    );
}

function RepliesTab({ order }) {
    const [q, setQ] = useState("");
    const dq = useDebounced(q);
    const [rows, setRows] = useState(null);
    const load = useCallback(() => {
        adminWaReplies(order ? { order } : dq ? { q: dq } : {}).then(setRows).catch(() => setRows([]));
    }, [order, dq]);
    useEffect(load, [load]);
    const markRead = async (id) => { try { await adminWaReplyRead(id); load(); } catch (e) { toast.error(formatApiError(e)); } };
    return (
        <div className="space-y-3">
            {!order && <SearchInput value={q} onChange={setQ} placeholder="Search reply text, phone, name, order…" />}
            {!rows ? <p className="text-sm text-[#4B5563]">Loading…</p> : (
                <ul className="divide-y border border-[#E5E7EB] bg-white" data-testid="wa-replies">
                    {rows.map((r) => (
                        <li key={r.id} className={`px-4 py-3 text-sm ${r.read ? "" : "bg-[#F59E0B]/5"}`}>
                            <div className="flex flex-wrap justify-between gap-2">
                                <span className="font-medium text-[#002B5C]">{r.name || r.phone} <span className="font-mono text-xs text-[#4B5563]">{r.phone}</span></span>
                                <span className="text-xs text-[#4B5563]">{when(r.at)}</span>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap">{r.text || (r.content_type ? `[${r.content_type}]` : "—")}</div>
                            {r.media_url && <a href={r.media_url} target="_blank" rel="noopener noreferrer" className="text-xs underline">Open attachment</a>}
                            <div className="mt-1 text-xs text-[#4B5563] flex gap-3">
                                {r.order_number ? <span>Order {r.order_number}</span> : <span>No matching order</span>}
                                {!r.read && <button type="button" className="underline" onClick={() => markRead(r.id)}>Mark read</button>}
                            </div>
                        </li>
                    ))}
                    {!rows.length && <li className="px-4 py-6 text-sm text-[#4B5563]">No replies {order || dq ? "match" : "yet"}.</li>}
                </ul>
            )}
            <p className="text-xs text-[#4B5563]">Reply to customers from the Interakt inbox — replies sent there are not shown here.</p>
        </div>
    );
}

function MessagesTab({ order }) {
    const [q, setQ] = useState("");
    const dq = useDebounced(q);
    const [kind, setKind] = useState("");
    const [st, setSt] = useState("");
    const [rows, setRows] = useState(null);
    useEffect(() => {
        const p = order ? { order } : { ...(dq ? { q: dq } : {}), ...(kind ? { kind } : {}), ...(st ? { status: st } : {}) };
        adminWaMessages(p).then(setRows).catch(() => setRows([]));
    }, [order, dq, kind, st]);
    const sel = "border border-[#E5E7EB] bg-white px-2 py-2 text-sm";
    return (
        <div className="space-y-3">
            {!order && (
                <div className="flex flex-wrap gap-2">
                    <SearchInput value={q} onChange={setQ} placeholder="Search order, phone, name, template…" />
                    <select value={kind} onChange={(e) => setKind(e.target.value)} className={sel}>
                        <option value="">All messages</option>
                        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <select value={st} onChange={(e) => setSt(e.target.value)} className={sel}>
                        <option value="">Any status</option>
                        {["accepted", "sent", "delivered", "read", "failed"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            )}
            {!rows ? <p className="text-sm text-[#4B5563]">Loading…</p> : (
                <table className="w-full text-sm bg-white border border-[#E5E7EB]" data-testid="wa-messages">
                    <thead><tr className="text-left text-[#4B5563]"><th className="p-2">When</th><th>Message</th><th>Order</th><th>To</th><th>Status</th></tr></thead>
                    <tbody>
                        {rows.map((m) => (
                            <tr key={m.id} className="border-t align-top">
                                <td className="p-2 text-xs">{when(m.created_at)}</td>
                                <td className="py-2">{KIND_LABEL[m.kind] || m.kind}{m.mode === "test" ? <span className="ml-1 text-[10px] font-mono text-[#B4750F]">TEST</span> : null}
                                    <div className="text-xs text-[#4B5563]">{(m.values || []).join(" · ")}</div></td>
                                <td className="text-xs">{m.order_number || "—"}</td>
                                <td className="text-xs font-mono">{m.to}</td>
                                <td className={`text-xs ${STATUS_TONE[m.status] || ""}`}>{m.status}{m.error ? <div className="text-[#CC0033] max-w-[22ch]">{m.error}</div> : null}</td>
                            </tr>
                        ))}
                        {!rows.length && <tr><td className="p-3 text-[#4B5563]" colSpan={5}>No messages {order || dq || kind || st ? "match" : "yet"}.</td></tr>}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function StatsTab() {
    const [days, setDays] = useState(30);
    const [s, setS] = useState(null);
    useEffect(() => { adminWaStats(days).then(setS).catch(() => setS({ by_kind: {}, by_day: {} })); }, [days]);
    if (!s) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
    const days_ = Object.entries(s.by_day || {});
    const max = Math.max(1, ...days_.map(([, d]) => d.total));
    return (
        <div className="space-y-6" data-testid="wa-stats">
            <div className="flex items-center gap-2 text-sm">Last
                {[7, 30, 90].map((d) => (
                    <button key={d} type="button" onClick={() => setDays(d)} className={`px-2 py-1 border ${days === d ? "border-[#002B5C] text-[#002B5C]" : "border-[#E5E7EB]"}`}>{d} days</button>
                ))}
                <span className="ml-auto text-[#4B5563]">{s.messages} messages · {s.replies} replies · spend ₹{(s.spend || 0).toFixed(2)}</span>
            </div>
            <table className="w-full text-sm bg-white border border-[#E5E7EB]">
                <thead><tr className="text-left text-[#4B5563]"><th className="p-2">Message</th><th className="text-right">Sent</th><th className="text-right">Delivered</th><th className="text-right">Read</th><th className="text-right">Failed</th><th className="text-right p-2">Cost</th></tr></thead>
                <tbody>
                    {Object.entries(s.by_kind || {}).map(([k, v]) => {
                        const deliv = (v.delivered || 0) + (v.read || 0);
                        return (
                            <tr key={k} className="border-t">
                                <td className="p-2">{KIND_LABEL[k] || k}</td>
                                <td className="text-right">{v.total}</td>
                                <td className="text-right">{deliv} <span className="text-xs text-[#4B5563]">({pct(deliv, v.total)})</span></td>
                                <td className="text-right">{v.read || 0} <span className="text-xs text-[#4B5563]">({pct(v.read || 0, v.total)})</span></td>
                                <td className="text-right text-[#CC0033]">{v.failed || 0}</td>
                                <td className="text-right p-2">₹{(v.cost || 0).toFixed(2)}</td>
                            </tr>
                        );
                    })}
                    {!Object.keys(s.by_kind || {}).length && <tr><td className="p-3 text-[#4B5563]" colSpan={6}>Nothing sent in this period (test sends are not counted).</td></tr>}
                </tbody>
            </table>
            <CategoryWarnings list={s.category_warnings} />
            {days_.length > 0 && (
                <div className="bg-white border border-[#E5E7EB] p-4">
                    <div className="text-sm font-medium text-[#002B5C] mb-3">By day</div>
                    <div className="flex items-end gap-1 h-32" aria-label="Messages per day">
                        {days_.map(([d, v]) => (
                            <div key={d} className="flex-1 min-w-[6px] flex flex-col justify-end" title={`${d}: ${v.total} sent, ${v.delivered_or_read} delivered, ${v.read} read, ${v.failed} failed`}>
                                <div className="bg-[#002B5C]/15" style={{ height: `${((v.total - v.delivered_or_read) / max) * 100}%` }} />
                                <div className="bg-[#15803D]" style={{ height: `${(v.delivered_or_read / max) * 100}%` }} />
                            </div>
                        ))}
                    </div>
                    <div className="text-xs text-[#4B5563] mt-2">Green = delivered or read · light = not (yet) delivered. Hover a bar for the day.</div>
                </div>
            )}
        </div>
    );
}

/* A template Meta approved under the wrong category (seen: order_cancelled
   approved as MARKETING — billed at the marketing rate, and not delivered to
   people who opted out of marketing). Taken from the delivery reports. */
function CategoryWarnings({ list }) {
    if (!list?.length) return null;
    return (
        <div className="border border-[#CC0033] bg-[#CC0033]/5 p-3 text-sm text-[#CC0033] space-y-1" data-testid="wa-category-warnings">
            {list.map((w) => (
                <div key={w.kind}>
                    <b>{w.template}</b> is approved as <b>{w.category}</b> but should be <b>{w.expected}</b>.
                    {w.expected === "UTILITY" ? " It is billed at the marketing rate and is not delivered to people who opted out of marketing. Re-create it in Interakt as Utility with “allow category change” off." : ""}
                </div>
            ))}
        </div>
    );
}

function SettingsTab({ status, reload, canEdit }) {
    const [f, setF] = useState(null);
    const [busy, setBusy] = useState(false);
    const [events, setEvents] = useState(null);
    useEffect(() => {
        if (status && !status.error) setF({ mode: status.mode, test_phone: status.test_phone || "", language: status.language || "en",
            sync_customers: status.sync_customers !== false, templates: { ...(status.templates || {}) } });
    }, [status]);
    if (!status) return <p className="text-sm text-[#4B5563]">Loading…</p>;
    if (status.error) return <p className="text-sm text-[#CC0033]">Could not load.</p>;
    if (!f) return null;
    const save = async (patch = {}) => {
        setBusy(true);
        try { await adminWaConfig({ ...f, ...patch }); toast.success("Saved."); reload(); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const test = async (kind) => {
        setBusy(true);
        try {
            const r = await adminWaTest(kind);
            if (r.status === "failed") toast.error(`Not sent: ${r.error}`); else toast.success(`Sent to ${r.to} — check the phone.`);
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    const box = "border border-[#E5E7EB] bg-white px-3 py-2 text-sm w-full";
    const ro = !canEdit;
    return (
        <div className="space-y-6 max-w-3xl" data-testid="wa-settings">
            <CategoryWarnings list={status.category_warnings} />
            <div className="bg-white border border-[#E5E7EB] p-5 space-y-3">
                <div className="font-medium text-[#002B5C]">Sending</div>
                <div className="flex flex-wrap gap-2">
                    {[["off", "Off — nothing is sent"], ["test", "Test — everything goes to the test number"], ["live", "Live — customers get messages"]].map(([m, l]) => (
                        <label key={m} className={`px-3 py-2 border text-sm cursor-pointer ${f.mode === m ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#E5E7EB]"}`}>
                            <input type="radio" name="wa-mode" className="mr-2" checked={f.mode === m} disabled={ro} onChange={() => setF({ ...f, mode: m })} />{l}
                        </label>
                    ))}
                </div>
                <label className="block text-sm">Test number (your WhatsApp)
                    <input className={box} value={f.test_phone} disabled={ro} onChange={(e) => setF({ ...f, test_phone: e.target.value })} placeholder="+91 98xxxxxxxx" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.sync_customers} disabled={ro} onChange={(e) => setF({ ...f, sync_customers: e.target.checked })} />
                    Sync paying customers to Interakt (name, email, orders, spend + an “Order Paid” event) — Live only
                </label>
            </div>
            <div className="bg-white border border-[#E5E7EB] p-5 space-y-3">
                <div className="font-medium text-[#002B5C]">Templates (exact names as approved in Interakt)</div>
                {Object.keys(KIND_LABEL).map((k) => (
                    <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-40">{KIND_LABEL[k]}</span>
                        <input className="border border-[#E5E7EB] px-2 py-1.5 font-mono text-xs flex-1 min-w-[180px]" value={f.templates[k] || ""} disabled={ro}
                            onChange={(e) => setF({ ...f, templates: { ...f.templates, [k]: e.target.value } })} />
                        {canEdit && <button type="button" disabled={busy} className="border px-2 py-1 text-xs" onClick={() => test(k)}>Send test</button>}
                    </div>
                ))}
                <label className="block text-sm">Language code
                    <input className="border border-[#E5E7EB] px-2 py-1.5 font-mono text-xs w-28 ml-2" value={f.language} disabled={ro} onChange={(e) => setF({ ...f, language: e.target.value })} />
                </label>
                <p className="text-xs text-[#4B5563]">Wording and variable order: docs/interakt-setup.md. A test send ignores the mode and always goes to the test number.</p>
            </div>
            <div className="bg-white border border-[#E5E7EB] p-5 space-y-2 text-sm">
                <div className="font-medium text-[#002B5C]">Webhook (delivery reports + replies)</div>
                <div>API key on server: <b className={status.api_key_set ? "text-[#15803D]" : "text-[#CC0033]"}>{status.api_key_set ? "set" : "missing"}</b> ·
                    Webhook secret: <b className={status.webhook_secret_set ? "text-[#15803D]" : "text-[#CC0033]"}>{status.webhook_secret_set ? "set" : "missing"}</b></div>
                {status.webhook_secret_weak && (
                    <div className="border border-[#CC0033] text-[#CC0033] p-2 text-xs" data-testid="wa-weak-secret">
                        The webhook secret is short or has symbols. Replace INTERAKT_WEBHOOK_SECRET in Render with 64 random letters and
                        numbers (never a password you use anywhere else), then paste the new URL and secret into Interakt.
                    </div>
                )}
                {status.webhook_url && (
                    <div>Paste into Interakt → Developer Settings → Webhook URL:
                        <code className="block mt-1 p-2 bg-[#F5F7FA] break-all text-xs" data-testid="wa-webhook-url">{status.webhook_url}</code>
                        <span className="text-xs text-[#4B5563]">Secret Key there: the same value as INTERAKT_WEBHOOK_SECRET in Render.</span>
                    </div>
                )}
                <div className="text-xs text-[#4B5563]">Last webhook: {status.last_webhook ? `${status.last_webhook.type} at ${when(status.last_webhook.at)}${status.last_webhook.sig_ok == null ? "" : status.last_webhook.sig_ok ? " · signature matched" : " · signature did not match HMAC-SHA256"}` : "none received yet"}</div>
                {canEdit && (
                    <button type="button" className="underline text-xs" onClick={() => adminWaEvents().then(setEvents).catch((e) => toast.error(formatApiError(e)))}>Show raw recent webhooks</button>
                )}
                {events && <pre className="text-[11px] bg-[#F5F7FA] p-2 max-h-80 overflow-auto whitespace-pre-wrap">{events.map((e) => `${e.at} ${e.type} sig_ok=${e.sig_ok}\n${e.body}`).join("\n\n") || "none"}</pre>}
            </div>
            {canEdit ? (
                <button type="button" disabled={busy} className="bg-[#002B5C] text-white px-5 py-2 text-sm disabled:opacity-50" onClick={() => save()} data-testid="wa-save">Save settings</button>
            ) : <p className="text-xs text-[#4B5563]">Only a superadmin can change these settings.</p>}
        </div>
    );
}
