import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    adminZohoStatus,
    adminZohoSettings,
    adminZohoTestConnection,
    adminZohoSyncNow,
    adminZohoRetryFailed,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { isSuperadmin } from "../../lib/rbac";

/**
 * Zoho Inventory link — the on/off switch and its status.
 *
 * Three states, and the switch only ever moves one step at a time on purpose:
 *   Off   nothing runs.
 *   Test  everything runs and is recorded, nothing on the website changes.
 *         Stock pulls show what they WOULD change; orders are queued, not sent.
 *         This is the trial mode while the team decides whether Zoho is the
 *         tool — it costs nothing to leave on.
 *   Live  Zoho sets website stock every 15 minutes, paid orders become Zoho
 *         sales orders, checkout asks Zoho before selling, and the Google-sheet
 *         sync stands down.
 *
 * Only a superadmin can change it (the server enforces that too): going live
 * hands control of every stock number on the site to another system.
 */
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("en-IN") : "never");

export default function ZohoInventoryPanel({ onStockChanged }) {
    const { user } = useAuth();
    const canChange = isSuperadmin(user?.role);
    const [st, setSt] = useState(null);
    const [busy, setBusy] = useState("");
    const [customer, setCustomer] = useState("");
    const [showChanges, setShowChanges] = useState(false);

    const load = useCallback(() => {
        adminZohoStatus()
            .then((s) => {
                setSt(s);
                setCustomer(s.customer_name || "");
            })
            .catch(() => setSt({ error: true }));
    }, []);
    useEffect(load, [load]);

    const run = async (key, fn, ok) => {
        setBusy(key);
        try {
            const res = await fn();
            if (ok) toast.success(ok(res));
            load();
            return res;
        } catch (e) {
            const d = e?.response?.data?.detail;
            toast.error(typeof d === "string" ? d : "Zoho request failed.");
            return null;
        } finally {
            setBusy("");
        }
    };

    const setState = (patch, msg) => run("settings", () => adminZohoSettings(patch), () => msg);

    const goLive = () => {
        if (
            !window.confirm(
                "Go live with Zoho Inventory?\n\n" +
                    "• Zoho will overwrite website stock every 15 minutes.\n" +
                    "• Every paid order becomes a confirmed Zoho sales order.\n" +
                    "• Checkout will refuse copies Zoho says are gone.\n" +
                    "• The Google-sheet stock sync pauses.\n\n" +
                    "Check the last Test-mode preview first.",
            )
        )
            return;
        setState({ enabled: true, mode: "live" }, "Zoho Inventory is LIVE.");
    };

    if (!st) return null;
    if (st.error) {
        return (
            <div className="mt-6 border border-[#E5E7EB] bg-white px-5 py-4 text-sm text-[#4B5563]">
                Zoho Inventory status could not be loaded.
            </div>
        );
    }

    const state = !st.enabled ? "off" : st.mode === "live" ? "live" : "test";
    const chip = {
        off: ["Off", "bg-[#F5F7FA] text-[#4B5563] border-[#E5E7EB]"],
        test: ["Test mode — nothing changes", "bg-[#F59E0B]/10 text-[#B4750F] border-[#F59E0B]/40"],
        live: ["Live", "bg-[#16A34A]/10 text-[#15803D] border-[#16A34A]/40"],
    }[state];
    const lp = st.last_pull;
    const ob = st.outbox || {};
    const missingEnv = Object.entries(st.env || {}).filter(([, v]) => !v).map(([k]) => k);

    return (
        <section data-testid="zoho-panel" className="mt-6 border border-[#E5E7EB] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <h2 className="font-serif text-2xl text-[#002B5C]">Zoho Inventory</h2>
                    <span data-testid="zoho-state" className={`border px-2 py-0.5 text-xs font-mono uppercase tracking-wider ${chip[1]}`}>
                        {chip[0]}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => run("test", adminZohoTestConnection, (r) => `Connected to Zoho. ${r.customer_message}`)}
                        disabled={!st.configured || !!busy}
                        data-testid="zoho-test-connection"
                        className="border border-[#002B5C] px-3 py-1.5 text-sm hover:bg-[#F5F7FA] disabled:opacity-50"
                    >
                        {busy === "test" ? "Checking…" : "Test connection"}
                    </button>
                    <button
                        type="button"
                        onClick={async () => {
                            const r = await run("sync", adminZohoSyncNow, (x) =>
                                x.applied
                                    ? `Synced from Zoho — ${x.changed} updated.`
                                    : `Preview — ${x.changed} book(s) would change. Nothing was written.`,
                            );
                            if (r) {
                                setShowChanges(true);
                                if (r.applied && onStockChanged) onStockChanged();
                            }
                        }}
                        disabled={!st.configured || !!busy}
                        data-testid="zoho-sync-now"
                        className="bg-[#002B5C] text-white px-3 py-1.5 text-sm hover:bg-[#001F42] disabled:opacity-50"
                    >
                        {busy === "sync" ? "Syncing…" : state === "live" ? "Sync from Zoho now" : "Preview sync"}
                    </button>
                </div>
            </div>

            {!st.configured && (
                <p data-testid="zoho-missing-env" className="mt-3 text-sm text-[#B4750F]">
                    Not connected: set {missingEnv.join(", ")} in Render → Environment, then redeploy.
                </p>
            )}

            {/* The switch. One step at a time: off → test → live. */}
            <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="zoho-switch">
                {!canChange && (
                    <span className="text-xs text-[#4B5563]">Only a superadmin can switch Zoho on or off.</span>
                )}
                {canChange && state === "off" && (
                    <button type="button" disabled={!st.configured || !!busy} data-testid="zoho-enable-test"
                        onClick={() => setState({ enabled: true, mode: "test" }, "Zoho Inventory on, in Test mode.")}
                        className="border border-[#F59E0B] px-3 py-1.5 text-sm hover:bg-[#F59E0B]/10 disabled:opacity-50">
                        Turn on (Test mode)
                    </button>
                )}
                {canChange && state === "test" && (
                    <>
                        <button type="button" disabled={!!busy} data-testid="zoho-go-live" onClick={goLive}
                            className="bg-[#15803D] text-white px-3 py-1.5 text-sm hover:bg-[#166534] disabled:opacity-50">
                            Go live
                        </button>
                        <button type="button" disabled={!!busy} data-testid="zoho-disable"
                            onClick={() => setState({ enabled: false }, "Zoho Inventory switched off.")}
                            className="border border-[#E5E7EB] px-3 py-1.5 text-sm hover:bg-[#F5F7FA]">
                            Turn off
                        </button>
                    </>
                )}
                {canChange && state === "live" && (
                    <button type="button" disabled={!!busy} data-testid="zoho-back-to-test"
                        onClick={() => setState({ mode: "test" }, "Back in Test mode — website stock is no longer changed by Zoho.")}
                        className="border border-[#F59E0B] px-3 py-1.5 text-sm hover:bg-[#F59E0B]/10">
                        Back to Test mode
                    </button>
                )}
                {canChange && (
                    <span className="ml-auto flex items-center gap-2 text-sm">
                        <span className="overline !text-[10px]">Zoho customer for web orders</span>
                        <input value={customer} onChange={(e) => setCustomer(e.target.value)}
                            data-testid="zoho-customer"
                            className="w-56 border border-[#E5E7EB] px-2 py-1 text-sm outline-none focus:border-[#002B5C]" />
                        <button type="button" disabled={!!busy || customer.trim() === (st.customer_name || "")}
                            onClick={() => setState({ customer_name: customer.trim() }, "Customer saved.")}
                            className="border border-[#E5E7EB] px-2 py-1 text-xs hover:bg-[#F5F7FA] disabled:opacity-40">
                            Save
                        </button>
                    </span>
                )}
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm" data-testid="zoho-stats">
                <Stat label="Last sync" value={fmt(st.last_pull_at)} sub={lp ? (lp.applied ? "applied" : "preview only") : ""} />
                <Stat label="Books linked to Zoho" value={st.linked_books ?? 0}
                    sub={lp ? `${lp.unmapped_books_count} not in Zoho` : ""} />
                <Stat label="Orders sent to Zoho" value={ob.done || 0}
                    sub={`${(ob.pending || 0) + (ob.sending || 0)} waiting${ob.test ? ` · ${ob.test} test` : ""}`} />
                <Stat label="Orders failing" value={(ob.failed || 0) + (ob.dead || 0)} warn={(ob.failed || 0) + (ob.dead || 0) > 0} />
            </div>

            {(st.problems || []).length > 0 && (
                <div className="mt-4 border border-[#CC0033]/30 bg-[#CC0033]/5 p-3 text-sm" data-testid="zoho-problems">
                    <div className="flex items-center justify-between">
                        <span className="font-medium text-[#CC0033]">Orders Zoho has not accepted</span>
                        <button type="button" disabled={!!busy}
                            onClick={() => run("retry", adminZohoRetryFailed, (r) => `${r.requeued} order(s) queued again.`)}
                            className="border border-[#CC0033] px-2 py-1 text-xs text-[#CC0033] hover:bg-white">
                            Retry all
                        </button>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-[#4B5563]">
                        {st.problems.map((p) => (
                            <li key={`${p.order_number}-${p.kind}`}>
                                {p.order_number} ({p.kind}, {p.attempts} tries): {p.last_error}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {lp && (
                <div className="mt-4 text-sm text-[#4B5563]" data-testid="zoho-last-pull">
                    <button type="button" onClick={() => setShowChanges((v) => !v)}
                        className="text-[#002B5C] underline underline-offset-2">
                        {lp.changed} stock change{lp.changed === 1 ? "" : "s"} {lp.applied ? "applied" : "would be made"} on {fmt(lp.at)}
                    </button>
                    {lp.fields_used && Object.keys(lp.fields_used).length > 0 && (
                        <span className="ml-2 text-xs">· read from Zoho “{Object.keys(lp.fields_used).join("”, “")}”</span>
                    )}
                    {lp.skipped_pending?.length > 0 && (
                        <span className="ml-2 text-xs">· {lp.skipped_pending.length} held back (order on its way to Zoho)</span>
                    )}
                    {showChanges && (lp.changes || []).length > 0 && (
                        <table className="mt-2 w-full text-xs">
                            <thead>
                                <tr className="text-left text-[#4B5563]">
                                    <th className="py-1 pr-2">ISBN</th><th className="py-1 pr-2">Title</th>
                                    <th className="py-1 pr-2 text-right">Website</th><th className="py-1 text-right">Zoho</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lp.changes.slice(0, 50).map((c) => (
                                    <tr key={c.book_id} className="border-t border-[#E5E7EB]">
                                        <td className="py-1 pr-2 font-mono">{c.isbn}</td>
                                        <td className="py-1 pr-2">{c.title}</td>
                                        <td className="py-1 pr-2 text-right">{c.from}</td>
                                        <td className="py-1 text-right text-[#002B5C] font-medium">{c.to}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {showChanges && lp.unmapped_books_count > 0 && (
                        <p className="mt-2 text-xs">
                            On the website but not in Zoho ({lp.unmapped_books_count}):{" "}
                            {(lp.unmapped_books || []).slice(0, 30).join(", ")}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

function Stat({ label, value, sub, warn }) {
    return (
        <div className={`border p-3 ${warn ? "border-[#CC0033]" : "border-[#E5E7EB]"}`}>
            <div className="overline !text-[10px]">{label}</div>
            <div className={`mt-1 font-serif text-xl ${warn ? "text-[#CC0033]" : "text-[#002B5C]"}`}>{value}</div>
            {sub ? <div className="text-xs text-[#4B5563] mt-0.5">{sub}</div> : null}
        </div>
    );
}
