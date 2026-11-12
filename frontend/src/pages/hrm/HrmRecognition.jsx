import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Award, Download, Heart, Medal, Megaphone, Rocket, Sparkles, Star, Trophy, Undo2, X } from "lucide-react";
import { recMine, recTeam, recShoutouts, recGive, recSeen, recWithdraw, recLetter, hrmPeople, saveBlob, formatApiError } from "../../lib/api";

/**
 * HRM → Recognition (Nov 2026): appreciation letters, awards and rewards.
 * HR / founders / Directors give them; the employee sees theirs here (and a
 * celebration pop-up on Home the first time); "share with the team" puts a
 * shout-out — name + title only — on everyone's Home. Amounts are shown to
 * the employee and HR only (the server decides: backend/hrm_recognition.py).
 */
export const BADGE = { star: Star, trophy: Trophy, rocket: Rocket, heart: Heart, medal: Medal, sparkles: Sparkles };
export const KIND_STYLE = {
    appreciation: { label: "Appreciation", grad: "linear-gradient(135deg,#0B4A8B 0%,#1E6FB8 100%)", chip: "#DBEAFE", ink: "#1E40AF" },
    award: { label: "Award", grad: "linear-gradient(135deg,#7C3AED 0%,#C026D3 100%)", chip: "#F3E8FF", ink: "#6B21A8" },
    reward: { label: "Reward", grad: "linear-gradient(135deg,#B4750F 0%,#F5B841 100%)", chip: "#FEF3C7", ink: "#92400E" },
};
const TITLES = ["Star of the month", "Above and beyond", "Customer hero", "Team player", "Fresh idea", "Launch hero", "Thank you"];
const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const err = (e) => toast.error(formatApiError(e));
const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

export default function RecognitionTab({ me }) {
    const [mine, setMine] = useState(null);
    const [shout, setShout] = useState(null);
    const [team, setTeam] = useState(null);
    const [tick, setTick] = useState(0);
    const lead = me.hr || me.manager;
    useEffect(() => {
        if (me.me) recMine().then(setMine).catch(() => setMine([]));
        recShoutouts().then(setShout).catch(() => setShout([]));
        if (lead) recTeam().then((r) => setTeam(r.rows)).catch(() => setTeam([]));
    }, [me, lead, tick]);
    return (
        <div className="space-y-6" data-testid="hrm-recognition">
            <Confetti />
            <section className="relative overflow-hidden text-white p-6" style={{ background: "linear-gradient(120deg,#3B0764 0%,#002B5C 55%,#0B4A8B 100%)" }}>
                <Sparkles className="absolute right-6 top-5 text-[#F5B841] opacity-80 ob-twinkle" size={28} aria-hidden="true" />
                <Star className="absolute right-24 bottom-4 text-white/30 ob-twinkle" size={18} style={{ animationDelay: ".6s" }} aria-hidden="true" />
                <div className="text-white/70 text-xs uppercase tracking-[0.2em]">Oakbridge</div>
                <h2 className="font-serif text-3xl sm:text-4xl mt-1">Wall of fame</h2>
                <p className="text-white/80 text-sm mt-1 max-w-xl">Great work deserves to be seen. {me.hr ? "Recognise someone today — it takes a minute and they'll remember it." : "Here's what the team has been celebrated for."}</p>
                {me.me && mine && <div className="mt-4 inline-flex items-center gap-2 bg-white/10 border border-white/20 px-3 py-1.5 text-sm"><Trophy size={16} className="text-[#F5B841]" />You have {mine.length} recognition{mine.length === 1 ? "" : "s"}</div>}
            </section>

            {me.hr && <Composer onGiven={() => setTick(tick + 1)} />}

            {me.me && (
                <section>
                    <h3 className="font-serif text-2xl text-[#002B5C] mb-3">Your recognitions</h3>
                    {!mine ? <p className="text-sm text-[#6B7280]">Loading…</p> : mine.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{mine.map((r) => <RecCard key={r.id} r={r} mine />)}</div>
                    ) : (
                        <div className="bg-white border border-dashed border-[#CBD5E1] p-8 text-center text-sm text-[#4B5563]">
                            <Medal className="mx-auto text-[#CBD5E1] mb-2" size={36} />Nothing here yet — your first one is on its way. Keep doing great work!
                        </div>
                    )}
                </section>
            )}

            <section>
                <h3 className="font-serif text-2xl text-[#002B5C] mb-3 flex items-center gap-2"><Megaphone size={22} className="text-[#B4750F]" />Team shout-outs</h3>
                {!shout ? <p className="text-sm text-[#6B7280]">Loading…</p> : shout.length ? <ShoutStrip rows={shout} /> : <p className="text-sm text-[#6B7280]">No shout-outs in the last 3 months.</p>}
            </section>

            {lead && team && (
                <section className="bg-white border border-[#E5E7EB]">
                    <h3 className="px-4 py-3 border-b border-[#F3F4F6] font-medium text-[#002B5C]">{me.hr ? "Everyone's recognitions" : "Your team's recognitions"}</h3>
                    {!team.length ? <p className="p-4 text-sm text-[#6B7280]">None yet.</p> : (
                        <ul className="divide-y divide-[#F3F4F6]">{team.map((r) => {
                            const I = BADGE[r.badge] || Star;
                            const k = KIND_STYLE[r.kind];
                            return (
                                <li key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                                    <span className="w-9 h-9 grid place-items-center text-white shrink-0" style={{ background: k.grad }}><I size={18} /></span>
                                    <span className="flex-1 min-w-[180px]"><b className="text-[#002B5C]">{r.name}</b> · {r.title}
                                        <span className="block text-xs text-[#6B7280]">{k.label} · {fmt(r.date)} · by {r.by_name}{r.shout_out ? " · shared with team" : ""}</span></span>
                                    {r.amount ? <span className="text-xs px-2 py-0.5" style={{ background: k.chip, color: k.ink }}>{inr(r.amount)}</span> : null}
                                    {me.hr && <button type="button" onClick={async () => { if (!window.confirm(`Withdraw “${r.title}” for ${r.name}? It disappears from their screen.`)) return; try { await recWithdraw(r.id); toast.success("Withdrawn."); setTick(tick + 1); } catch (e) { err(e); } }}
                                        className="text-xs text-[#6B7280] underline inline-flex items-center gap-1"><Undo2 size={12} />Withdraw</button>}
                                </li>
                            );
                        })}</ul>
                    )}
                </section>
            )}
        </div>
    );
}

