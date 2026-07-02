import React, { useCallback, useEffect, useState } from "react";
import { Download, Users } from "lucide-react";
import { toast } from "sonner";
import { adminListWaitlists, API, formatApiError } from "../../lib/api";

const PRESETS = [
    { key: "", label: "All signups" },
    { key: "digital-solutions-waitlist", label: "Digital Solutions" },
    { key: "academy-waitlist", label: "Academy" },
    { key: "newsletter", label: "Newsletter" },
];

function fmt(d) {
    if (!d) return "—";
    try {
        return new Date(d).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return d;
    }
}

export default function AdminWaitlists() {
    const [filter, setFilter] = useState("");
    const [data, setData] = useState({ summary: [], entries: [] });
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await adminListWaitlists(filter || undefined);
            setData(res);
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => {
        load();
    }, [load]);

    const downloadCsv = () => {
        const token = localStorage.getItem("oakbridge_token");
        const q = filter ? `?source=${encodeURIComponent(filter)}` : "";
        // Use fetch so we can attach auth header, then trigger download from blob
        fetch(`${API}/admin/waitlists/export.csv${q}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => {
                if (!r.ok) throw new Error("Export failed");
                return r.blob();
            })
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `oakbridge-waitlist-${filter || "all"}.csv`;
                a.click();
                URL.revokeObjectURL(url);
            })
            .catch((err) => toast.error(err.message || "Export failed"));
    };

    return (
        <div data-testid="admin-waitlists">
            <div className="flex items-end justify-between flex-wrap gap-4">
                <div>
                    <div className="overline">Marketing</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C] leading-none">
                        Waitlists & signups
                    </h1>
                    <p className="mt-3 text-sm text-[#4B5563] max-w-xl">
                        Everyone who joined an Oakbridge waitlist or newsletter — segment by source and export to CSV for follow-up campaigns.
                    </p>
                </div>
                <button
                    onClick={downloadCsv}
                    data-testid="admin-waitlists-export"
                    className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-5 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                >
                    <Download size={14} strokeWidth={1.5} />
                    Export CSV ({data.entries.length})
                </button>
            </div>

            {/* Summary chips */}
            <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
                {PRESETS.map((p) => {
                    const isActive = filter === p.key;
                    const count =
                        p.key === ""
                            ? data.summary.reduce((s, x) => s + x.count, 0)
                            : data.summary.find((s) => s.source === p.key)?.count || 0;
                    return (
                        <button
                            key={p.key || "all"}
                            onClick={() => setFilter(p.key)}
                            data-testid={`waitlist-filter-${p.key || "all"}`}
                            className={`p-5 text-left border transition-colors ${isActive ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#E5E7EB] bg-white hover:border-[#002B5C]"}`}
                        >
                            <div className={`overline ${isActive ? "!text-[#F59E0B]" : ""}`}>{p.label}</div>
                            <div className={`font-serif text-3xl mt-2 ${isActive ? "text-white" : "text-[#002B5C]"}`}>
                                {count}
                            </div>
                            <div className={`text-xs mt-1 ${isActive ? "text-white/60" : "text-[#4B5563]"}`}>
                                signups
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Table */}
            <div className="mt-12 overflow-hidden border border-[#E5E7EB] bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-[#F5F7FA] text-[10px] font-mono uppercase tracking-widest text-[#4B5563]">
                        <tr>
                            <th className="text-left px-4 py-3">Email</th>
                            <th className="text-left px-4 py-3">Source</th>
                            <th className="text-left px-4 py-3">Joined</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={3} className="px-4 py-10 text-center text-[#4B5563]">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && data.entries.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-4 py-16 text-center text-[#4B5563]">
                                    <Users size={24} strokeWidth={1.5} className="mx-auto text-[#E5E7EB]" />
                                    <div className="mt-2 text-sm">No signups yet.</div>
                                </td>
                            </tr>
                        )}
                        {data.entries.map((e) => (
                            <tr
                                key={e.id}
                                data-testid={`waitlist-row-${e.id}`}
                                className="border-t border-[#E5E7EB] hover:bg-[#F5F7FA]/40"
                            >
                                <td className="px-4 py-3 text-[#002B5C] font-medium">
                                    {e.email}
                                </td>
                                <td className="px-4 py-3 text-[#4B5563]">
                                    <span className="font-mono text-xs uppercase tracking-widest border border-[#E5E7EB] px-2 py-1">
                                        {e.source || "newsletter"}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-[#4B5563] text-xs">
                                    {fmt(e.created_at)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
