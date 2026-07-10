import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, PackageX, Package, Search } from "lucide-react";
import { adminLowStock, fetchBooks, adminUpdateBook, formatINR, mediaUrl } from "../../lib/api";
import { toast } from "sonner";

export default function AdminInventory() {
    const [data, setData] = useState({ low_stock: [], out_of_stock: [], threshold: 10 });
    const [threshold, setThreshold] = useState(10);
    const [loading, setLoading] = useState(true);

    const [books, setBooks] = useState([]);
    const [booksLoading, setBooksLoading] = useState(true);
    const [query, setQuery] = useState("");

    const loadAlerts = () => {
        setLoading(true);
        adminLowStock(threshold)
            .then(setData)
            .finally(() => setLoading(false));
    };
    const loadBooks = () => {
        setBooksLoading(true);
        fetchBooks({ limit: 1000 })
            .then(setBooks)
            .finally(() => setBooksLoading(false));
    };

    useEffect(loadAlerts, [threshold]);
    useEffect(loadBooks, []);

    const onStockSaved = (id, newStock) => {
        setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, stock: newStock } : b)));
        loadAlerts(); // keep alert counts in sync
    };

    const totals = useMemo(() => {
        const units = books.reduce((s, b) => s + (Number(b.stock) || 0), 0);
        const value = books.reduce((s, b) => s + (Number(b.stock) || 0) * (Number(b.price) || 0), 0);
        return { titles: books.length, units, value };
    }, [books]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q
            ? books.filter((b) =>
                  [b.title, b.author, b.isbn, b.category].some((f) =>
                      (f || "").toLowerCase().includes(q),
                  ),
              )
            : books;
        return [...list].sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
    }, [books, query]);

    return (
        <div data-testid="admin-inventory-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <div className="overline">Stock Alerts</div>
                    <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">
                        Inventory
                    </h1>
                </div>
                <label className="flex items-center gap-3 text-sm">
                    <span className="overline !text-[10px]">Low stock threshold</span>
                    <input
                        type="number"
                        min={1}
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value) || 1)}
                        data-testid="inventory-threshold"
                        className="w-20 border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                    />
                </label>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                    data-testid="inventory-out-of-stock"
                    className="bg-white border border-[#CC0033] p-6"
                >
                    <div className="flex items-center gap-3">
                        <PackageX size={20} strokeWidth={1.5} className="text-[#CC0033]" />
                        <div className="overline">Out of stock</div>
                    </div>
                    <div className="font-serif text-5xl mt-3 text-[#CC0033]">
                        {data.out_of_stock?.length ?? 0}
                    </div>
                </div>
                <div
                    data-testid="inventory-low-stock"
                    className="bg-white border border-[#F59E0B] p-6"
                >
                    <div className="flex items-center gap-3">
                        <AlertTriangle size={20} strokeWidth={1.5} className="text-[#F59E0B]" />
                        <div className="overline">Low stock (≤ {threshold})</div>
                    </div>
                    <div className="font-serif text-5xl mt-3 text-[#002B5C]">
                        {data.low_stock?.length ?? 0}
                    </div>
                </div>
            </div>

            {loading && (
                <p className="mt-8 font-mono text-xs text-[#4B5563]">Loading…</p>
            )}

            {!loading && (
                <>
                    <section className="mt-12">
                        <h2 className="font-serif text-2xl text-[#CC0033]">
                            Out of Stock ({data.out_of_stock.length})
                        </h2>
                        {data.out_of_stock.length === 0 ? (
                            <p className="mt-3 text-sm text-[#4B5563]">
                                Nothing out of stock — great job.
                            </p>
                        ) : (
                            <div className="mt-4 bg-white border border-[#E5E7EB]">
                                {data.out_of_stock.map((b) => (
                                    <BookRow key={b.id} book={b} critical />
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="mt-12">
                        <h2 className="font-serif text-2xl text-[#002B5C]">
                            Low Stock ({data.low_stock.length})
                        </h2>
                        {data.low_stock.length === 0 ? (
                            <p className="mt-3 text-sm text-[#4B5563]">
                                No low-stock titles below the {threshold}-unit threshold.
                            </p>
                        ) : (
                            <div className="mt-4 bg-white border border-[#E5E7EB]">
                                {data.low_stock.map((b) => (
                                    <BookRow key={b.id} book={b} />
                                ))}
                            </div>
                        )}
                    </section>
                </>
            )}

            {/* ===================== ALL INVENTORY ===================== */}
            <section className="mt-16 border-t border-[#E5E7EB] pt-12">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <div className="overline">Full Catalogue</div>
                        <h2 className="font-serif text-3xl mt-1 text-[#002B5C]">
                            All Inventory ({totals.titles})
                        </h2>
                    </div>
                    <div className="relative">
                        <Search
                            size={14}
                            strokeWidth={1.5}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4B5563]"
                        />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search title, author, ISBN, category"
                            data-testid="inventory-search"
                            className="w-72 border border-[#E5E7EB] bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                        />
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                    <StatTile label="Titles" value={totals.titles} />
                    <StatTile label="Units in stock" value={totals.units} />
                    <StatTile label="Stock value" value={formatINR(totals.value)} />
                </div>

                {booksLoading ? (
                    <p className="mt-6 font-mono text-xs text-[#4B5563]">Loading inventory…</p>
                ) : (
                    <div className="mt-4 bg-white border border-[#E5E7EB] overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left border-b border-[#E5E7EB] text-[#4B5563]">
                                    <th className="px-4 py-3 font-medium">Title</th>
                                    <th className="px-4 py-3 font-medium">Category</th>
                                    <th className="px-4 py-3 font-medium text-right">Price</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium text-right">Stock</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((b) => (
                                    <InventoryRow
                                        key={b.id}
                                        book={b}
                                        threshold={threshold}
                                        onSaved={onStockSaved}
                                    />
                                ))}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-[#4B5563]">
                                            No matching titles.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}

function StatTile({ label, value }) {
    return (
        <div className="bg-white border border-[#E5E7EB] p-4">
            <div className="overline !text-[10px]">{label}</div>
            <div className="font-serif text-2xl mt-1 text-[#002B5C]">{value}</div>
        </div>
    );
}

function statusOf(stock, threshold) {
    if (stock <= 0) return { text: "Out of stock", cls: "text-[#CC0033]" };
    if (stock <= threshold) return { text: "Low", cls: "text-[#F59E0B]" };
    return { text: "In stock", cls: "text-green-700" };
}

function InventoryRow({ book, threshold, onSaved }) {
    const [val, setVal] = useState(book.stock ?? 0);
    const [saving, setSaving] = useState(false);
    useEffect(() => setVal(book.stock ?? 0), [book.stock]);

    const changed = Number(val) !== Number(book.stock);
    const st = statusOf(Number(book.stock) || 0, threshold);

    const save = async () => {
        setSaving(true);
        try {
            await adminUpdateBook(book.id, { stock: Number(val) });
            toast.success(`Stock updated for "${book.title}".`);
            onSaved(book.id, Number(val));
        } catch (e) {
            toast.error("Could not update stock. Try again.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <tr data-testid={`all-inv-row-${book.id}`} className="border-b border-[#E5E7EB] last:border-b-0">
            <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                    <img
                        src={mediaUrl(book.cover_image)}
                        alt=""
                        className="w-8 h-11 object-cover border border-[#E5E7EB]"
                    />
                    <div className="min-w-0">
                        <div className="font-serif text-[#002B5C] truncate max-w-[240px]">
                            {book.title}
                        </div>
                        <div className="text-xs text-[#4B5563] truncate max-w-[240px]">
                            {book.author}
                        </div>
                    </div>
                </div>
            </td>
            <td className="px-4 py-3 text-[#4B5563] whitespace-nowrap">{book.category}</td>
            <td className="px-4 py-3 text-right text-[#002B5C] whitespace-nowrap">
                {formatINR(book.price)}
            </td>
            <td className={`px-4 py-3 font-medium whitespace-nowrap ${st.cls}`}>{st.text}</td>
            <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                    <input
                        type="number"
                        min={0}
                        value={val}
                        onChange={(e) => setVal(e.target.value)}
                        data-testid={`stock-input-${book.id}`}
                        className="w-20 border border-[#E5E7EB] bg-white px-2 py-1 text-sm text-right outline-none focus:border-[#002B5C]"
                    />
                    <button
                        type="button"
                        onClick={save}
                        disabled={!changed || saving}
                        data-testid={`stock-save-${book.id}`}
                        className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40"
                    >
                        {saving ? "…" : "Save"}
                    </button>
                </div>
            </td>
        </tr>
    );
}

function BookRow({ book, critical = false }) {
    return (
        <div
            data-testid={`inventory-row-${book.id}`}
            className="flex items-center gap-4 p-4 border-b border-[#E5E7EB] last:border-b-0"
        >
            <img
                src={mediaUrl(book.cover_image)}
                alt=""
                className="w-10 h-14 object-cover border border-[#E5E7EB]"
            />
            <div className="flex-1 min-w-0">
                <div className="font-serif text-base text-[#002B5C] truncate">
                    {book.title}
                </div>
                <div className="text-xs text-[#4B5563] truncate">
                    {book.author} · {book.isbn}
                </div>
            </div>
            <div className="text-right">
                <div
                    className={`font-serif text-2xl ${critical ? "text-[#CC0033]" : "text-[#F59E0B]"}`}
                >
                    {book.stock}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#4B5563]">
                    {formatINR(book.price)}
                </div>
            </div>
            <Link
                to="/admin/books"
                className="text-xs border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033]"
            >
                Restock →
            </Link>
        </div>
    );
}

export { Package };  // re-export to avoid unused import warnings
