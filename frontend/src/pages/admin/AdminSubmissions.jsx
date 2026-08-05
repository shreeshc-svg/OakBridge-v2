import React, { useEffect, useMemo, useState } from "react";
import {
    adminListSubmissions,
    adminUpdateSubmission,
    adminDeleteSubmission,
    formatApiError,
} from "../../lib/api";
import { toast } from "sonner";
import AdminToolbar from "../../components/AdminToolbar";
import { Trash2 } from "lucide-react";
import ExportButton from "../../components/admin/ExportButton";

const STATUSES = ["received", "reviewing", "shortlisted", "declined", "accepted"];

const STATUS_COLORS = {
    received: "bg-[#F5F7FA] text-[#002B5C]",
    reviewing: "bg-[#F59E0B]/20 text-[#002B5C]",
    shortlisted: "bg-[#002B5C] text-[#FFFFFF]",
    declined: "bg-[#E5E7EB] text-[#4B5563]",
    accepted: "bg-[#CC0033] text-white",
};

export default function AdminSubmissions() {
    const [items, setItems] = useState([]);
    const [filter, setFilter] = useState("all");
    const [q, setQ] = useState("");
    const [sort, setSort] = useState("newest");
    const [loading, setLoading] = useState(true);

    const load = () => {
        setLoading(true);
        adminListSubmissions()
            .then(setItems)
            .finally(() => setLoading(false));
    };
    useEffect(() => {
        load();
    }, []);

    const removeSubmission = async (sub) => {
        if (
            !window.confirm(
                `Permanently delete the submission "${sub.working_title}" from ${sub.name}?\n\nThis cannot be undone.`,
            )
        )
            return;
        try {
            await adminDeleteSubmission(sub.id);
            toast.success("Submission removed.");
            setItems((prev) => prev.filter((x) => x.id !== sub.id));
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };

    const onStatus = async (id, status) => {
        try {
            await adminUpdateSubmission(id, status);
            toast.success("Submission updated.");
            setItems((prev) =>
                prev.map((s) => (s.id === id ? { ...s, status } : s)),
            );
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        let a = items.filter(
            (s) =>
                !needle ||
                `${s.name || ""} ${s.working_title || ""} ${s.email || ""} ${s.affiliation || ""} ${s.category || ""}`
                    .toLowerCase()
                    .includes(needle),
        );
        if (filter !== "all") a = a.filter((s) => s.status === filter);
        const t = (s) => new Date(s.created_at || 0).getTime();
        a = [...a].sort((x, y) => (sort === "oldest" ? t(x) - t(y) : t(y) - t(x)));
        return a;
    }, [items, q, filter, sort]);

    return (
        <div data-testid="admin-submissions-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Editorial Intake</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                        Manuscript Submissions ({items.length})
                    </h1>
                </div>
                <ExportButton path="/admin/submissions/export.csv" count={items.length} />
            </div>
            <AdminToolbar
                query={q}
                onQuery={setQ}
                placeholder="Search title, author, email or category…"
                filter={filter}
                onFilter={setFilter}
                filterOptions={[
                    { value: "all", label: "All submissions" },
                    ...STATUSES.map((s) => ({ value: s, label: s })),
                ]}
                sort={sort}
                onSort={setSort}
                sortOptions={[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                ]}
                count={filtered.length}
                total={items.length}
            />

            <div className="mt-8 space-y-4">
                {loading && (
                    <p className="font-mono text-xs text-[#4B5563]">Loading…</p>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="border border-dashed border-[#E5E7EB] py-16 text-center">
                        <h3 className="font-serif text-2xl text-[#002B5C]">
                            No submissions {filter !== "all" ? `in '${filter}'` : "yet"}.
                        </h3>
                    </div>
                )}
                {filtered.map((s) => (
                    <details
                        key={s.id}
                        data-testid={`submission-${s.id}`}
                        className="bg-white border border-[#E5E7EB]"
                    >
                        <summary className="flex flex-wrap items-center gap-4 p-5 cursor-pointer list-none">
                            <div className="flex-1 min-w-[250px]">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 ${STATUS_COLORS[s.status] || ""}`}
                                    >
                                        {s.status}
                                    </span>
                                    <span className="text-xs text-[#4B5563]">
                                        {new Date(s.created_at).toLocaleDateString("en-IN")}
                                    </span>
                                </div>
                                <h3 className="font-serif text-xl text-[#002B5C] mt-2">
                                    {s.working_title}
                                </h3>
                                <p className="text-sm text-[#4B5563] mt-1">
                                    {s.name} · {s.affiliation || s.email} · {s.category}
                                </p>
                            </div>
                            <select
                                value={s.status}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => onStatus(s.id, e.target.value)}
                                data-testid={`submission-status-${s.id}`}
                                className="border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                            >
                                {STATUSES.map((st) => (
                                    <option key={st} value={st}>
                                        {st}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    removeSubmission(s);
                                }}
                                data-testid={`delete-submission-${s.id}`}
                                title="Delete this submission"
                                className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium border border-[#CC0033] text-[#CC0033] px-3 py-2 hover:bg-[#CC0033]/5 whitespace-nowrap"
                            >
                                <Trash2 size={12} strokeWidth={1.75} />
                                Delete
                            </button>
                        </summary>
                        <div className="px-5 pb-5 pt-1 border-t border-[#E5E7EB]">
                            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                                <div>
                                    <dt className="overline !text-[10px]">Email</dt>
                                    <dd className="text-[#002B5C]">{s.email}</dd>
                                </div>
                                <div>
                                    <dt className="overline !text-[10px]">Phone</dt>
                                    <dd className="text-[#002B5C]">{s.phone || "—"}</dd>
                                </div>
                                <div>
                                    <dt className="overline !text-[10px]">Word count</dt>
                                    <dd className="text-[#002B5C]">{s.word_count || "—"}</dd>
                                </div>
                                <div>
                                    <dt className="overline !text-[10px]">Category</dt>
                                    <dd className="text-[#002B5C]">{s.category}</dd>
                                </div>
                            </dl>
                            <div className="mt-4">
                                <div className="overline !text-[10px]">Synopsis</div>
                                <p className="mt-1 text-sm text-[#4B5563] leading-relaxed whitespace-pre-wrap">
                                    {s.synopsis}
                                </p>
                            </div>
                            {s.bio && (
                                <div className="mt-4">
                                    <div className="overline !text-[10px]">Author bio</div>
                                    <p className="mt-1 text-sm text-[#4B5563] leading-relaxed whitespace-pre-wrap">
                                        {s.bio}
                                    </p>
                                </div>
                            )}
                        </div>
                    </details>
                ))}
            </div>
        </div>
    );
}