/* One recognition as a card the employee is proud to look at. */
export function RecCard({ r, mine = false, big = false }) {
    const I = BADGE[r.badge] || Star;
    const k = KIND_STYLE[r.kind] || KIND_STYLE.appreciation;
    const dl = async () => { try { saveBlob(await recLetter(r.id), `Appreciation - ${r.title}.pdf`); } catch (e) { err(e); } };
    return (
        <article className="group bg-white border border-[#E5E7EB] overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl" data-testid="hrm-rec-card">
            <div className={`relative text-white ${big ? "p-6" : "p-4"}`} style={{ background: k.grad }}>
                <span className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/10" aria-hidden="true" />
                <div className="flex items-center gap-3 relative">
                    <span className={`${big ? "w-14 h-14" : "w-11 h-11"} grid place-items-center bg-white/15 border border-white/30 rounded-full transition-transform duration-500 group-hover:rotate-12 group-hover:scale-110`}><I size={big ? 28 : 22} /></span>
                    <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/80">{k.label}</div>
                        <div className={`font-serif ${big ? "text-2xl" : "text-xl"} leading-tight`}>{r.title}</div>
                    </div>
                </div>
            </div>
            <div className="p-4 space-y-3">
                {r.message && <p className="text-sm text-[#374151] leading-relaxed border-l-4 border-[#F5B841] pl-3 italic">“{r.message}”</p>}
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7280]">
                    <span>{fmt(r.date)} · from {r.by_name}</span>
                    {r.amount ? <span className="ml-auto px-2 py-0.5 font-medium" style={{ background: k.chip, color: k.ink }}>Reward {inr(r.amount)}</span> : null}
                </div>
                {mine && <button type="button" onClick={dl} className="inline-flex items-center gap-1.5 text-sm text-[#002B5C] border border-[#002B5C] px-3 py-1.5 hover:bg-[#002B5C] hover:text-white transition-colors"><Download size={14} />Letter (PDF)</button>}
            </div>
        </article>
    );
}

export function ShoutStrip({ rows }) {
    return (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x" data-testid="hrm-shoutouts">
            {rows.map((r) => {
                const I = BADGE[r.badge] || Star;
                const k = KIND_STYLE[r.kind] || KIND_STYLE.appreciation;
                return (
                    <div key={r.id} className="snap-start shrink-0 w-60 bg-white border border-[#E5E7EB] p-4 transition-transform hover:-translate-y-0.5">
                        <div className="flex items-center gap-2">
                            <span className="w-9 h-9 grid place-items-center text-white rounded-full" style={{ background: k.grad }}><I size={17} /></span>
                            <div className="min-w-0"><div className="font-medium text-[#002B5C] truncate">{r.name}</div><div className="text-[11px] text-[#6B7280] truncate">{r.department}</div></div>
                        </div>
                        <div className="mt-3 font-serif text-lg text-[#002B5C] leading-tight">{r.title}</div>
                        <div className="text-xs text-[#6B7280] mt-1">{k.label} · {fmt(r.date)}</div>
                    </div>
                );
            })}
        </div>
    );
}

