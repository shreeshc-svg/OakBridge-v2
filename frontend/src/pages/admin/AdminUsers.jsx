import React, { useEffect, useMemo, useState } from "react";
import { UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
    adminListUsers,
    adminDeleteUser,
    adminCreateUser,
    adminSetUserRole,
    adminSetUserSections,
    formatApiError,
} from "../../lib/api";
import AdminToolbar from "../../components/AdminToolbar";
import { useAuth } from "../../context/AuthContext";
import {
    ROLE_LABELS,
    ROLE_PRESETS,
    SECTION_GROUPS,
    SECTION_LABELS,
    SHARED_CONTENT_SECTIONS,
    effectiveSections,
    isSuperadmin,
} from "../../lib/rbac";

const ASSIGNABLE = ["superadmin", "manager", "editor", "fulfilment", "customer"];
const BLANK = {
    name: "", email: "", phone: "", password: "",
    role: "fulfilment", sections: ROLE_PRESETS.fulfilment,
};

/** Tickable list of every admin section, grouped for scanning. */
function SectionPicker({ value, onChange, disabled }) {
    const toggle = (s) =>
        onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
    return (
        <div className={disabled ? "opacity-50 pointer-events-none" : ""}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                {SECTION_GROUPS.map((g) => (
                    <div key={g.label}>
                        <div className="overline !text-[9px] text-[#4B5563] mb-1.5">{g.label}</div>
                        {g.sections.map((s) => (
                            <label
                                key={s}
                                className="flex items-center gap-2 text-sm py-0.5 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={value.includes(s)}
                                    onChange={() => toggle(s)}
                                    data-testid={`section-${s}`}
                                    className="accent-[#002B5C] w-4 h-4"
                                />
                                <span className="text-[#002B5C]">{SECTION_LABELS[s]}</span>
                                {SHARED_CONTENT_SECTIONS.includes(s) && (
                                    <span title="Shares data endpoints with the other Site content screens — hiding it is not full isolation." className="text-[10px] text-[#F59E0B] font-mono">
                                        ~
                                    </span>
                                )}
                            </label>
                        ))}
                    </div>
                ))}
            </div>
            <p className="text-[11px] text-[#4B5563] mt-3">
                Dashboard is always included. Items marked{" "}
                <span className="text-[#F59E0B] font-mono">~</span> share the same save
                endpoints, so unticking one hides it but doesn't fully isolate it from the
                others in that group.
            </p>
        </div>
    );
}

export default function AdminUsers() {
    const { user: me } = useAuth();
    const canManage = isSuperadmin(me?.role);

    // Deleting a customer leaves their ORDERS alone — an order carries its own
    // snapshot of name, address and what was bought, so the financial record
    // survives. The confirmation says so, because "delete customer" reads like
    // it takes the order history with it.
    const removeUser = async (u) => {
        const label = `${u.name || u.email}`;
        if (
            !window.confirm(
                `Permanently delete ${label}?\n\nTheir orders are kept — an order holds its own copy of the name and delivery address. Only the account goes.\n\nThis cannot be undone.`,
            )
        )
            return;
        try {
            const res = await adminDeleteUser(u.id);
            toast.success(
                `${res.email} removed${res.orders_kept ? ` — ${res.orders_kept} order(s) kept` : ""}.`,
            );
            setUsers((prev) => prev.filter((x) => x.id !== u.id));
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [role, setRole] = useState("all");
    const [sort, setSort] = useState("newest");
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState(BLANK);
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState(null);
    const [editing, setEditing] = useState(null); // { id, sections }

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
            const res = await adminSetUserRole(id, newRole);
            // The backend resets bespoke sections to the new role's preset.
            setUsers((prev) =>
                prev.map((u) =>
                    u.id === id ? { ...u, role: newRole, sections: res.sections } : u,
                ),
            );
            toast.success(`Role updated to ${newRole}.`);
        } catch (err) {
            toast.error(formatApiError(err));
        }
    };

    const saveSections = async (id, sections) => {
        try {
            const res = await adminSetUserSections(id, sections);
            setUsers((prev) =>
                prev.map((u) => (u.id === id ? { ...u, sections: res.sections } : u)),
            );
            toast.success("Sections updated.");
            setEditing(null);
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
                        <label className="overline !text-[10px] block mb-1">Role — sets the starting sections</label>
                        <select
                            value={form.role}
                            onChange={(e) =>
                                setForm({
                                    ...form,
                                    role: e.target.value,
                                    sections: ROLE_PRESETS[e.target.value] || [],
                                })
                            }
                            className="border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C] w-full sm:w-auto"
                        >
                            {ASSIGNABLE.map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                            ))}
                        </select>
                    </div>

                    {form.role !== "customer" && (
                        <div className="mt-5 border-t border-[#E5E7EB] pt-4">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div className="overline !text-[10px]">
                                    Sections this person can open ({form.sections.length})
                                </div>
                                {isSuperadmin(form.role) && (
                                    <span className="text-[11px] text-[#4B5563]">
                                        Superadmins always have everything.
                                    </span>
                                )}
                            </div>
                            <div className="mt-3">
                                <SectionPicker
                                    value={form.sections}
                                    onChange={(sections) => setForm({ ...form, sections })}
                                    disabled={isSuperadmin(form.role)}
                                />
                            </div>
                        </div>
                    )}
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
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={5} className="px-4 py-10 text-center">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {view.map((u) => (
                            <React.Fragment key={u.id}>
                            <tr
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
                                <td className="px-4 py-3 text-right">
                                    {canManage && u.role !== "customer" && !isSuperadmin(u.role) && (
                                        <button
                                            onClick={() =>
                                                setEditing(
                                                    editing?.id === u.id
                                                        ? null
                                                        : { id: u.id, sections: effectiveSections(u) },
                                                )
                                            }
                                            data-testid={`edit-sections-${u.id}`}
                                            className="text-xs font-medium border border-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA] whitespace-nowrap"
                                        >
                                            {editing?.id === u.id ? "Close" : `Sections (${effectiveSections(u).length})`}
                                        </button>
                                    )}
                                    {canManage && u.role === "customer" && (
                                        <button
                                            onClick={() => removeUser(u)}
                                            data-testid={`delete-user-${u.id}`}
                                            title="Delete this customer account. Their orders are kept."
                                            className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium border border-[#CC0033] text-[#CC0033] px-3 py-1.5 hover:bg-[#CC0033]/5 whitespace-nowrap"
                                        >
                                            <Trash2 size={12} strokeWidth={1.75} />
                                            Delete
                                        </button>
                                    )}
                                </td>
                            </tr>
                            {editing?.id === u.id && (
                                <tr className="bg-[#F5F7FA] border-t border-[#E5E7EB]">
                                    <td colSpan={5} className="px-4 py-5">
                                        <div className="overline !text-[10px] mb-3">
                                            {u.name} — tick the sections they can open
                                        </div>
                                        <SectionPicker
                                            value={editing.sections}
                                            onChange={(sections) => setEditing({ ...editing, sections })}
                                        />
                                        <div className="mt-4 flex gap-2">
                                            <button
                                                onClick={() => saveSections(u.id, editing.sections)}
                                                className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42]"
                                            >
                                                Save sections
                                            </button>
                                            <button
                                                onClick={() =>
                                                    setEditing({ ...editing, sections: ROLE_PRESETS[u.role] || [] })
                                                }
                                                className="text-sm border border-[#E5E7EB] px-4 py-2 hover:bg-white"
                                            >
                                                Reset to {u.role} preset
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
