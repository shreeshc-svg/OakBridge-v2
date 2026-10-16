import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Lock, Eye, Send, ChevronDown, ChevronRight, X } from "lucide-react";
import {
    adminEmailManager,
    adminSaveEmailManager,
    adminPreviewEmail,
    adminTestEmail,
    adminEmailLog,
    adminUploadMedia,
    mediaUrl,
} from "../../lib/api";

/**
 * Admin → Email Manager — every email a customer receives, in one place.
 *
 * Top: WHO customers hear from (a named person who signs every email, the
 * inbox replies go to, WhatsApp, hours, the dispatch promise). Then each email:
 * on/off, subject line, the personal note it carries, preview and a test send
 * (to your own address only). Bottom: what was actually sent.
 *
 * Saving rewrites one settings object (backend/email_manager.py); the server
 * cleans every field again, so a typo here can never break an email — it falls
 * back to the default. Sign-up code and password reset are locked on.
 */

const INPUT = "w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]";
const GROUPS = ["Orders", "Cart & stock", "Account", "Replies"];

function Field({ label, hint, children }) {
    return (
        <label className="block text-xs text-[#4B5563]">
            {label}
            <div className="mt-1">{children}</div>
            {hint && <div className="text-[11px] text-[#6B7280] mt-1">{hint}</div>}
        </label>
    );
}

function PreviewModal({ data, onClose }) {
    if (!data) return null;
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
            <div className="bg-white w-full max-w-[720px] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 py-3">
                    <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Subject</div>
                        <div className="text-sm font-medium text-[#002B5C] truncate">{data.subject}</div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close preview" className="p-1 border border-[#E5E7EB]"><X size={16} /></button>
                </div>
                {/* sandbox: the email's HTML is ours, but a preview never needs
                    scripts or to navigate the admin page. */}
                <iframe title="Email preview" sandbox="" srcDoc={data.html} className="flex-1 w-full min-h-[70vh] border-0" />
            </div>
        </div>
    );
}