/* ---------------------------------------------------------- HR composer --- */
function Composer({ onGiven }) {
    const [people, setPeople] = useState([]);
    const blank = { emp_id: "", kind: "appreciation", title: "", message: "", badge: "star", amount: "", shout_out: true };
    const [f, setF] = useState(blank);
    const [q, setQ] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => { hrmPeople().then(setPeople).catch(() => {}); }, []);
    const set = (k, v) => setF({ ...f, [k]: v });
    const who = people.find((p) => p.id === f.emp_id);
    const list = useMemo(() => people.filter((p) => !q || `${p.name} ${p.department || ""} ${p.emp_code || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8), [people, q]);
    const ready = f.emp_id && f.title.trim().length >= 3 && f.message.trim().length >= 20;
    const give = async () => {
        if (!window.confirm(`Give “${f.title}” to ${who?.name}?${f.shout_out ? "\n\nIt will also appear as a shout-out on everyone's Home." : ""}`)) return;
        setBusy(true);
        try {
            await recGive({ ...f, amount: f.kind === "reward" && f.amount ? Number(f.amount) : null });
            toast.success(`🎉 Sent to ${who?.name}!`); setF(blank); setQ(""); onGiven();
        } catch (e) { err(e); } finally { setBusy(false); }
    };
    return (
        <section className="bg-white border border-[#E5E7EB] p-5 grid gap-6 lg:grid-cols-[1fr_320px]" data-testid="hrm-rec-composer">
            <div className="space-y-4">
                <h3 className="font-serif text-2xl text-[#002B5C]">Recognise someone</h3>
                <div>
                    <div className="text-sm font-medium mb-1">1. Who?</div>
                    {who ? (
                        <div className="inline-flex items-center gap-2 bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-1.5 text-sm">{who.name}<button type="button" onClick={() => set("emp_id", "")} aria-label="Change person"><X size={14} /></button></div>
                    ) : (
                        <>
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or team…" className="w-full border border-[#E5E7EB] px-3 py-2 text-sm" />
                            {q && <div className="border border-t-0 border-[#E5E7EB] max-h-48 overflow-auto">{list.map((p) => (
                                <button key={p.id} type="button" onClick={() => { set("emp_id", p.id); setQ(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F5F7FA]">{p.name} <span className="text-[#6B7280] text-xs">{p.department}</span></button>))}</div>}
                        </>
                    )}
                </div>
                <div>
                    <div className="text-sm font-medium mb-1">2. What kind?</div>
                    <div className="flex flex-wrap gap-2">{Object.entries(KIND_STYLE).map(([k, s]) => (
                        <button key={k} type="button" onClick={() => set("kind", k)} aria-pressed={f.kind === k}
                            className="px-4 py-2 text-sm border transition-all" style={f.kind === k ? { background: s.grad, color: "#fff", borderColor: "transparent" } : { borderColor: "#E5E7EB" }}>{s.label}{k === "reward" ? " (with ₹)" : ""}</button>))}</div>
                </div>
                <div>
                    <div className="text-sm font-medium mb-1">3. Badge & title</div>
                    <div className="flex flex-wrap gap-2 mb-2">{Object.entries(BADGE).map(([k, I]) => (
                        <button key={k} type="button" onClick={() => set("badge", k)} aria-label={k} aria-pressed={f.badge === k}
                            className={`w-10 h-10 grid place-items-center border rounded-full transition-transform hover:scale-110 ${f.badge === k ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#E5E7EB] text-[#4B5563]"}`}><I size={18} /></button>))}</div>
                    <input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="e.g. Star of the month" className="w-full border border-[#E5E7EB] px-3 py-2 text-sm" />
                    <div className="flex flex-wrap gap-1.5 mt-2">{TITLES.map((t) => <button key={t} type="button" onClick={() => set("title", t)} className="text-xs px-2 py-1 bg-[#F5F7FA] hover:bg-[#E5E7EB]">{t}</button>)}</div>
                </div>
                <label className="block"><span className="text-sm font-medium">4. Your words</span>
                    <textarea rows={4} value={f.message} onChange={(e) => set("message", e.target.value)} maxLength={3000} className="mt-1 w-full border border-[#E5E7EB] px-3 py-2 text-sm"
                        placeholder="Be specific — what did they do and why did it matter? This goes on their letter." />
                    <span className={`text-xs ${f.message.trim().length >= 20 ? "text-[#15803D]" : "text-[#6B7280]"}`}>{f.message.trim().length >= 20 ? "✓ Looks good" : `${20 - f.message.trim().length} more characters`}</span></label>
                {f.kind === "reward" && (
                    <label className="block max-w-xs"><span className="text-sm font-medium">Reward amount (₹, optional)</span>
                        <input type="number" min={1} step={1} value={f.amount} onChange={(e) => set("amount", e.target.value)} className="mt-1 w-full border border-[#E5E7EB] px-3 py-2 text-sm" />
                        <span className="text-xs text-[#6B7280]">Only they and HR see the amount — never the team.</span></label>
                )}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.shout_out} onChange={(e) => set("shout_out", e.target.checked)} />Share a shout-out with the team (name + title only)</label>
                <button type="button" disabled={!ready || busy} onClick={give} className="inline-flex items-center gap-2 px-6 py-2.5 text-white disabled:opacity-50 transition-transform hover:scale-[1.02]" style={{ background: KIND_STYLE[f.kind].grad }}>
                    <Award size={16} />{busy ? "Sending…" : "Give recognition"}</button>
            </div>
            <div>
                <div className="text-xs uppercase tracking-wider text-[#6B7280] mb-2">Live preview — what they'll see</div>
                <RecCard big r={{ id: "preview", kind: f.kind, badge: f.badge, title: f.title || "Your title here", message: f.message || "Your words of appreciation…",
                    date: new Date().toISOString().slice(0, 10), by_name: "You", amount: f.kind === "reward" && f.amount ? Number(f.amount) : null }} />
            </div>
        </section>
    );
}

