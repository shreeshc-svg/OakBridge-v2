import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, PackageX, Package } from "lucide-react";
import { adminLowStock, formatINR } from "../../lib/api";

export default function AdminInventory() {
    const [data, setData] = useState({ low_stock: [], out_of_stock: [], threshold: 10 });
    const [threshold, setThreshold] = useState(10);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        adminLowStock(threshold)
            .then(setData)
            .finally(() => setLoading(false));
    }, [threshold]);

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
        </div>
    );
}

function BookRow({ book, critical = false }) {
    return (
        <div
            data-testid={`inventory-row-${book.id}`}
            className="flex items-center gap-4 p-4 border-b border-[#E5E7EB] last:border-b-0"
        >
            <img
                src={book.cover_image}
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
