                        {/* Three lists, not one.
                            A term that found nothing INSIDE A CATEGORY is a
                            filter problem; one that never matched anywhere is a
                            catalogue gap; an ISBN is somebody asking for a title
                            we publish but do not list. Adding them together made
                            the biggest group — the filter one — look like lost
                            sales, and buried the ISBNs, which are the only rows
                            here worth acting on directly. */}
                        <div className="space-y-6">
                            <SearchList
                                title="Found nothing at all"
                                tone="danger"
                                empty="Every search matched something. Good sign."
                                rows={searchInsight.never_found || []}
                                hint="No title matched, on any attempt. This is the catalogue gap."
                            />
                            <SearchList
                                title="Asked for by ISBN"
                                tone="amber"
                                empty="No ISBN searches went unanswered."
                                rows={searchInsight.isbn_requests || []}
                                hint="Someone typed an ISBN we don't list. You publish 251 titles and sell 194 online."
                            />
                            <SearchList
                                title="Blocked by a filter"
                                tone="muted"
                                empty="Nothing was hidden by a category filter."
                                rows={searchInsight.filtered_out || []}
                                hint="These DO exist — the visitor was inside a category that excluded them."
                                showCategories
                            />
                        </div>
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ShoppingBag, Users, Mail, TrendingUp, FileText, Inbox, AlertTriangle, Sparkles, Search as SearchIcon } from "lucide-react";
import { adminStats, adminRunCartReminders, formatINR, adminSearchLogs } from "../../lib/api";
import PaymentBadge from "../../components/admin/PaymentBadge";
import { toast } from "sonner";

/**
 * One bucket of the search report.
 *
 * Kept as a component because the three lists differ only in what they mean,
 * and the meaning is the whole point — the previous single list mixed causes
 * that call for opposite responses.
 */
