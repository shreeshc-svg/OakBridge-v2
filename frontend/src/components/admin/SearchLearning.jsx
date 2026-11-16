import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Check, X, Ban, Play, AlertTriangle } from "lucide-react";
import { adminSearchLearning, adminSearchLearningRun, adminSearchLearningAct, mediaUrl, formatApiError } from "../../lib/api";

/**
 * Admin → Dashboard → "Search that learns" (backend/search_learning.py).
 * Every night the AI looks at searches that found nothing and proposes what
 * the visitor wanted. A person approves before anything goes live (only an
 * obvious near-title match is applied by itself, marked "auto"). Live fixes
 * show how often they fired and were clicked; one that fires and is never
 * clicked is flagged. "Titles people ask for" = searches for books we don't
 * have — a listing / publishing signal.
 */
const KIND = { title: ["Points to our book", "#0A7D55"], related: ["Related titles", "#1E6FB8"], not_ours: ["Not ours", "#6B7280"] };

function Books({ books }) {
    return (
        <div className="flex flex-wrap gap-2 mt-1.5">
            {books.map((b) => (
                <span key={b.id} className="inline-flex items-center gap-1.5 bg-[#F5F7FA] border border-[#E5E7EB] pr-2 text-xs text-[#002B5C]">
                    {b.cover_image ? <img src={mediaUrl(b.cover_image)} alt="" className="w-6 h-8 object-cover" /> : <span className="w-6 h-8 bg-[#E5E7EB]" />}
                    {b.title}
                </span>
            ))}
        </div>
    );
}

export default function SearchLearning({ superadmin }) {
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => adminSearchLearning().then(setD).catch((e) => toast.error(formatApiError(e))), []);
    useEffect(() => { load(); }, [load]);
    const act = async (id, action, ok) => { try { await adminSearchLearningAct(id, action); toast.success(ok); load(); } catch (e) { toast.error(formatApiError(e)); } };
    const run = async () => {
        setBusy(true);
        try {
            const r = await adminSearchLearningRun();
            if (r.error) toast.error(r.error);
            else toast.success(r.asked ? `Looked at ${r.asked} dead-end searches — ${r.proposed} proposal(s)${r.auto ? `, ${r.auto} applied automatically` : ""}.` : "No new dead-end searches to learn from.");
            load();
        } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
    };
    if (!d) return null;
    return (
        <div className="mt-6 bg-white border border-[#E5E7EB]" data-testid="search-learning">
            <div className="px-5 py-3 border-b border-[#E5E7EB] flex flex-wrap items-center gap-3">
                <Sparkles size={16} className="text-[#7C3AED]" />
                <div className="flex-1">
                    <div className="font-medium text-[#002B5C]">Search that learns</div>
                    <div className="text-xs text-[#4B5563]">Every night AI studies searches that found nothing and suggests what the visitor wanted. Nothing goes live until you approve it (obvious near-title matches apply themselves, marked “auto”).</div>
                </div>
                {superadmin && <button type="button" disabled={busy} onClick={run} className="inline-flex items-center gap-1.5 border border-[#7C3AED] text-[#7C3AED] px-3 py-1.5 text-xs disabled:opacity-50"><Play size={12} />{busy ? "Thinking…" : "Run now"}</button>}
            </div>

            <div className="p-5 space-y-6">
                <section>
                    <h4 className="overline !text-[10px] mb-2">To review ({d.suggested.filter((r) => r.kind !== "not_ours").length})</h4>
                    {d.suggested.filter((r) => r.kind !== "not_ours").length === 0 ? <p className="text-sm text-[#4B5563]">Nothing waiting.</p> : (
                        <ul className="divide-y divide-[#F3F4F6]">
                            {d.suggested.filter((r) => r.kind !== "not_ours").map((r) => {
                                const [kl, kc] = KIND[r.kind];
                                return (
                                    <li key={r.id} className="py-3 flex flex-wrap gap-3 items-start">
                                        <div className="flex-1 min-w-[240px]">
                                            <div className="text-sm"><b className="text-[#002B5C]">“{r.q}”</b> <span className="text-xs text-[#6B7280]">searched {r.searches}×</span>
                                                <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 text-white" style={{ background: kc }}>{kl}</span></div>
                                            <Books books={r.books} />
                                            {r.reason && <div className="text-xs text-[#4B5563] mt-1.5 italic">AI: {r.reason} · confidence {Math.round((r.confidence || 0) * 100)}%</div>}
                                        </div>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => act(r.id, "approve", "Live — that search now finds these books.")} className="inline-flex items-center gap-1 bg-[#0A7D55] text-white px-3 py-1.5 text-xs"><Check size={13} />Approve</button>
                                            <button type="button" onClick={() => act(r.id, "reject", "Rejected.")} className="inline-flex items-center gap-1 border border-[#E5E7EB] px-3 py-1.5 text-xs"><X size={13} />Reject</button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                <section>
                    <h4 className="overline !text-[10px] mb-2">Live fixes ({d.live.length})</h4>
                    {d.live.length === 0 ? <p className="text-sm text-[#4B5563]">None yet.</p> : (
                        <ul className="divide-y divide-[#F3F4F6]">
                            {d.live.map((r) => (
                                <li key={r.id} className="py-2.5 flex flex-wrap gap-3 items-center text-sm">
                                    <span className="flex-1 min-w-[240px]"><b className="text-[#002B5C]">“{r.q}”</b> → {r.books.map((b) => b.title).join(", ")}
                                        {r.status === "auto" && <span className="ml-2 text-[10px] uppercase tracking-wider bg-[#F3E8FF] text-[#6B21A8] px-1.5 py-0.5">auto</span>}</span>
                                    <span className="font-mono text-xs text-[#4B5563]">{r.hits || 0} shown · {r.clicks || 0} clicked</span>
                                    {r.needs_review && <span className="inline-flex items-center gap-1 text-xs text-[#CC0033]"><AlertTriangle size={12} />never clicked — check it</span>}
                                    <button type="button" onClick={() => act(r.id, "disable", "Taken off the site.")} className="inline-flex items-center gap-1 text-xs underline text-[#4B5563]"><Ban size={12} />Turn off</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section>
                    <h4 className="overline !text-[10px] mb-1">Titles people ask for — we don't have them</h4>
                    <p className="text-xs text-[#4B5563] mb-2">Searched for, and nothing in the catalogue fits. If one is ours but not listed online, add it; if it isn't, it may be worth publishing or stocking.</p>
                    {d.asked_for.length === 0 ? <p className="text-sm text-[#4B5563]">None yet.</p> : (
                        <div className="flex flex-wrap gap-2">
                            {d.asked_for.map((r) => (
                                <span key={r.id} className="inline-flex items-center gap-2 border border-[#E5E7EB] px-2.5 py-1 text-sm" title={r.reason || ""}>
                                    {r.q}<span className="text-xs text-[#6B7280]">{r.searches}×</span>
                                    <button type="button" aria-label="Dismiss" onClick={() => act(r.id, "reject", "Dismissed.")} className="text-[#9CA3AF] hover:text-[#CC0033]"><X size={12} /></button>
                                </span>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
