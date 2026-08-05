import React, { useEffect, useState } from "react";
import { ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { adminSpamReview, adminSpamPurge, formatApiError } from "../../lib/api";

/**
 * Suspected automated signups, for a person to judge.
 *
 * NOTHING IS DELETED WITHOUT A TICK
 *
 * The obvious build is a "remove everything matching" button. It is also the
 * one that eventually deletes a real customer, and a Mongo delete has no undo.
 * So the rules only ever SELECT rows; a human confirms which of them go, and
 * the server takes explicit ids rather than the filter that produced them.
 *
 * TWO LISTS, BECAUSE THEY MEAN DIFFERENT THINGS
 *
 * Refused — screening already stopped these and nothing was stored. They are
 * shown so a false positive is visible: a genuine enquiry sitting in that list
 * means the thresholds are wrong.
 *
 * Suspects — these got through, mostly before the screening existed. Flagged on
 * a name no human would type, or several rows resolving to one mailbox once
 * Gmail dots and +tags are stripped. The second is much the stronger signal;
 * the first is a guess about somebody's name and is labelled as such.
 */

const TABS = [
    { key: "users", label: "Accounts" },
    { key: "newsletter", label: "Waitlist" },
    { key: "submissions", label: "Submissions" },
    { key: "contact_messages", label: "Messages" },
];

const REASON_LABEL = {
    machine_name: "name looks generated",
    shared_mailbox: "same inbox as another row",
    honeypot: "filled a hidden field",
    too_fast: "submitted instantly",
    stale_form: "very old form",
    no_shield: "posted straight at the API",
    rate_ip: "too many from one address",
    rate_email: "too many from one inbox",
};

export default function AdminSpam() {
    const [data, setData] = useState(null);
    const [tab, setTab] = useState("users");
    const [picked, setPicked] = useState(new Set());
    const [busy, setBusy] = useState(false);

    const load = () => {
        adminSpamReview()
            .then(setData)
            .catch((e) => toast.error(formatApiError(e)));
    };
    useEffect(load, []);

    // Switching tabs clears the selection: carrying ticks between collections
    // is how the wrong thing gets deleted.
    const switchTab = (k) => {
        setTab(k);
        setPicked(new Set());
    };

    const rows = data?.suspects?.[tab] || [];
    const toggle = (id) =>
        setPicked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    const remove = async () => {
        const ids = [...picked];
        if (!ids.length) return;
        const label = TABS.find((t) => t.key === tab)?.label;
        if (
            !window.confirm(
                `Permanently delete ${ids.length} ${label.toLowerCase()} row(s)?\n\nThis cannot be undone.`,
            )
        )
            return;
        setBusy(true);
        try {
            const res = await adminSpamPurge({ collection: tab, ids });
            toast.success(
                `Removed ${res.deleted}${res.skipped ? ` — ${res.skipped} skipped` : ""}.`,
            );
            setPicked(new Set());
            load();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };

    if (!data) return <div className="text-[#4B5563]">Loading…</div>;

    const counts = data.suspect_counts || {};
    const clean = Object.values(counts).every((n) => !n);

    return (
        <div data-testid="admin-spam-page">
            <div className="overline">Moderation</div>
            <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">Suspected spam</h1>
            <p className="mt-3 text-sm text-[#4B5563] max-w-2xl leading-relaxed">
                Rows that look automated. Nothing here has been touched — tick what should go and
                remove it. Deleting cannot be undone, so anything you are unsure about is better
                left alone.
            </p>

            <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => switchTab(t.key)}
                        data-testid={`spam-tab-${t.key}`}
                        className={`text-left border p-4 transition-colors ${
                            tab === t.key
                                ? "border-[#002B5C] bg-white"
                                : "border-[#E5E7EB] bg-white hover:border-[#002B5C]/40"
                        }`}
                    >
                        <div className="overline !text-[10px]">{t.label}</div>
                        <div className="font-serif text-3xl mt-2 text-[#002B5C]">
                            {counts[t.key] ?? 0}
                        </div>
                    </button>
                ))}
            </div>

            {clean && (
                <div className="mt-8 flex items-start gap-3 border border-[#E5E7EB] bg-white p-5">
                    <ShieldCheck size={18} strokeWidth={1.5} className="text-[#0F6E56] mt-0.5" />
                    <div className="text-sm text-[#4B5563]">
                        Nothing looks automated right now. The screening layer refuses most of it
                        before it is ever stored — see the refused list below.
                    </div>
                </div>
            )}

            {rows.length > 0 && (
                <>
                    <div className="mt-8 flex items-center justify-between gap-4">
                        <div className="text-sm text-[#4B5563]">
                            {picked.size ? `${picked.size} selected` : `${rows.length} flagged`}
                        </div>
                        <button
                            onClick={remove}
                            disabled={busy || !picked.size}
                            data-testid="spam-remove"
                            className="inline-flex items-center gap-2 bg-[#CC0033] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
                        >
                            <Trash2 size={14} strokeWidth={1.75} />
                            {busy ? "Removing…" : "Remove selected"}
                        </button>
                    </div>

                    <div className="mt-4 bg-white border border-[#E5E7EB] overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-[#F5F7FA] text-[10px] font-mono uppercase tracking-widest text-[#4B5563]">
                                <tr>
                                    <th className="w-10 px-4 py-3"></th>
                                    <th className="text-left px-4 py-3">Name</th>
                                    <th className="text-left px-4 py-3">Email</th>
                                    <th className="text-left px-4 py-3">Resolves to</th>
                                    <th className="text-left px-4 py-3">Why flagged</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-t border-[#E5E7EB]">
                                        <td className="px-4 py-3">
                                            <input
                                                type="checkbox"
                                                checked={picked.has(r.id)}
                                                onChange={() => toggle(r.id)}
                                                className="accent-[#CC0033]"
                                            />
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-[#002B5C] break-all">
                                            {r.name || "—"}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-[#4B5563] break-all">
                                            {r.email}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-[#4B5563] break-all">
                                            {r.normalised !== r.email ? r.normalised : ""}
                                        </td>
                                        <td className="px-4 py-3">
                                            {r.reasons.map((x) => (
                                                <span
                                                    key={x}
                                                    className="inline-block mr-1.5 mb-1 font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-[#FAEEDA] text-[#854F0B]"
                                                >
                                                    {REASON_LABEL[x] || x}
                                                </span>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            <section className="mt-14">
                <div className="overline">Already refused</div>
                <h2 className="font-serif text-2xl mt-2 text-[#002B5C]">
                    Stopped before anything was stored
                </h2>
                <p className="mt-2 text-sm text-[#4B5563] max-w-2xl leading-relaxed">
                    These never reached your lists. Kept because a screening layer that quietly
                    discards a real enquiry is worse than the spam — if you see a genuine one here,
                    tell me and I will loosen the thresholds.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(data.refused_by_reason || {}).map(([reason, n]) => (
                        <span
                            key={reason}
                            className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 bg-[#F5F7FA] border border-[#E5E7EB] text-[#4B5563]"
                        >
                            {REASON_LABEL[reason] || reason} · {n}
                        </span>
                    ))}
                    {!Object.keys(data.refused_by_reason || {}).length && (
                        <span className="text-sm text-[#4B5563]">Nothing refused in this window.</span>
                    )}
                </div>

                {(data.refused || []).length > 0 && (
                    <div className="mt-4 bg-white border border-[#E5E7EB] overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-[#F5F7FA] text-[10px] font-mono uppercase tracking-widest text-[#4B5563]">
                                <tr>
                                    <th className="text-left px-4 py-3">When</th>
                                    <th className="text-left px-4 py-3">Form</th>
                                    <th className="text-left px-4 py-3">Why</th>
                                    <th className="text-left px-4 py-3">What was sent</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.refused.slice(0, 60).map((r, i) => (
                                    <tr key={i} className="border-t border-[#E5E7EB] align-top">
                                        <td className="px-4 py-3 font-mono text-[11px] text-[#4B5563] whitespace-nowrap">
                                            {new Date(r.at).toLocaleString("en-IN")}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-[#002B5C]">{r.kind}</td>
                                        <td className="px-4 py-3">
                                            <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-[#FAEEDA] text-[#854F0B]">
                                                {REASON_LABEL[r.reason] || r.reason}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-[11px] text-[#4B5563] break-all max-w-[420px]">
                                            {r.payload?.email || ""}
                                            {r.payload?.name ? ` · ${r.payload.name}` : ""}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <div className="mt-10 flex items-start gap-3 text-xs text-[#4B5563] max-w-2xl leading-relaxed">
                <AlertTriangle size={14} strokeWidth={1.75} className="text-[#F59E0B] mt-0.5 shrink-0" />
                <span>
                    &ldquo;Name looks generated&rdquo; is a guess about a person&rsquo;s name and can
                    be wrong — it is never used to refuse a form, only to bring a row here for you to
                    look at. &ldquo;Same inbox&rdquo; is a fact: Gmail ignores dots and anything after
                    a +, so those addresses reach one person.
                </span>
            </div>
        </div>
    );
}