function SearchList({ title, rows, empty, hint, tone, showCategories }) {
    const border =
        tone === "danger" ? "border-[#CC0033]/30" : tone === "amber" ? "border-[#F59E0B]/40" : "border-[#E5E7EB]";
    const head =
        tone === "danger" ? "!text-[#CC0033]" : tone === "amber" ? "!text-[#854F0B]" : "";
    return (
        <div className={`bg-white border ${border}`}>
            <div className={`px-5 py-3 border-b border-[#E5E7EB] overline !text-[10px] ${head}`}>
                {title} {rows.length > 0 && `(${rows.length})`}
            </div>
            {rows.length === 0 ? (
                <p className="p-5 text-sm text-[#4B5563]">{empty}</p>
            ) : (
                <>
                    <p className="px-5 pt-3 text-xs text-[#4B5563] leading-relaxed">{hint}</p>
                    <div className="mt-2">
                        {rows.map((r) => (
                            <div
                                key={r.q}
                                className="flex items-center justify-between gap-4 px-5 py-2.5 border-t border-[#E5E7EB]"
                            >
                                <span className="min-w-0">
                                    <span className="text-sm text-[#002B5C] break-all">{r.q}</span>
                                    {showCategories && r.categories?.length > 0 && (
                                        <span className="block font-mono text-[10px] uppercase tracking-widest text-[#4B5563] mt-0.5">
                                            in {r.categories.join(", ")}
                                        </span>
                                    )}
                                </span>
                                <span className="font-mono text-xs text-[#4B5563] flex-shrink-0">
                                    {r.count}×
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function Stat({ label, value, icon: Icon, accent, hint }) {
    return (
        <div
            /* Slug on alphanumerics only. Labels carry "·" and "(7d)", and
               previously those went straight into the attribute. */
            data-testid={`stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
            className="bg-white border border-[#E5E7EB] p-6"
        >
            <div className="flex items-center justify-between">
                <div className="overline !text-[10px]">{label}</div>
                <Icon size={16} strokeWidth={1.5} className={accent || "text-[#4B5563]"} />
            </div>
            <div className="font-serif text-4xl mt-4 text-[#002B5C]">{value}</div>
            {/* A rupee figure on its own does not say whether the money arrived.
                The hint carries that, so the tile cannot be misread. */}
            {hint && (
                <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#4B5563]">
                    {hint}
                </div>
            )}
        </div>
    );
}

export default function AdminDashboard() {
    const [stats, setStats] = useState(null);
    const [reminding, setReminding] = useState(false);
    const [searchInsight, setSearchInsight] = useState(null);

    useEffect(() => {
        adminStats().then(setStats).catch(() => {});
        adminSearchLogs(30).then(setSearchInsight).catch(() => {});
    }, []);

    const runReminders = async () => {
        setReminding(true);
        try {
            const r = await adminRunCartReminders();
            toast.success(`Cart reminders: ${r.sent} sent, ${r.scanned} carts scanned.`);
        } catch (e) {
            toast.error("Could not run cart reminders.");
        } finally {
            setReminding(false);
        }
    };

    return (
        <div data-testid="admin-dashboard">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="overline">Overview</div>
                    <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">
                        Dashboard
                    </h1>
                </div>
                <button
                    type="button"
                    onClick={runReminders}
                    disabled={reminding}
                    data-testid="run-cart-reminders"
                    className="mt-2 text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] disabled:opacity-50"
                >
                    {reminding ? "Sending…" : "Run cart reminders"}
                </button>
            </div>

            {/* This block is ALL TIME; the block below it is the last 7 days.
                Without a header saying so, two revenue figures differing by
                ₹920 read as a contradiction rather than as two periods. The
                7-day block has always had a header — this one needs the
                matching one, or neither is self-explanatory. */}
            <div className="mt-12 overline">All time</div>

            {/* Money first, catalogue second. Revenue and the amount never
                collected sit side by side deliberately: the second number is
                only legible next to the first. */}
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-4">
                <Stat
                    label="Revenue · paid"
                    value={stats ? formatINR(stats.revenue) : "—"}
                    icon={TrendingUp}
                    accent="text-[#CC0033]"
                    hint={
                        stats
                            ? `${stats.paid_orders ?? 0} paid order${(stats.paid_orders ?? 0) === 1 ? "" : "s"}`
                            : null
                    }
                />
                <Stat
                    label="Not collected"
                    value={stats ? formatINR(stats.pending_revenue || 0) : "—"}
                    icon={AlertTriangle}
                    accent={stats?.pending_orders ? "text-[#F59E0B]" : undefined}
                    hint={
                        stats
                            ? `${stats.pending_orders ?? 0} unpaid · ${stats.failed_orders ?? 0} failed`
                            : null
                    }
                />
                <Stat
                    label="Orders"
                    value={stats?.orders ?? "—"}
                    icon={ShoppingBag}
                    hint={stats ? "paid and unpaid" : null}
                />
                <Stat label="Books" value={stats?.books ?? "—"} icon={BookOpen} />
                <Stat label="Customers" value={stats?.customers ?? "—"} icon={Users} />
                <Stat
                    label="Desk Pending"
                    value={stats?.desk_copies_pending ?? "—"}
                    icon={Mail}
                    accent="text-[#F59E0B]"
                />
            </div>

            <section className="mt-12">
                <div className="flex items-end justify-between">
                    <div>
                        <div className="overline">Last 7 days</div>
                        <h2 className="font-serif text-3xl mt-2 text-[#002B5C]">
                            This week at a glance
                        </h2>
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#4B5563]">
                        <Sparkles size={12} strokeWidth={1.5} className="text-[#F59E0B]" />
                        Live
                    </div>
                </div>
                <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat
                        label="Revenue (7d) · paid"
                        value={stats ? formatINR(stats.last_7_days?.revenue || 0) : "—"}
                        icon={TrendingUp}
                        accent="text-[#CC0033]"
                        hint={
                            /* new_orders minus paid_orders is the week's drop-off
                               at the payment step — the number worth watching. */
                            stats?.last_7_days
                                ? `${Math.max(0, (stats.last_7_days.new_orders || 0) - (stats.last_7_days.paid_orders || 0))} unpaid this week`
                                : null
                        }
                    />
                    <Stat
                        label="Paid orders (7d)"
                        value={stats?.last_7_days?.paid_orders ?? "—"}
                        icon={ShoppingBag}
                    />
                    <Stat
                        label="Waitlist (7d)"
                        value={stats?.last_7_days?.waitlist_signups ?? "—"}
                        icon={Inbox}
                        accent="text-[#F59E0B]"
                    />
                    <Stat
                        label="Submissions (7d)"
                        value={stats?.last_7_days?.submissions ?? "—"}
                        icon={FileText}
                    />
                </div>

                {/* Inventory alerts row */}
                {stats?.last_7_days && (stats.last_7_days.low_stock_books > 0 || stats.last_7_days.out_of_stock_books > 0) && (
                    <div
                        data-testid="inventory-alert-strip"
                        className="mt-6 border border-[#F59E0B]/40 bg-[#FFFBEB] px-5 py-4 flex items-start gap-3"
                    >
                        <AlertTriangle size={18} strokeWidth={1.5} className="text-[#F59E0B] mt-0.5" />
                        <div className="flex-1 text-sm text-[#002B5C]">
                            <strong>Inventory needs attention:</strong>{" "}
                            <span data-testid="low-stock-count">{stats.last_7_days.low_stock_books}</span> low-stock and{" "}
                            <span data-testid="out-of-stock-count">{stats.last_7_days.out_of_stock_books}</span> out-of-stock titles.
                        </div>
                        <Link
                            to="/admin/inventory"
                            className="text-xs font-medium border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]"
                        >
                            Open inventory →
                        </Link>
                    </div>
                )}
            </section>

            <section className="mt-12">
                <div className="flex justify-between items-end">
                    <div>
                        <div className="overline">Recent Activity</div>
                        <h2 className="font-serif text-3xl mt-2 text-[#002B5C]">
                            Latest orders
                        </h2>
                    </div>
                    <Link
                        to="/admin/orders"
                        className="text-sm border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]"
                    >
                        View all →
                    </Link>
                </div>
                <div className="mt-6 bg-white border border-[#E5E7EB]">
                    {(stats?.recent_orders || []).length === 0 && (
                        <div className="p-8 text-center text-sm text-[#4B5563]">
                            No orders yet.
                        </div>
                    )}
                    {(stats?.recent_orders || []).map((o) => (
                        <div
                            key={o.id}
                            className="grid grid-cols-12 gap-4 p-4 border-b border-[#E5E7EB] last:border-b-0 items-center text-sm"
                        >
                            <div className="col-span-3 font-mono text-xs text-[#002B5C]">
                                {o.order_number}
                            </div>
                            <div className="col-span-3 font-serif text-[#002B5C]">
                                {o.full_name}
                            </div>
                            <div className="col-span-2">
                                <PaymentBadge status={o.payment_status} />
                            </div>
                            <div className="col-span-2 font-mono text-[11px] text-[#4B5563]">
                                {new Date(o.created_at).toLocaleString("en-IN")}
                            </div>
                            <div className="col-span-2 text-right font-serif text-xl text-[#002B5C]">
                                {formatINR(o.total)}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* What customers are searching for — anonymous query log */}
            <section className="mt-12" data-testid="search-insights">
                <div className="flex items-end justify-between flex-wrap gap-3">
                    <div>
                        <div className="overline">Search insight · last 30 days</div>
                        <h2 className="font-serif text-2xl mt-2 text-[#002B5C]">
                            What people are looking for
                        </h2>
                    </div>
                    {searchInsight && (
                        <div className="font-mono text-xs text-[#4B5563]">
                            {searchInsight.total_searches} searches ·{" "}
                            <span className={searchInsight.zero_result_searches > 0 ? "text-[#CC0033]" : ""}>
                                {searchInsight.zero_result_searches} found nothing
                            </span>
                        </div>
                    )}
                </div>

                {!searchInsight || searchInsight.total_searches === 0 ? (
                    <div className="mt-4 border border-dashed border-[#E5E7EB] bg-white p-8 text-center">
                        <SearchIcon size={22} strokeWidth={1.5} className="mx-auto text-[#E5E7EB]" />
                        <p className="text-sm text-[#4B5563] mt-3">
                            No searches recorded yet. Queries are logged anonymously — the term and
                            the number of results, never who searched.
                        </p>
                    </div>
                ) : (
                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white border border-[#E5E7EB]">
                            <div className="px-5 py-3 border-b border-[#E5E7EB] overline !text-[10px]">
                                Most searched
                            </div>
                            {searchInsight.top_queries.length === 0 ? (
                                <p className="p-5 text-sm text-[#4B5563]">Nothing yet.</p>
                            ) : (
                                searchInsight.top_queries.map((r) => (
                                    <div key={r.q} className="flex items-center justify-between gap-4 px-5 py-2.5 border-b border-[#E5E7EB] last:border-b-0">
                                        <span className="text-sm text-[#002B5C] truncate">{r.q}</span>
                                        <span className="font-mono text-xs text-[#4B5563] flex-shrink-0">{r.count}×</span>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="bg-white border border-[#CC0033]/30">
                            <div className="px-5 py-3 border-b border-[#E5E7EB] overline !text-[10px] !text-[#CC0033]">
                                Found nothing — demand you aren't meeting
                            </div>
                            {searchInsight.zero_result_queries.length === 0 ? (
                                <p className="p-5 text-sm text-[#4B5563]">
                                    Every search returned results. Good sign.
                                </p>
                            ) : (
                                searchInsight.zero_result_queries.map((r) => (
                                    <div key={r.q} className="flex items-center justify-between gap-4 px-5 py-2.5 border-b border-[#E5E7EB] last:border-b-0">
                                        <span className="text-sm text-[#002B5C] truncate">{r.q}</span>
                                        <span className="font-mono text-xs text-[#CC0033] flex-shrink-0">{r.count}×</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
