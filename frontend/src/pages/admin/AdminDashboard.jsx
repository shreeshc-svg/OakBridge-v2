import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ShoppingBag, Users, TrendingUp, FileText, Inbox, AlertTriangle, GripVertical, Search as SearchIcon } from "lucide-react";
import { adminStats, adminRunCartReminders, formatINR, adminSearchLogs } from "../../lib/api";
import PaymentBadge from "../../components/admin/PaymentBadge";
import { RANGE_PRESETS, resolveRange, rangeLabel } from "../../lib/dateRange";
import { readTileOrder, writeTileOrder, clearTileOrder, moveTile } from "../../lib/tileOrder";
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

function Stat({ label, value, icon: Icon, accent, hint, scope, dragProps }) {
    return (
        <div
            /* Slug on alphanumerics only. Labels carry "·" and "(7d)", and
               previously those went straight into the attribute. */
            data-testid={`stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
            className="group relative bg-white border border-[#E5E7EB] p-6 cursor-grab active:cursor-grabbing"
            {...dragProps}
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
            {/*
             * Every tile says which period it covers. This is the whole reason a
             * range control is safe to add: once some numbers move with the
             * range and some cannot, a grid that does not label the difference
             * is a grid that invites you to compare July's revenue against the
             * current stock level and draw a conclusion.
             */}
            {scope && (
                <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                    {scope}
                </div>
            )}
            <GripVertical
                size={13}
                strokeWidth={1.5}
                aria-hidden="true"
                className="absolute right-2 top-2 text-[#C9CFD8] opacity-0 group-hover:opacity-100 transition-opacity"
            />
        </div>
    );
}

/*
 * The tiles, as data.
 *
 * They used to be six hand-written <Stat> elements. Drag-to-reorder needs a
 * keyed list — you cannot splice JSX — and having one anyway means the scope
 * label and the value are declared together, so a tile cannot end up claiming a
 * period it does not follow.
 *
 * `scoped` is the honest flag: true means this number answers to the date
 * range, false means it is a state that only has a "right now".
 */
const TILE_DEFS = {
    revenue: {
        scoped: true,
        label: "Revenue · paid",
        icon: TrendingUp,
        accent: "text-[#CC0033]",
        value: (s) => formatINR(s.revenue || 0),
        hint: (s) => `${s.paid_orders ?? 0} paid order${(s.paid_orders ?? 0) === 1 ? "" : "s"}`,
    },
    not_collected: {
        scoped: true,
        label: "Not collected",
        icon: AlertTriangle,
        accent: (s) => (s.pending_orders ? "text-[#F59E0B]" : undefined),
        value: (s) => formatINR(s.pending_revenue || 0),
        hint: (s) => `${s.pending_orders ?? 0} unpaid · ${s.failed_orders ?? 0} failed`,
    },
    orders: {
        scoped: true,
        label: "Orders",
        icon: ShoppingBag,
        value: (s) => s.orders ?? "—",
        hint: () => "paid and unpaid",
    },
    customers: {
        scoped: true,
        label: "New customers",
        icon: Users,
        value: (s) => s.new_customers ?? "—",
        // The all-time total rides along so the tile never loses the number you
        // already know by heart when a range is applied.
        hint: (s) => `${s.customers ?? 0} all time`,
    },
    books: {
        scoped: false,
        label: "Books",
        icon: BookOpen,
        value: (s) => s.books ?? "—",
        hint: () => "titles on sale",
    },
    waitlist: {
        scoped: true,
        label: "Waitlist",
        icon: Inbox,
        accent: "text-[#F59E0B]",
        value: (s) => s.waitlist_signups ?? "—",
        hint: () => "stock + newsletter sign-ups",
    },
    submissions: {
        scoped: true,
        label: "Submissions",
        icon: FileText,
        value: (s) => s.submissions ?? "—",
        hint: () => "manuscripts received",
    },
};

const TILE_ORDER_DEFAULT = [
    "revenue", "not_collected", "orders", "customers", "books", "waitlist", "submissions",
];

export default function AdminDashboard() {
    const [stats, setStats] = useState(null);
    const [reminding, setReminding] = useState(false);
    const [searchInsight, setSearchInsight] = useState(null);

    const [preset, setPreset] = useState("all");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [order, setOrder] = useState(() => readTileOrder(TILE_ORDER_DEFAULT));
    const dragKey = useRef(null);

    const range = useMemo(
        () => resolveRange(preset, { from: customFrom, to: customTo }),
        [preset, customFrom, customTo],
    );

    useEffect(() => {
        /*
         * Refetch on every range change. The window is resolved in the admin's
         * own timezone here and sent as two instants, so the backend never has
         * to guess what "this month" meant to the person who clicked it.
         */
        adminStats(range).then(setStats).catch(() => {});
    }, [range]);

    useEffect(() => {
        adminSearchLogs(30).then(setSearchInsight).catch(() => {});
    }, []);

    const applyOrder = (next) => {
        setOrder(next);
        writeTileOrder(next);
    };

    const resetOrder = () => {
        clearTileOrder();
        setOrder(TILE_ORDER_DEFAULT);
    };

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

            {/*
              THE RANGE BAR.
              Sits directly above the tiles because it governs them, and states
              the resolved window in words underneath — the buttons say what you
              asked for, the line says what you got. Those differ whenever a
              custom range is only half filled in.
            */}
            <div
                data-testid="dashboard-range"
                className="mt-10 flex flex-col gap-3 border-b border-[#E5E7EB] pb-4 lg:flex-row lg:items-center lg:justify-between"
            >
                <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex border border-[#E5E7EB] bg-white">
                        {RANGE_PRESETS.map((p, i) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => setPreset(p.key)}
                                aria-pressed={preset === p.key}
                                data-testid={`range-${p.key}`}
                                className={`text-xs px-3 h-9 whitespace-nowrap ${i > 0 ? "border-l border-[#E5E7EB]" : ""} ${
                                    preset === p.key
                                        ? "bg-[#002B5C] text-white font-semibold"
                                        : "text-[#4B5563] hover:bg-[#F5F7FA]"
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {preset === "custom" && (
                        <div className="flex items-center gap-2 text-xs text-[#4B5563]">
                            <input
                                type="date"
                                value={customFrom}
                                onChange={(e) => setCustomFrom(e.target.value)}
                                aria-label="Range start"
                                data-testid="range-from"
                                className="border border-[#E5E7EB] px-2 h-9 text-sm text-[#002B5C]"
                            />
                            <span>to</span>
                            <input
                                type="date"
                                value={customTo}
                                onChange={(e) => setCustomTo(e.target.value)}
                                aria-label="Range end"
                                data-testid="range-to"
                                className="border border-[#E5E7EB] px-2 h-9 text-sm text-[#002B5C]"
                            />
                        </div>
                    )}
                </div>
                <div
                    data-testid="range-label"
                    className="font-mono text-[10px] uppercase tracking-widest text-[#4B5563]"
                >
                    {/* The server's echo wins: it is the window that was
                        actually applied, and it disagrees with ours whenever a
                        bound failed to parse on the way over. */}
                    {rangeLabel(preset, stats?.range?.applied ? stats.range : range)}
                </div>
            </div>

            {/*
              THE TILES, in whatever order this browser last left them.
              Native HTML5 drag, the same mechanism as the section reorder in
              Admin -> Pages, so there is one drag idiom in this codebase rather
              than two. Order is saved on drop; there is no Save button to
              forget to press.
            */}
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-3 gap-4">
                {order.map((key) => {
                    const def = TILE_DEFS[key];
                    if (!def) return null;
                    const s = stats || {};
                    const accent = typeof def.accent === "function" ? def.accent(s) : def.accent;
                    return (
                        <Stat
                            key={key}
                            label={def.label}
                            icon={def.icon}
                            accent={accent}
                            value={stats ? def.value(s) : "—"}
                            hint={stats ? def.hint(s) : null}
                            scope={def.scoped ? (range ? "selected range" : "all time") : "all time"}
                            dragProps={{
                                draggable: true,
                                onDragStart: () => { dragKey.current = key; },
                                onDragOver: (e) => e.preventDefault(),
                                onDrop: (e) => {
                                    e.preventDefault();
                                    if (dragKey.current) applyOrder(moveTile(order, dragKey.current, key));
                                    dragKey.current = null;
                                },
                                onDragEnd: () => { dragKey.current = null; },
                            }}
                        />
                    );
                })}
            </div>

            <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#9CA3AF]">
                Drag a tile to reorder · saved on this browser ·{" "}
                <button
                    type="button"
                    onClick={resetOrder}
                    data-testid="reset-tile-order"
                    className="uppercase tracking-widest text-[#CC0033] underline"
                >
                    Reset layout
                </button>
            </div>

            {/* Inventory alerts row. Stock is a state, so it sits outside the
                range entirely and says so. */}
            {stats && (stats.low_stock_books > 0 || stats.out_of_stock_books > 0) && (
                <div
                    data-testid="inventory-alert-strip"
                    className="mt-8 border border-[#F59E0B]/40 bg-[#FFFBEB] px-5 py-4 flex items-start gap-3"
                >
                    <AlertTriangle size={18} strokeWidth={1.5} className="text-[#F59E0B] mt-0.5" />
                    <div className="flex-1 text-sm text-[#002B5C]">
                        <strong>Inventory needs attention:</strong>{" "}
                        <span data-testid="low-stock-count">{stats.low_stock_books}</span> low-stock and{" "}
                        <span data-testid="out-of-stock-count">{stats.out_of_stock_books}</span> out-of-stock titles.
                    </div>
                    <Link
                        to="/admin/inventory"
                        className="text-xs font-medium border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]"
                    >
                        Open inventory →
                    </Link>
                </div>
            )}

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
                    </div>
                )}
            </section>
        </div>
    );
}
