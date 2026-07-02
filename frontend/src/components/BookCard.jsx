import React from "react";
import { Link } from "react-router-dom";
import { formatINR } from "../lib/api";
import { useCart } from "../context/CartContext";

export default function BookCard({ book, index = 0, compact = false }) {
    const { addItem } = useCart();
    const discount = book.original_price
        ? Math.round(100 - (book.price / book.original_price) * 100)
        : 0;

    return (
        <div
            data-testid={`book-card-${book.id}`}
            className="group fade-up"
            style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
        >
            <Link to={`/books/${book.id}`} className="block">
                <div className="relative aspect-[2/3] overflow-hidden bg-white border border-[#E5E7EB]">
                    <img
                        src={book.cover_image}
                        alt={book.title}
                        className="absolute inset-0 w-full h-full object-contain book-tilt"
                        loading="lazy"
                    />
                    {book.bestseller && (
                        <span className={`absolute top-2 left-2 bg-[#002B5C] text-[#FFFFFF] font-mono uppercase tracking-widest px-1.5 py-0.5 ${compact ? "text-[8px]" : "text-[10px] top-3 left-3 px-2 py-1"}`}>
                            Bestseller
                        </span>
                    )}
                    {book.new_release && !book.bestseller && (
                        <span className={`absolute top-2 left-2 bg-[#F59E0B] text-[#002B5C] font-mono uppercase tracking-widest px-1.5 py-0.5 ${compact ? "text-[8px]" : "text-[10px] top-3 left-3 px-2 py-1"}`}>
                            New
                        </span>
                    )}
                    {discount > 0 && (
                        <span className={`absolute top-2 right-2 bg-[#CC0033] text-white font-mono px-1.5 py-0.5 ${compact ? "text-[8px]" : "text-[10px] top-3 right-3 px-2 py-1"}`}>
                            -{discount}%
                        </span>
                    )}
                </div>
                <div className={compact ? "pt-2" : "pt-4"}>
                    <div className={`overline ${compact ? "!text-[9px]" : "!text-[10px]"}`}>{book.subject}</div>
                    <h3 className={`font-serif leading-tight text-[#002B5C] line-clamp-2 ${compact ? "text-sm mt-1 min-h-[2.4rem]" : "text-lg mt-2 min-h-[3rem]"}`}>
                        {book.title}
                    </h3>
                    <p className={`text-[#4B5563] ${compact ? "text-[11px] mt-0.5" : "text-xs mt-1"}`}>
                        {book.author}
                    </p>
                </div>
            </Link>

            <div className={`flex items-end justify-between ${compact ? "mt-2" : "mt-3"}`}>
                <div className="flex items-baseline gap-2">
                    <span className={`font-serif text-[#002B5C] ${compact ? "text-base" : "text-xl"}`}>
                        {formatINR(book.price)}
                    </span>
                    {book.original_price && (
                        <span className={`text-[#4B5563] line-through ${compact ? "text-[10px]" : "text-xs"}`}>
                            {formatINR(book.original_price)}
                        </span>
                    )}
                </div>
                <button
                    onClick={() => addItem(book)}
                    data-testid={`add-to-cart-${book.id}`}
                    className={`font-medium text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] transition-colors pb-0.5 ${compact ? "text-[10px]" : "text-xs"}`}
                >
                    Add +
                </button>
            </div>
        </div>
    );
}