/* ------------------------------------------- first-time celebration (Home) --- */
export function Celebration({ enabled }) {
    const [r, setR] = useState(null);
    useEffect(() => { if (enabled) recMine().then((rows) => setR(rows.find((x) => !x.seen_at) || null)).catch(() => {}); }, [enabled]);
    if (!r) return null;
    const close = () => { recSeen(r.id).catch(() => {}); setR(null); };
    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="You've been recognised" data-testid="hrm-celebration">
            <Confetti burst />
            <div className="relative w-full max-w-md ob-pop">
                <button type="button" onClick={close} className="absolute -top-3 -right-3 z-10 w-8 h-8 grid place-items-center bg-white rounded-full shadow" aria-label="Close"><X size={16} /></button>
                <div className="text-center text-white font-serif text-2xl mb-3 drop-shadow">🎉 You've been recognised!</div>
                <RecCard r={r} mine big />
                <button type="button" onClick={close} className="mt-3 w-full bg-white text-[#002B5C] py-2.5 font-medium">Thank you!</button>
            </div>
        </div>
    );
}

/* CSS-only sparkle / confetti — no library; respects reduced motion. */
function Confetti({ burst = false }) {
    const bits = burst ? Array.from({ length: 36 }, (_, i) => i) : [];
    const colours = ["#F5B841", "#7C3AED", "#1E6FB8", "#0E9F6E", "#E11D48", "#FFFFFF"];
    return (
        <>
            <style>{`
                @keyframes ob-fall { 0% { transform: translateY(-10vh) rotate(0); opacity: 1 } 100% { transform: translateY(105vh) rotate(720deg); opacity: .9 } }
                @keyframes ob-tw { 0%,100% { opacity: .35; transform: scale(.9) } 50% { opacity: 1; transform: scale(1.15) } }
                @keyframes ob-pop-k { 0% { transform: scale(.85); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
                .ob-twinkle { animation: ob-tw 2.2s ease-in-out infinite }
                .ob-pop { animation: ob-pop-k .35s cubic-bezier(.2,.9,.3,1.3) both }
                @media (prefers-reduced-motion: reduce) { .ob-twinkle, .ob-pop, .ob-bit { animation: none !important } .ob-bit { display: none } }
            `}</style>
            {bits.map((i) => (
                <span key={i} className="ob-bit fixed top-0 pointer-events-none z-50" aria-hidden="true"
                    style={{ left: `${(i * 37) % 100}%`, width: 8, height: 12, background: colours[i % colours.length],
                        animation: `ob-fall ${2.2 + (i % 5) * 0.35}s linear ${(i % 9) * 0.12}s 1 both` }} />
            ))}
        </>
    );
}
