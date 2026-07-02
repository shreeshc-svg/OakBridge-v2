import React, { useEffect, useState } from "react";
import { adminListUsers } from "../../lib/api";

export default function AdminUsers() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        adminListUsers()
            .then(setUsers)
            .finally(() => setLoading(false));
    }, []);

    return (
        <div data-testid="admin-users-page">
            <div className="overline">Accounts</div>
            <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                Users ({users.length})
            </h1>
            <div className="mt-8 bg-white border border-[#E5E7EB]">
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
                        {users.map((u) => (
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
