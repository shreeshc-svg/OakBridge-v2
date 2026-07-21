import React, { useEffect, useMemo, useState } from "react";
import { adminListUsers } from "../../lib/api";
import AdminToolbar from "../../components/AdminToolbar";

export default function AdminUsers() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [role, setRole] = useState("all");
    const [sort, setSort] = useState("newest");

    useEffect(() => {
        adminListUsers()
            .then(setUsers)
            .finally(() => setLoading(false));
    }, []);

    const view = useMemo(() => {
        const needle = q.trim().toLowerCase();
        let a = users.filter(
            (u) =>
                !needle ||
                `${u.name || ""} ${u.email || ""} ${u.role || ""}`.toLowerCase().includes(needle),
        );
        if (role !== "all") a = a.filter((u) => u.role === role);
        const t = (u) => new Date(u.created_at || 0).getTime();
        a = [...a].sort((x, y) => {
            if (sort === "oldest") return t(x) - t(y);
            if (sort === "name") return (x.name || "").localeCompare(y.name || "");
            if (sort === "role") return (x.role || "").localeCompare(y.role || "");
            return t(y) - t(x);
        });
        return a;
    }, [users, q, role, sort]);

    return (
        <div data-testid="admin-users-page">
            <div className="overline">Accounts</div>
            <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                Users ({users.length})
            </h1>
            <AdminToolbar
                query={q}
                onQuery={setQ}
                placeholder="Search name, email or role…"
                filter={role}
                onFilter={setRole}
                filterOptions={[
                    { value: "all", label: "All roles" },
                    { value: "admin", label: "Admins" },
                    { value: "customer", label: "Customers" },
                ]}
                sort={sort}
                onSort={setSort}
                sortOptions={[
                    { value: "newest", label: "Newest first" },
                    { value: "oldest", label: "Oldest first" },
                    { value: "name", label: "Name A–Z" },
                    { value: "role", label: "Role" },
                ]}
                count={view.length}
                total={users.length}
            />
            <div className="overflow-x-auto mt-6 bg-white border border-[#E5E7EB]">
                <table className="w-full text-sm">
                    <thead className="bg-[#F5F7FA] text-[10px] font-mono uppercase tracking-widest text-[#4B5563]">
                        <tr>
                            <th className="text-left px-4 py-3">Name</th>
                            <th className="text-left px-4 py-3">Email</th>
                            <th className="text-left px-4 py-3">Role</th>
                            <th className="text-left px-4 py-3">Joined</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={4} className="px-4 py-10 text-center">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {view.map((u) => (
                            <tr
                                key={u.id}
                                className="border-t border-[#E5E7EB]"
                                data-testid={`admin-user-row-${u.id}`}
                            >
                                <td className="px-4 py-3 font-serif text-[#002B5C]">{u.name}</td>
                                <td className="px-4 py-3 text-[#4B5563]">{u.email}</td>
                                <td className="px-4 py-3">
                                    <span
                                        className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 ${u.role === "admin" ? "bg-[#002B5C] text-[#FFFFFF]" : "bg-[#F5F7FA] text-[#002B5C]"}`}
                                    >
                                        {u.role}
                                    </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-[#4B5563]">
                                    {new Date(u.created_at).toLocaleDateString("en-IN")}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
