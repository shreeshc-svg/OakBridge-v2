import React from "react";
import { Link } from "react-router-dom";
import { formatINR } from "../lib/api";

/*
 * "Paperback ₹595 | Hardback ₹995" on the product page (backend/book_formats.py).
 *
 * Each format is its own book with its own URL, so an option is a LINK, not
 * a toggle on this page's state: the price, stock, ISBN, reviews, "Add to
 * cart" and the JSON-LD all come from that format's own record, exactly as
 * if the shopper had arrived there directly. Nothing on this page has to
 * learn to show "the price of the selected format" — which is where the old
 * binding × size matrix kept getting price and stock out of step.
 *
 * `replace` so Back leaves the title instead of stepping through every
 * format the shopper compared.
 */

function availability(f) {
    if (f.coming_soon) return { text: "Pre-order", tone: "text-[#B45309]" };
    if (f.stock > 0) return f.stock <= 5 ? { text: `Only ${f.stock} left`, tone: "text-[#B45309]" } : { text: "In stock", tone: "text-[#15803D]" };
    if (f.pod) return { text: "Printed to order", tone: "text-[#4B5563]" };
    return { text: "Out of stock", tone: "text-[#9CA3AF]" };
}

export default function FormatSwitcher({ book }) {
    const formats = Array.isArray(book?.formats) ? book.formats : [];
    if (formats.length < 2) return null;
    return (
        <div className="mt-5" data-testid="format-switcher">
            <div className="text-[11px] font-mono uppercase tracking-widest text-[#4B5563] mb-2">
                Format: <span className="text-[#002B5C]">{book.format_label || formats.find((f) => f.id === book.id)?.label}</span>
            </div>
            <div className="flex flex-wrap gap-2" role="list">
                {formats.map((f) => {
                    const current = f.id === book.id;
                    const a = availability(f);
                    const off = f.original_price && Number(f.original_price) > Number(f.price)
                        ? Math.round((1 - Number(f.price) / Number(f.original_price)) * 100)
                        : 0;
                    const inner = (
                        <>
                            <span className="block text-sm font-semibold text-[#111827]">{f.label}</span>
                            <span className="block text-sm text-[#002B5C] mt-0.5">
                                {formatINR(f.price)}
                                {off > 0 && <span className="ml-1.5 text-[11px] text-[#15803D]">{off}% off</span>}
                            </span>
                            <span className={`block text-[11px] mt-0.5 ${a.tone}`}>{a.text}</span>
                        </>
                    );
                    const cls = `min-w-[128px] px-3 py-2 text-left border transition-colors ${
                        current
                            ? "border-[#002B5C] bg-[#F5F7FA] ring-1 ring-[#002B5C]"
                            : "border-[#E5E7EB] bg-white hover:border-[#002B5C]"
                    }`;
                    return current ? (
                        <div key={f.id} role="listitem" aria-current="true" className={cls} data-testid={`format-option-${f.id}`}>
                            {inner}
                        </div>
                    ) : (
                        <Link
                            key={f.id}
                            role="listitem"
                            to={`/books/${f.id}`}
                            replace
                            className={cls}
                            data-testid={`format-option-${f.id}`}
                            aria-label={`${f.label}, ${formatINR(f.price)}, ${a.text}`}
                        >
                            {inner}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
