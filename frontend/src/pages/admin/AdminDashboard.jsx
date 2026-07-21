import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ShoppingBag, Users, Mail, TrendingUp, FileText, Inbox, AlertTriangle, Sparkles, Search as SearchIcon } from "lucide-react";
import { adminStats, adminRunCartReminders, formatINR, adminSearchLogs } from "../../lib/api";
import { toast } from "sonner";

function Stat({ label, value, icon: Icon, accent }) {
    return (
        <div
            data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
            className="bg-white border border-[#E5E7EB] p-6"
        >
            <div className="flex items-center justify-between">
                <div className="overline !text-[10px]">{label}</div>
                <Icon size={16} strokeWidth={1.5} className={accent || "text-[#4B5563]"} />
            </div>
            <div className="font-serif text-4xl mt-4 text-[#002B5C]">{value}</div>
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

            <div className="mt-10 grid grid-cols-2 lg:grid-cols-5 gap-4">
                <Stat
                    label="Revenue"
                    value={stats ? formatINR(stats.revenue) : "—"}
                    icon={TrendingUp}
                    accent="text-[#CC0033]"
                />
                <Stat label="Orders" value={stats?.orders ?? "—"} icon={ShoppingBag} />
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
                        label="Revenue (7d)"
                        value={stats ? formatINR(stats.last_7_days?.revenue || 0) : "—"}
                        icon={TrendingUp}
                        accent="text-[#CC0033]"
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
                            <div className="col-span-4 font-serif text-[#002B5C]">
                                {o.full_name}
                            </div>
                            <div className="col-span-3 font-mono text-xs text-[#4B5563]">
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
                                {searchInsight.zero_result_searches} with no results
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
