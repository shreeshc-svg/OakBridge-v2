import React, { useEffect, useMemo, useState } from "react";
import {
    adminListDeskCopies,
    adminUpdateDeskCopy,
    formatApiError,
} from "../../lib/api";
import { toast } from "sonner";
import AdminToolbar from "../../components/AdminToolbar";

const STATUSES = ["pending", "approved", "shipped", "rejected"];

export default function AdminDeskCopies() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState("all");
    const [sort, setSort] = useState("newest");

    const load = () => {
        setLoading(true);
        adminListDeskCopies()
            .then(setItems)
            .finally(() => setLoading(false));
    };
    useEffect(() => {
        load();
    }, []);

    const onStatus = async (id, status) => {
        try {
            await adminUpdateDeskCopy(id, status);
            toast.success("Request updated.");
            setItems((prev) =>
                prev.map((r) => (r.id === id ? { ...r, status } : r)),
            );
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const view = useMemo(() => {
        const needle = q.trim().toLowerCase();
        let a = items.filter(
            (r) =>
                !needle ||
                `${r.name || ""} ${r.email || ""} ${r.institution || ""} ${r.book_title || ""} ${r.role || ""} ${r.course || ""}`
                    .toLowerCase()
                    .includes(needle),
        );
        if (status !== "all") a = a.filter((r) => r.status === status);
        const t = (r) => new Date(r.created_at || 0).getTime();
        a = [...a].sort((x, y) => (sort === "oldest" ? t(x) - t(y) : t(y) - t(x)));
        return a;
    }, [items, q, status, sort]);

    return (
        <div data-testid="admin-desk-copies-page">
            <div className="overline">Educator Leads</div>
            <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                Desk Copy Requests ({items.length})
            </h1>
            <AdminToolbar
                query={q}
                onQuery={setQ}
                placeholder="Search name, institution or book…"
                filter={status}
                onFilter={setStatus}
                filterOptions={[
                    { value: "all", label: "All statuses" },
                    ...STATUSES.map((s) => ({ value: s, label: s })),
                ]}
                sort={sort}
                onSort={setSort}
                sortOptions={[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                ]}
                count={view.length}
                total={items.length}
            />

            <div className="mt-6 space-y-4">
                {loading && (
                    <p className="font-mono text-xs text-[#4B5563]">Loading…</p>
                )}
                {!loading && view.length === 0 && (
                    <div className="border border-dashed border-[#E5E7EB] py-16 text-center">
                        <h3 className="font-serif text-2xl text-[#002B5C]">
                            {items.length === 0 ? "No requests yet." : "No requests match your search."}
                        </h3>
                        <p className="text-sm text-[#4B5563] mt-2">
                            When educators request desk copies, they'll appear here.
                        </p>
                    </div>
                )}
                {view.map((r) => (
                    <div
                        key={r.id}
                        data-testid={`admin-desk-copy-${r.id}`}
                        className="bg-white border border-[#E5E7EB] p-6"
                    >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <div className="overline !text-[10px]">
                                    {r.role} · {new Date(r.created_at).toLocaleDateString("en-IN")}
                                </div>
                                <h3 className="font-serif text-xl mt-2 text-[#002B5C]">
                                    {r.name} <span className="text-[#4B5563]">·</span>{" "}
                                    <span className="text-[#4B5563]">{r.institution}</span>
                                </h3>
                                <div className="text-sm text-[#4B5563] mt-1">
                                    {r.email}
                                </div>
                                <div className="font-mono text-xs text-[#CC0033] mt-3">
                                    Requesting: {r.book_title}
                                </div>
                                {r.course && (
                                    <div className="text-xs text-[#4B5563] mt-1">
                                        Course: {r.course} · {r.enrolment} students
                                    </div>
                                )}
                                {r.message && (
                                    <p className="mt-3 text-sm text-[#002B5C] leading-relaxed max-w-2xl">
                                        "{r.message}"
                                    </p>
                                )}
                            </div>
                            <select
                                value={r.status}
                                onChange={(e) => onStatus(r.id, e.target.value)}
                                data-testid={`desk-copy-status-${r.id}`}
                                className="border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                            >
                                {STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
