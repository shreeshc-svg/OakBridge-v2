import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, RefreshCw } from "lucide-react";
import { mkAiNextActions, mkAiCreateAction, mkAiSubject, mkAiSettings, mkAiSaveSettings, formatApiError } from "../../lib/api";

/**
 * AI in Admin → Marketing (Oct 2026). Backend: backend/ai_insights.py + ai_core.py.
 *
 *   AIInsightCard  "What this means": a headline, findings and next steps for
 *                  Growth, a campaign report, or deliverability.
 *   NextActions    "Do this next": campaigns most likely to sell now, with the
 *                  audience size and one click to a DRAFT campaign.
 *   SubjectCoach   checks a subject line and offers 3 honest alternatives.
 *   AISwitch       superadmin on/off.
 *
 * Every number on these cards was computed by our code. The model only
 * words it, and a reply with a number that isn't in our figures is thrown
 * away — the card then shows the figures' own findings ("figures only").
 * So the label below is a reminder to use judgement, not a warning that the
 * numbers may be wrong.
 */
const LABEL = "AI summary of our own figures — check before acting.";

export function AIInsightCard({ title = "What this means", load, deps = [], testid = "mk-ai-card" }) {
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [showFacts, setShowFacts] = useState(false);
    const run = useCallback(async (refresh = false) => {
        setBusy(true);
        setErr("");
        try {
            setD(await load(refresh));
        } catch (e) {
            setErr(formatApiError(e));
        } finally {
            setBusy(false);
        }
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { run(false); }, [run]);
    const i = d?.insight;
    return (
        <div className="border border-[#C7D2FE] bg-gradient-to-br from-[#F5F7FF] to-white p-4" data-testid={testid}>
            <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#4F46E5]" />
                <div className="text-sm font-medium text-[#1E1B4B]">{title}</div>
                {d && <span className={`text-[10px] px-1.5 py-0.5 ${d.ai ? "bg-[#E0E7FF] text-[#3730A3]" : "bg-[#F3F4F6] text-[#4B5563]"}`}>{d.ai ? "AI" : "Figures only"}</span>}
                <button type="button" onClick={() => run(true)} disabled={busy} className="ml-auto text-xs text-[#4F46E5] flex items-center gap-1 disabled:opacity-50"
                    aria-label="Regenerate">
                    <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> {busy ? "Thinking…" : "Regenerate"}
                </button>
            </div>
            {err && <p className="mt-2 text-xs text-[#CC0033]">{err}</p>}
            {!d && !err && <p className="mt-2 text-xs text-[#6B7280]">Reading the figures…</p>}
            {i && (
                <>
                    <p className="mt-2 text-[15px] text-[#111827] font-medium leading-snug">{i.headline}</p>
                    {i.findings?.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-[#374151] list-disc ml-5">{i.findings.map((x) => <li key={x}>{x}</li>)}</ul>
                    )}
                    {i.actions?.length > 0 && (
                        <div className="mt-3">
                            <div className="text-xs font-medium text-[#3730A3] uppercase tracking-wide">Do next</div>
                            <ul className="mt-1 space-y-1 text-sm text-[#1E1B4B]">{i.actions.map((x) => <li key={x}>→ {x}</li>)}</ul>
                        </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[#6B7280]">
                        <span>{d.ai ? LABEL : d.note || "Figures only."}</span>
                        <button type="button" className="underline" onClick={() => setShowFacts((x) => !x)}>{showFacts ? "Hide" : "Show"} the figures used</button>
                    </div>
                    {showFacts && <pre className="mt-2 max-h-64 overflow-auto bg-white border border-[#E5E7EB] p-2 text-[11px] whitespace-pre-wrap">{JSON.stringify(d.facts, null, 2)}</pre>}
                </>
            )}
        </div>
    );
}

export function NextActions({ onOpen }) {
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState("");
    const load = useCallback(() => mkAiNextActions().then(setD).catch(() => setD({ actions: [], error: true })), []);
    useEffect(() => { load(); }, [load]);
    const create = async (a) => {
        if (!window.confirm(`Create a DRAFT campaign for ${a.audience} people?\n\n${a.why}\n\nNothing is sent until you press Send in the campaign. Only people who agreed to marketing email are included.`)) return;
        setBusy(a.key);
        try {
            const r = await mkAiCreateAction(a.key);
            toast.success(`Draft created for ${r.audience} people — check it and send.`);
            onOpen?.(r.campaign_id);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy("");
        }
    };
    if (!d) return null;
    return (
        <div className="border border-[#C7D2FE] bg-white p-4" data-testid="mk-next-actions">
            <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#4F46E5]" />
                <div className="text-sm font-medium text-[#1E1B4B]">Do this next — campaigns most likely to sell now</div>
                <button type="button" onClick={load} className="ml-auto text-xs text-[#4F46E5]">Refresh</button>
            </div>
            {!d.actions.length ? (
                <p className="mt-2 text-sm text-[#6B7280]">{d.error ? "Couldn't work out suggestions right now." : "Nothing stands out right now — check back after new books or orders."}</p>
            ) : (
                <div className="mt-3 grid md:grid-cols-2 gap-3">
                    {d.actions.map((a) => (
                        <div key={a.key} className="border border-[#E5E7EB] p-3 flex flex-col" data-testid="mk-next-action">
                            <div className="font-medium text-[#002B5C]">{a.title}</div>
                            <p className="text-sm text-[#4B5563] mt-1 flex-1">{a.why}</p>
                            {a.last && (
                                <p className="text-[11px] text-[#15803D] mt-1">Last time: {a.last.sent} sent · {a.last.opened} opened · {a.last.paid} orders · ₹{a.last.revenue}</p>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                                <span className="text-xs bg-[#EEF2FF] text-[#3730A3] px-2 py-0.5">{a.audience} people</span>
                                <button type="button" disabled={!!busy} onClick={() => create(a)} className="ml-auto bg-[#002B5C] text-white px-3 py-1.5 text-sm disabled:opacity-50">
                                    {busy === a.key ? "Creating…" : "Create draft campaign"}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <p className="mt-2 text-[11px] text-[#6B7280]">Worked out from our orders and consent records (not by AI). Each draft uses “Picked for you”, so every reader sees the books closest to what they bought. People emailed in the last 3 days are left out.</p>
        </div>
    );
}

export function SubjectCoach({ subject, preheader, about, onUse, onUsePreheader }) {
    const [r, setR] = useState(null);
    const [busy, setBusy] = useState(false);
    const go = async () => {
        if (!(subject || "").trim()) return toast.error("Write a subject first.");
        setBusy(true);
        try {
            setR(await mkAiSubject({ subject, preheader, about }));
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="border border-[#C7D2FE] bg-[#F8F9FF] p-3 text-sm" data-testid="mk-subject-coach">
            <button type="button" onClick={go} disabled={busy} className="flex items-center gap-1 text-[#4F46E5] font-medium disabled:opacity-50">
                <Sparkles size={14} /> {busy ? "Checking…" : r ? "Check again" : "Check this subject & suggest better ones"}
            </button>
            {r && (
                <div className="mt-2 space-y-2">
                    <ul className="text-xs text-[#374151] space-y-0.5">{r.checks.map((c) => <li key={c}>• {c}</li>)}</ul>
                    {r.suggestions.length > 0 && (
                        <div>
                            <div className="text-xs text-[#3730A3] font-medium">Try instead (tap to use)</div>
                            <div className="mt-1 flex flex-col gap-1">
                                {r.suggestions.map((s) => (
                                    <button key={s} type="button" onClick={() => onUse(s)} className="text-left border border-[#C7D2FE] bg-white px-2 py-1.5 hover:bg-[#EEF2FF]">{s}</button>
                                ))}
                                {r.preheader && onUsePreheader && (
                                    <button type="button" onClick={() => onUsePreheader(r.preheader)} className="text-left border border-dashed border-[#C7D2FE] bg-white px-2 py-1.5 text-xs">
                                        Preview text: {r.preheader}
                                    </button>
                                )}
                            </div>
                            <p className="text-[11px] text-[#6B7280] mt-1">Suggestions never add prices, discounts or deadlines you didn't write. Tip: send two subjects to small groups first and keep the one that's opened more.</p>
                        </div>
                    )}
                    {r.note && <p className="text-[11px] text-[#6B7280]">{r.note}</p>}
                </div>
            )}
        </div>
    );
}

export function AISwitch({ canEdit }) {
    const [s, setS] = useState(null);
    useEffect(() => { mkAiSettings().then(setS).catch(() => {}); }, []);
    if (!s) return null;
    const toggle = async () => {
        if (!window.confirm(`${s.enabled ? "Switch off" : "Switch on"} AI summaries in Marketing?`)) return;
        try { setS({ ...s, ...(await mkAiSaveSettings(!s.enabled)) }); } catch (e) { toast.error(formatApiError(e)); }
    };
    return (
        <div className="border border-[#E5E7EB] bg-white p-4 text-sm" data-testid="mk-ai-switch">
            <div className="font-medium text-[#002B5C]">AI summaries</div>
            <p className="text-xs text-[#4B5563] mt-1 max-w-2xl">
                Plain-English summaries on Growth, campaign reports and deliverability, and subject-line suggestions. Only totals are sent to
                the AI model ({s.model}) — never names, email addresses or phone numbers. Figures are always worked out by our own code.
            </p>
            <div className="mt-2 flex items-center gap-3">
                <span className={s.enabled ? "text-[#15803D]" : "text-[#6B7280]"}>{s.enabled ? "On" : "Off"}</span>
                {canEdit && <button type="button" onClick={toggle} className="border px-3 py-1 text-xs">{s.enabled ? "Switch off" : "Switch on"}</button>}
            </div>
        </div>
    );
}
