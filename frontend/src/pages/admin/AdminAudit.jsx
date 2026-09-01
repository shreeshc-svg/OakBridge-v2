import React, { useCallback, useEffect, useState } from "react";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { adminAudit } from "../../lib/api";

/**
 * System audit and activity logs.
 *
 * Superadmin only, and the endpoint enforces that independently — this page
 * being unreachable in the sidebar is a convenience, not the control.
 *
 * The rows come from two places and are merged server-side: sign-ins, sign-outs
 * and deletions recorded from today onward, plus the payment history that has
 * been accumulating in its own collection since long before this screen
 * existed. That second source is why the table is not empty on day one.
 */

const PERIODS = [
    { key: "all", label: "All Time" },
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
];

/* Colour carries meaning, not decoration: a failed sign-in should be findable
   by scanning, and a deletion should not look like a routine login. */
const TONE = {
    LOGIN: "bg-[#3D9970]/10 text-[#0A7D55] border-[#0A7D55]/30",
    REGISTER: "bg-[#3D9970]/10 text-[#0A7D55] border-[#0A7D55]/30",
    LOGOUT: "bg-[#F5F7FA] text-[#4B5563] border-[#E5E7EB]",
    LOGIN_FAILED: "bg-[#CC0033]/10 text-[#CC0033] border-[#CC0033]/30",
    USER_DELETED: "bg-[#CC0033]/10 text-[#CC0033] border-[#CC0033]/30",
    SUBMISSION_DELETED: "bg-[#CC0033]/10 text-[#CC0033] border-[#CC0033]/30",
    SPAM_PURGED: "bg-[#F59E0B]/10 text-[#854F0B] border-[#F59E0B]/40",
    AUDIT_PURGED: "bg-[#F59E0B]/10 text-[#854F0B] border-[#F59E0B]/40",
};
const toneFor = (a) => TONE[a] || "bg-[#002B5C]/[0.06] text-[#002B5C] border-[#002B5C]/20";

/* Written out rather than toLocaleString(): the log is read alongside Razorpay
   and the eReader, and "1 Sept 2026, 02:54:17 pm" is the format those use. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "—";
    const p = (n) => String(n).padStart(2, "0");
    let h = d.getHours();
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(h)}:${p(d.getMinutes())}:${p(d.getSeconds())} ${ap}`;
}

export default function AdminAudit() {
    const [data, setData] = useState(null);
    const [period, setPeriod] = useState("all");
    const [action, setAction] = useState("");
    const [page, setPage] = useState(1);
    const [err, setErr] = useState("");

    const load = useCallback(() => {
        setErr("");
        adminAudit({ period, page, action })
            .then(setData)
            .catch((e) => setErr(e?.response?.status === 403
                ? "This log is restricted to superadmin accounts."
                : "Could not load the audit log."));
    }, [period, page, action]);

    useEffect(load, [load]);

    // Changing a filter while on page 6 would otherwise ask for a page that no
    // longer exists and render an empty table over a non-empty result.
    const setFilter = (fn) => { fn(); setPage(1); };

    const items = data?.items || [];

    return (
        <div data-testid="admin-audit-page">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="overline">Security</div>
                    <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">
                        System Audit &amp; Activity Logs
                    </h1>
                    <p className="text-sm text-[#4B5563] mt-2 max-w-2xl">
                        Sign-ins, deletions and transactions. Superadmin only — these rows carry
                        customer email addresses.
                    </p>
                </div>
                <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#4B5563] mt-2">
                    <Shield size={13} strokeWidth={1.5} className="text-[#0A7D55]" />
                    Append only
                </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 border-b border-[#E5E7EB] pb-4">
                <div className="inline-flex border border-[#E5E7EB] bg-white">
                    {PERIODS.map((p, i) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => setFilter(() => setPeriod(p.key))}
                            aria-pressed={period === p.key}
                            data-testid={`audit-period-${p.key}`}
                            className={`text-xs px-3 h-9 whitespace-nowrap ${i > 0 ? "border-l border-[#E5E7EB]" : ""} ${
                                period === p.key
                                    ? "bg-[#002B5C] text-white font-semibold"
                                    : "text-[#4B5563] hover:bg-[#F5F7FA]"
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Built from the actions actually present, so it can never offer
                    a filter that returns nothing. */}
                <select
                    value={action}
                    onChange={(e) => setFilter(() => setAction(e.target.value))}
                    aria-label="Filter by action"
                    data-testid="audit-action-filter"
                    className="bg-white border border-[#E5E7EB] text-sm px-3 h-9 outline-none focus:border-[#002B5C]"
                >
                    <option value="">All actions</option>
                    {(data?.actions || []).map((a) => (
                        <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
                    ))}
                </select>

                {data && (
                    <span className="font-mono text-[11px] text-[#4B5563]">
                        {data.capped ? "showing the most recent " : ""}
                        {data.total} event{data.total === 1 ? "" : "s"}
                    </span>
                )}
            </div>

            {err && (
                <div data-testid="audit-error" className="mt-6 border border-[#CC0033]/30 bg-[#CC0033]/[0.04] px-4 py-3 text-sm text-[#CC0033]">
                    {err}
                </div>
            )}

            {!err && (
                <div className="mt-6 border border-[#E5E7EB] bg-white overflow-x-auto">
                    <table className="w-full text-sm" data-testid="audit-table">
                        <thead>
                            <tr className="border-b border-[#E5E7EB] bg-[#F5F7FA]">
                                {["Timestamp", "User email", "Action type", "Meta details"].map((h) => (
                                    <th key={h} className="text-left font-mono text-[10px] uppercase tracking-widest text-[#4B5563] px-4 py-3 whitespace-nowrap">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((r) => (
                                <tr key={r.id} className="border-b border-[#E5E7EB] last:border-0 align-top">
                                    <td className="px-4 py-3 font-mono text-xs text-[#4B5563] whitespace-nowrap">
                                        {stamp(r.at)}
                                    </td>
                                    <td className="px-4 py-3 text-[#002B5C] break-all">
                                        {r.email || <span className="text-[#9CA3AF]">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-block border font-mono text-[10px] uppercase tracking-wider px-2 py-1 whitespace-nowrap ${toneFor(r.action)}`}>
                                            {r.action}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[11px] text-[#4B5563] break-all">
                                        {r.meta && Object.keys(r.meta).length
                                            ? JSON.stringify(r.meta)
                                            : <span className="text-[#9CA3AF]">—</span>}
                                    </td>
                                </tr>
                            ))}
                            {!items.length && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-[#4B5563]">
                                        {data
                                            ? "Nothing recorded in this period."
                                            : "Loading…"}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {data && data.pages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        data-testid="audit-prev"
                        className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] bg-white px-3 h-9 disabled:opacity-40"
                    >
                        <ChevronLeft size={14} strokeWidth={1.5} /> Previous
                    </button>
                    <span className="font-mono text-[11px] text-[#4B5563]">
                        Page {data.page} of {data.pages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                        disabled={page >= data.pages}
                        data-testid="audit-next"
                        className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] bg-white px-3 h-9 disabled:opacity-40"
                    >
                        Next <ChevronRight size={14} strokeWidth={1.5} />
                    </button>
                </div>
            )}
        </div>
    );
}
