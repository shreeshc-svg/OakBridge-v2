import React, { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
    adminListUsers,
    adminCreateUser,
    adminSetUserRole,
    formatApiError,
} from "../../lib/api";
import AdminToolbar from "../../components/AdminToolbar";
import { useAuth } from "../../context/AuthContext";
import { ROLE_LABELS, isSuperadmin } from "../../lib/rbac";

const ASSIGNABLE = ["superadmin", "manager", "editor", "fulfilment", "customer"];
const BLANK = { name: "", email: "", phone: "", password: "", role: "fulfilment" };

export default function AdminUsers() {
    const { user: me } = useAuth();
    const canManage = isSuperadmin(me?.role);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [role, setRole] = useState("all");
    const [sort, setSort] = useState("newest");
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState(BLANK);
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState(null);

    const load = () =>
        adminListUsers()
            .then(setUsers)
            .finally(() => setLoading(false));

    useEffect(() => {
        load();
    }, []);

    const createUser = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await adminCreateUser(form);
            toast.success(`${form.email} created as ${form.role}.`);
            // Surface the sign-in details once so they can be handed over. The
            // password is never retrievable afterwards — only reset.
            setCreated({ email: form.email, password: form.password, role: form.role });
            setForm(BLANK);
            setShowNew(false);
            load();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setSaving(false);
        }
    };

    const changeRole = async (id, newRole) => {
        try {
            await adminSetUserRole(id, newRole);
            setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
            toast.success(`Role updated to ${newRole}.`);
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

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
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                    Users ({users.length})
                </h1>
                {canManage && (
                    <button
                        onClick={() => setShowNew((s) => !s)}
                        data-testid="admin-new-user"
                        className="mt-3 inline-flex items-center gap-2 bg-[#002B5C] text-white px-4 py-2 text-sm font-medium hover:bg-[#001F42]"
                    >
                        <UserPlus size={15} strokeWidth={1.5} />
                        {showNew ? "Cancel" : "New staff account"}
                    </button>
                )}
            </div>

            {created && (
                <div
                    data-testid="admin-created-credentials"
                    className="mt-6 border border-[#002B5C] bg-[#F5F7FA] p-5 max-w-3xl"
                >
                    <div className="flex items-start justify-between gap-4">
                        <div className="overline !text-[10px]">Account created — share these once</div>
                        <button onClick={() => setCreated(null)} className="text-xs text-[#4B5563] hover:text-[#CC0033]">
                            Dismiss
                        </button>
                    </div>
                    <dl className="mt-3 grid sm:grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
                        <dt className="text-[#4B5563]">Sign-in page</dt>
                        <dd className="font-mono text-[#002B5C] break-all">
                            {window.location.origin}/login
                        </dd>
                        <dt className="text-[#4B5563]">Login ID</dt>
                        <dd className="font-mono text-[#002B5C] break-all">{created.email}</dd>
                        <dt className="text-[#4B5563]">Password</dt>
                        <dd className="font-mono text-[#002B5C] break-all">{created.password}</dd>
                        <dt className="text-[#4B5563]">Role</dt>
                        <dd className="font-mono text-[#002B5C]">{created.role}</dd>
                    </dl>
                    <button
                        onClick={() => {
                            navigator.clipboard
                                ?.writeText(
                                    `Oakbridge admin\nSign in: ${window.location.origin}/login\nLogin ID: ${created.email}\nPassword: ${created.password}\nRole: ${created.role}`,
                                )
                                .then(() => toast.success("Copied."))
                                .catch(() => toast.error("Could not copy."));
                        }}
                        className="mt-4 text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-white"
                    >
                        Copy details
                    </button>
                    <p className="mt-3 text-[11px] text-[#4B5563]">
                        Signing in with this ID goes straight to the admin dashboard. Send the
                        password over a secure channel, not email, and ask them to change it.
                    </p>
                </div>
            )}

            {canManage && showNew && (
                <form
                    onSubmit={createUser}
                    data-testid="admin-new-user-form"
                    className="mt-6 border border-[#E5E7EB] bg-white p-5 max-w-3xl"
                >
                    <p className="text-[11px] text-[#4B5563]">
                        Creates a staff login immediately — no email verification needed. Share the
                        password securely and ask them to change it after first sign-in.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3 mt-4">
                        <input required placeholder="Full name" value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className="border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                        <input required type="email" placeholder="name@oakbridge.in" value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            className="border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                        <input type="tel" placeholder="Phone (optional)" value={form.phone}
                            onChange={(e) => setForm({ ...form, phone: e.target.value })}
                            className="border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                        <input required type="text" minLength={8} placeholder="Password (min 8 chars)" value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            className="border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C] font-mono" />
                    </div>
                    <div className="mt-3">
                        <label className="overline !text-[10px] block mb-1">Role</label>
                        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                            className="border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C] w-full sm:w-auto">
                            {ASSIGNABLE.map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                            ))}
                        </select>
                    </div>
                    <button type="submit" disabled={saving}
                        className="mt-4 bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50">
                        {saving ? "Creating…" : "Create account"}
                    </button>
                </form>
            )}
            <AdminToolbar
                query={q}
                onQuery={setQ}
                placeholder="Search name, email or role…"
                filter={role}
                onFilter={setRole}
                filterOptions={[
                    { value: "all", label: "All roles" },
                    { value: "superadmin", label: "Superadmins" },
                    { value: "admin", label: "Admins (legacy)" },
                    { value: "manager", label: "Managers" },
                    { value: "editor", label: "Editors" },
                    { value: "fulfilment", label: "Fulfilment" },
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
                                    {canManage ? (
                                        <select
                                            value={ASSIGNABLE.includes(u.role) ? u.role : "superadmin"}
                                            onChange={(e) => changeRole(u.id, e.target.value)}
                                            data-testid={`user-role-${u.id}`}
                                            className="border border-[#E5E7EB] bg-white px-2 py-1 text-xs outline-none focus:border-[#002B5C]"
                                        >
                                            {ASSIGNABLE.map((r) => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span
                                            className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 ${u.role !== "customer" ? "bg-[#002B5C] text-[#FFFFFF]" : "bg-[#F5F7FA] text-[#002B5C]"}`}
                                        >
                                            {u.role}
                                        </span>
                                    )}
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
