import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { mkGrowthInsights, mkGrowthSettings, mkSaveGrowthSettings, mkMyIp } from "../../lib/api";
import { LineChart } from "./Charts";

/**
 * Marketing → Growth, the detail under "Where buyers come from" (Oct 2026):
 *
 *   StepsTable     visit → viewed a book → cart → checkout → payment → paid,
 *                  per channel — where buyers drop out.
 *   GrowthInsights daily trend, top landing pages, top referring sites, device.
 *   OfficeNetwork  office IPs left out of every count.
 *
 * All of it is cookie-free tallies (backend/growth.py /t/visit, /t/step);
 * nothing identifies a person. Steps and insights only exist from the day
 * this shipped — each section says so rather than showing zeros as data.
 */

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(a / b < 0.01 ? 2 : 0)}%` : "—");

export function StepsTable({ f }) {
    if (!f?.steps_since) {
        return <p className="text-xs text-[#6B7280] mt-3">Shopping steps (viewed a book → cart → checkout → payment) start counting from this release.</p>;
    }
    const cols = ["view_item", "add_to_cart", "checkout", "payment"];
    const L = f.step_labels || {};
    const rows = f.rows.filter((r) => r.visits || r.checkouts || cols.some((c) => r.steps?.[c]));
    const Cell = ({ n, prev }) => (
        <td className="text-right whitespace-nowrap">{n}<span className="text-[10px] text-[#6B7280] ml-1">{pct(n, prev)}</span></td>
    );
    return (
        <div className="mt-5">
            <div className="text-sm font-medium text-[#002B5C]">Where buyers drop out</div>
            <p className="text-[11px] text-[#6B7280]">Each step counted once per visit; the small % is how many of the step before got this far. Since {f.steps_since}.</p>
            <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm" data-testid="mk-growth-steps">
                    <thead><tr className="text-left text-[#4B5563]"><th className="py-1">Channel</th><th className="text-right">{L.visit || "Visited"}</th>
                        {cols.map((c) => <th key={c} className="text-right">{L[c] || c}</th>)}<th className="text-right">{L.paid || "Paid"}</th></tr></thead>
                    <tbody>
                        {[...rows, { channel: "All", visits: f.total.visits, steps: f.total.steps, paid: f.total.paid, _total: true }].map((r) => (
                            <tr key={r.channel} className={`border-t border-[#E5E7EB] ${r._total ? "font-medium" : ""}`}>
                                <td className="py-1">{r.channel}</td>
                                <td className="text-right">{r.visits}</td>
                                {cols.map((c, i) => <Cell key={c} n={r.steps?.[c] || 0} prev={i === 0 ? r.visits : r.steps?.[cols[i - 1]] || 0} />)}
                                <Cell n={r.paid} prev={r.steps?.payment || 0} />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function TopList({ title, items, empty }) {
    const max = Math.max(1, ...(items || []).map((x) => x.n));
    return (
        <div className="border border-[#E5E7EB] bg-white p-3">
            <div className="text-sm font-medium text-[#002B5C] mb-2">{title}</div>
            {!items?.length ? <p className="text-xs text-[#6B7280]">{empty}</p> : (
                <ul className="space-y-1.5">
                    {items.map((x) => (
                        <li key={x.key} className="text-xs">
                            <div className="flex justify-between gap-2"><span className="truncate font-mono" title={x.key}>{x.key}</span><span>{x.n}</span></div>
                            <div className="h-1 bg-[#F3F4F6] mt-0.5"><div className="h-1 bg-[#38bdf8]" style={{ width: `${(x.n / max) * 100}%` }} /></div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export function GrowthInsights({ days }) {
    const [d, setD] = useState(null);
    useEffect(() => {
        mkGrowthInsights(days).then(setD).catch(() => setD(null));
    }, [days]);
    if (!d) return null;
    const span = Math.max(1, Math.round((Date.now() - new Date(`${d.since}T00:00:00Z`).getTime()) / 86400000) + 1);
    const dev = Object.entries(d.device || {}).sort((a, b) => b[1] - a[1]);
    const devTotal = dev.reduce((n, [, v]) => n + v, 0);
    return (
        <div className="mt-6 space-y-4" data-testid="mk-growth-insights">
            <div>
                <div className="text-sm font-medium text-[#002B5C]">Visits and paid orders per day</div>
                <LineChart series={d.daily || {}} keys={["visits", "paid"]} days={Math.min(span, days)} labels={{ visits: "Visits", paid: "Paid orders" }} height={180} />
            </div>
            {!d.dims_since ? (
                <p className="text-xs text-[#6B7280]">Landing pages, referring sites and devices start counting from this release.</p>
            ) : (
                <div className="grid md:grid-cols-3 gap-3">
                    <TopList title="Top landing pages" items={d.landing} empty="No visits yet." />
                    <TopList title="Top referring sites" items={d.referrer} empty="No referring sites yet." />
                    <div className="border border-[#E5E7EB] bg-white p-3">
                        <div className="text-sm font-medium text-[#002B5C] mb-2">Device</div>
                        {!devTotal ? <p className="text-xs text-[#6B7280]">No visits yet.</p> : dev.map(([k, v]) => (
                            <div key={k} className="text-xs mb-1.5">
                                <div className="flex justify-between"><span>{k}</span><span>{v} · {pct(v, devTotal)}</span></div>
                                <div className="h-1 bg-[#F3F4F6] mt-0.5"><div className="h-1 bg-[#002B5C]" style={{ width: `${(v / devTotal) * 100}%` }} /></div>
                            </div>
                        ))}
                        <p className="text-[10px] text-[#6B7280] mt-2">Since {d.dims_since}.</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export function OfficeNetwork() {
    const [ips, setIps] = useState(null);
    const [txt, setTxt] = useState("");
    const load = useCallback(() => mkGrowthSettings().then((s) => { setIps(s.office_ips || []); setTxt((s.office_ips || []).join(", ")); }).catch(() => setIps([])), []);
    useEffect(() => { load(); }, [load]);
    if (ips === null) return null;
    const save = async (value) => {
        try {
            const r = await mkSaveGrowthSettings(value.split(/[\s,;]+/).filter(Boolean));
            setIps(r.office_ips);
            setTxt(r.office_ips.join(", "));
            toast.success(r.office_ips.length ? `${r.office_ips.length} office address(es) excluded from the counts.` : "No office addresses excluded.");
        } catch {
            toast.error("Could not save.");
        }
    };
    const addMine = async () => {
        try {
            const { ip } = await mkMyIp();
            if (!ip) return toast.error("Couldn't read your address.");
            if (!window.confirm(`Exclude ${ip} (the network you're on now) from visit counts?`)) return;
            save([txt, ip].filter(Boolean).join(", "));
        } catch {
            toast.error("Couldn't read your address.");
        }
    };
    return (
        <div className="mt-6 border-t border-[#E5E7EB] pt-4" data-testid="mk-office-network">
            <div className="text-sm font-medium text-[#002B5C]">Leave the office out of the counts</div>
            <p className="text-[11px] text-[#6B7280] mt-0.5 max-w-2xl">
                Visits from these addresses aren't counted. Browsers where a staff account has signed in are skipped automatically,
                and staff accounts' own orders are left out. Addresses are only compared, never stored with a visit.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 items-center">
                <input className="border border-[#E5E7EB] px-2 py-1.5 text-sm flex-1 min-w-[260px] font-mono" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="e.g. 103.21.244.10, 10.0.0.0/24" />
                <button type="button" className="text-xs border border-[#E5E7EB] px-3 py-1.5" onClick={addMine}>Add the network I'm on</button>
                <button type="button" className="text-xs border border-[#002B5C] px-3 py-1.5" onClick={() => save(txt)}>Save</button>
            </div>
        </div>
    );
}