export default function AdminEmails() {
    const [data, setData] = useState(null);
    const [cfg, setCfg] = useState(null);
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(null);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState("");
    const [log, setLog] = useState([]);

    const load = () =>
        adminEmailManager()
            .then((d) => {
                setData(d);
                setCfg(d.config);
            })
            .catch(() => toast.error("Could not load the Email Manager."));
    useEffect(() => {
        load();
        adminEmailLog().then((d) => setLog(d.items || [])).catch(() => {});
    }, []);

    const dirty = useMemo(() => data && cfg && JSON.stringify(cfg) !== JSON.stringify(data.config), [data, cfg]);
    if (!data || !cfg) return <div className="p-6 text-sm text-[#4B5563]">Loading…</div>;

    const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
    const kindCfg = (key) => (cfg.kinds || {})[key] || {};
    const setKind = (key, k, v) => setCfg((c) => ({ ...c, kinds: { ...(c.kinds || {}), [key]: { ...((c.kinds || {})[key] || {}), [k]: v } } }));

    const save = async () => {
        setSaving(true);
        try {
            const r = await adminSaveEmailManager(cfg);
            setData((d) => ({ ...d, config: r.config }));
            setCfg(r.config);
            toast.success("Saved — every email uses it from now on.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };
    const doPreview = async (kind) => {
        setBusy(`p-${kind}`);
        try {
            setPreview(await adminPreviewEmail(kind, cfg));
        } catch {
            toast.error("Preview failed.");
        } finally {
            setBusy("");
        }
    };
    const doTest = async (kind) => {
        setBusy(`t-${kind}`);
        try {
            const r = await adminTestEmail(kind, cfg);
            toast.success(`Test sent to ${r.to}`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Test send failed.");
        } finally {
            setBusy("");
        }
    };
    const uploadPhoto = async (file) => {
        if (!file) return;
        try {
            const m = await adminUploadMedia(file);
            const url = mediaUrl(m.url) || m.url;
            if (!/^https:\/\//.test(url)) {
                toast.error("The photo needs a public https address — object storage (S3) may not be configured.");
                return;
            }
            set("signer_photo", url);
        } catch {
            toast.error("Upload failed.");
        }
    };

    const kindsBy = GROUPS.map((g) => [g, data.kinds.filter((k) => k.group === g)]);
    const sent30 = data.kinds.reduce((n, k) => n + (k.counts?.sent || 0), 0);

    return (
        <div data-testid="admin-emails" className="space-y-8 max-w-5xl">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="font-serif text-3xl text-[#002B5C]">Email Manager</h1>
                    <p className="text-sm text-[#4B5563] mt-1 max-w-2xl">
                        Every email a customer receives from Oakbridge, signed by a real person they can reply to.
                        {" "}{sent30.toLocaleString("en-IN")} sent in the last 30 days.
                    </p>
                </div>
                <button type="button" onClick={save} disabled={saving || !dirty} data-testid="emails-save"
                    className="bg-[#002B5C] text-white px-5 py-2 text-sm disabled:opacity-40">
                    {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
                </button>
            </div>

            {/* WHO customers hear from */}
            <section className="border border-[#E5E7EB] bg-white p-5">
                <h2 className="font-serif text-xl text-[#002B5C]">Who customers hear from</h2>
                <p className="text-xs text-[#4B5563] mt-1">Shown as a signed note in every email below. Replies go to the inbox you set here — make sure someone reads it daily.</p>
                <div className="mt-4 grid sm:grid-cols-2 gap-4">
                    <Field label="Signed by (first name)" hint="Blank signs as the team.">
                        <input className={INPUT} value={cfg.signer_name} onChange={(e) => set("signer_name", e.target.value)} placeholder="e.g. Shreesh" />
                    </Field>
                    <Field label="Role">
                        <input className={INPUT} value={cfg.signer_role} onChange={(e) => set("signer_role", e.target.value)} placeholder="Reader Care" />
                    </Field>
                    <Field label="Replies go to" hint="The Reply-To on every customer email.">
                        <input className={INPUT} type="email" value={cfg.reply_to} onChange={(e) => set("reply_to", e.target.value)} placeholder="care@oakbridge.in" />
                    </Field>
                    <Field label="Team / company name">
                        <input className={INPUT} value={cfg.team_name} onChange={(e) => set("team_name", e.target.value)} />
                    </Field>
                    <Field label="WhatsApp number" hint="Shown only when filled, as a tap-to-chat link.">
                        <input className={INPUT} value={cfg.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="+91 98xxx xxxxx" />
                    </Field>
                    <Field label="Opening hours">
                        <input className={INPUT} value={cfg.hours} onChange={(e) => set("hours", e.target.value)} />
                    </Field>
                    <Field label="Dispatch promise" hint="Used as {dispatch_promise} in notes — only promise what the warehouse can keep.">
                        <input className={INPUT} value={cfg.dispatch_promise} onChange={(e) => set("dispatch_promise", e.target.value)} />
                    </Field>
                    <Field label="Sign-off">
                        <input className={INPUT} value={cfg.signoff} onChange={(e) => set("signoff", e.target.value)} placeholder="Warm regards" />
                    </Field>
                    <Field label="Photo (optional)" hint="A friendly head-and-shoulders photo, square. Without one, the initial is shown.">
                        <div className="flex items-center gap-3">
                            {cfg.signer_photo
                                ? <img src={cfg.signer_photo} alt="" className="w-10 h-10 rounded-full object-cover border border-[#E5E7EB]" />
                                : <span className="w-10 h-10 rounded-full bg-[#002B5C] text-white grid place-items-center text-sm">{(cfg.signer_name || cfg.team_name || "O")[0]}</span>}
                            <input type="file" accept="image/*" onChange={(e) => uploadPhoto(e.target.files?.[0])} className="text-xs" />
                            {cfg.signer_photo && <button type="button" className="text-xs underline" onClick={() => set("signer_photo", "")}>Remove</button>}
                        </div>
                    </Field>
                    <Field label="Link tracking">
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={cfg.utm !== false} onChange={(e) => set("utm", e.target.checked)} />
                            Tag our links (utm_source=email) so Marketing → Growth counts the visits and orders these emails bring
                        </label>
                    </Field>
                </div>
            </section>

            {/* Each email */}
            <section className="space-y-6">
                {kindsBy.map(([group, kinds]) => (
                    <div key={group}>
                        <div className="overline !text-[10px] mb-2">{group}</div>
                        <div className="border border-[#E5E7EB] bg-white divide-y divide-[#E5E7EB]">
                            {kinds.map((k) => {
                                const kc = kindCfg(k.key);
                                const on = k.locked || kc.enabled !== false;
                                const isOpen = open === k.key;
                                return (
                                    <div key={k.key} data-testid={`email-kind-${k.key}`}>
                                        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                                            <button type="button" onClick={() => setOpen(isOpen ? null : k.key)} className="flex items-center gap-2 text-left flex-1 min-w-[220px]" aria-expanded={isOpen}>
                                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                <span>
                                                    <span className="text-sm font-medium text-[#002B5C]">{k.label}</span>
                                                    <span className="block text-[11px] text-[#6B7280]">{k.trigger}</span>
                                                </span>
                                            </button>
                                            <span className="text-[11px] text-[#6B7280] whitespace-nowrap" title="Last 30 days">
                                                {k.counts?.sent || 0} sent{k.counts?.failed ? ` · ${k.counts.failed} failed` : ""}{k.counts?.skipped ? ` · ${k.counts.skipped} off` : ""}
                                            </span>
                                            <button type="button" onClick={() => doPreview(k.key)} disabled={busy === `p-${k.key}`} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-2 py-1"><Eye size={12} /> Preview</button>
                                            <button type="button" onClick={() => doTest(k.key)} disabled={busy === `t-${k.key}`} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-2 py-1"><Send size={12} /> {busy === `t-${k.key}` ? "Sending…" : "Test to me"}</button>
                                            {k.locked ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]" title="Security and receipts always go"><Lock size={12} /> Always on</span>
                                            ) : (
                                                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                                                    <input type="checkbox" checked={on} onChange={(e) => setKind(k.key, "enabled", e.target.checked)} data-testid={`email-toggle-${k.key}`} /> On
                                                </label>
                                            )}
                                        </div>
                                        {isOpen && (
                                            <div className="px-4 pb-4 grid gap-3 bg-[#FBFBFC]">
                                                <Field label="Subject line" hint="Blank keeps the built-in subject. Merge fields work here too.">
                                                    <input className={INPUT} value={kc.subject || ""} onChange={(e) => setKind(k.key, "subject", e.target.value)} placeholder="(built-in subject)" />
                                                </Field>
                                                {(k.note || kc.note) ? (
                                                    <Field
                                                        label="Personal note (signed)"
                                                        hint={`Blank uses the default below. Type a single - for no note. Merge fields: ${data.merge_fields.map((f) => `{${f}}`).join(" ")}`}
                                                    >
                                                        <textarea rows={4} className={INPUT} value={kc.note || ""} onChange={(e) => setKind(k.key, "note", e.target.value)} placeholder={k.note} />
                                                    </Field>
                                                ) : (
                                                    <p className="text-xs text-[#6B7280]">This email carries no personal note{k.locked ? " (a security email — kept short and plain)" : " (it is already a signed letter)"}.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}

                <div>
                    <div className="overline !text-[10px] mb-2">Automations (edited in Marketing → Growth)</div>
                    <div className="border border-[#E5E7EB] bg-white divide-y divide-[#E5E7EB] text-sm">
                        {[
                            ["abandoned", "Unpaid checkout reminder", `After ${data.growth?.abandoned?.delay_hours ?? 2} h — any visitor who gave an email`],
                            ["review", "Review request", `${data.growth?.review?.days_after_delivery ?? 10} days after delivery`],
                        ].map(([k, label, when]) => (
                            <div key={k} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                <div className="flex-1 min-w-[220px]">
                                    <div className="font-medium text-[#002B5C]">{label}</div>
                                    <div className="text-[11px] text-[#6B7280]">{when}</div>
                                </div>
                                <span className={`text-xs ${data.growth?.[k]?.enabled ? "text-[#15803D]" : "text-[#CC0033]"}`}>{data.growth?.[k]?.enabled ? "On" : "Off"}</span>
                                <Link to="/admin/marketing" className="text-xs underline">Open Growth</Link>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* What was sent */}
            <section>
                <div className="overline !text-[10px] mb-2">Recently sent (kept 90 days)</div>
                <div className="border border-[#E5E7EB] bg-white overflow-x-auto">
                    <table className="w-full text-xs" data-testid="email-log">
                        <thead className="bg-[#F5F7FA] text-[#4B5563]">
                            <tr><th className="text-left p-2">When</th><th className="text-left p-2">Email</th><th className="text-left p-2">To</th><th className="text-left p-2">Subject</th><th className="text-left p-2">Result</th></tr>
                        </thead>
                        <tbody>
                            {log.length === 0 && <tr><td colSpan={5} className="p-3 text-[#6B7280]">Nothing logged yet — sends appear here from now on.</td></tr>}
                            {log.map((r, i) => (
                                <tr key={i} className="border-t border-[#F3F4F6]">
                                    <td className="p-2 whitespace-nowrap">{new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                                    <td className="p-2">{data.kinds.find((k) => k.key === r.kind)?.label || r.kind}</td>
                                    <td className="p-2 font-mono">{r.to}</td>
                                    <td className="p-2">{r.subject}</td>
                                    <td className={`p-2 ${r.status === "sent" ? "text-[#15803D]" : r.status === "skipped" ? "text-[#6B7280]" : "text-[#CC0033]"}`}>{r.status === "skipped" ? "switched off" : r.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <PreviewModal data={preview} onClose={() => setPreview(null)} />
        </div>
    );
}
