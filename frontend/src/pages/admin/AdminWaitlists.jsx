import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminListWaitlists, adminDeleteWaitlistEntry, API, formatApiError } from "../../lib/api";
import { canDelete } from "../../lib/rbac";
import { useAuth } from "../../context/AuthContext";
import AdminToolbar from "../../components/AdminToolbar";

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
    const [q, setQ] = useState("");
    const [sort, setSort] = useState("newest");
    const [busyId, setBusyId] = useState("");
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);

    /*
     * Removing a signup is what an unsubscribe request looks like from this
     * side, so it is a real delete with no tombstone. The confirmation names
     * the address because the rows are otherwise near-identical and a misclick
     * on the wrong line is invisible afterwards.
     */
    const removeEntry = async (e) => {
        if (!window.confirm(`Remove ${e.email} from the signup list?\n\nThis cannot be undone.`)) return;
        setBusyId(e.id);
        try {
            await adminDeleteWaitlistEntry(e.id);
            setData((cur) => ({
                ...cur,
                entries: (cur.entries || []).filter((x) => x.id !== e.id),
                // The source counts sit above the table; leaving them stale
                // would show 42 beside a list of 41.
                summary: (cur.summary || []).map((sm) =>
                    sm.source === (e.source || "newsletter")
                        ? { ...sm, count: Math.max(0, sm.count - 1) }
                        : sm,
                ),
            }));
            toast.success("Signup removed.");
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusyId("");
        }
    };

    const entries = useMemo(() => {
        const needle = q.trim().toLowerCase();
        let a = (data.entries || []).filter(
            (e) => !needle || `${e.email || ""} ${e.source || ""}`.toLowerCase().includes(needle),
        );
        const t = (e) => new Date(e.created_at || 0).getTime();
        a = [...a].sort((x, y) => {
            if (sort === "oldest") return t(x) - t(y);
            if (sort === "email") return (x.email || "").localeCompare(y.email || "");
            return t(y) - t(x);
        });
        return a;
    }, [data.entries, q, sort]);

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

            <AdminToolbar
                query={q}
                onQuery={setQ}
                placeholder="Search email…"
                sort={sort}
                onSort={setSort}
                sortOptions={[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                    { value: "email", label: "Email A–Z" },
                ]}
                count={entries.length}
                total={(data.entries || []).length}
            />

            {/* Table */}
            <div className="overflow-x-auto mt-6 border border-[#E5E7EB] bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-[#F5F7FA] text-[10px] font-mono uppercase tracking-widest text-[#4B5563]">
                        <tr>
                            <th className="text-left px-4 py-3">Email</th>
                            <th className="text-left px-4 py-3">Source</th>
                            <th className="text-left px-4 py-3">Joined</th>
                            {mayDelete && <th className="text-right px-4 py-3">Remove</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={mayDelete ? 4 : 3} className="px-4 py-10 text-center text-[#4B5563]">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && entries.length === 0 && (
                            <tr>
                                <td colSpan={mayDelete ? 4 : 3} className="px-4 py-16 text-center text-[#4B5563]">
                                    <Users size={24} strokeWidth={1.5} className="mx-auto text-[#E5E7EB]" />
                                    <div className="mt-2 text-sm">No signups yet.</div>
                                </td>
                            </tr>
                        )}
                        {entries.map((e) => (
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
                                {mayDelete && (
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={() => removeEntry(e)}
                                            disabled={busyId === e.id}
                                            data-testid={`delete-waitlist-${e.id}`}
                                            title="Remove this signup"
                                            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[#CC0033] border-b border-[#CC0033] pb-0.5 hover:text-[#002B5C] hover:border-[#002B5C] disabled:opacity-40"
                                        >
                                            <Trash2 size={13} strokeWidth={1.5} />
                                            {busyId === e.id ? "Removing…" : "Remove"}
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
