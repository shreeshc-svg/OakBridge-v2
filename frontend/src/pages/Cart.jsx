import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { formatINR } from "../lib/api";

export default function Cart() {
    const nav = useNavigate();
    const { isAuthenticated } = useAuth();
    const proceedToCheckout = () => {
        if (isAuthenticated) {
            nav("/checkout");
        } else {
            toast.info("Please sign in to complete your purchase.");
            nav("/login", { state: { from: { pathname: "/checkout" } } });
        }
    };
    const {
        items,
        updateQty,
        removeItem,
        subtotal,
        shipping,
        tax,
        total,
    } = useCart();

    return (
        <div data-testid="cart-page" className="px-6 md:px-12 lg:px-16 py-16">
            <div className="overline">Your Order</div>
            <h1 className="font-serif text-5xl md:text-6xl mt-4 text-[#002B5C] leading-none">
                Shopping Cart
            </h1>

            {items.length === 0 ? (
                <div className="mt-16 border border-dashed border-[#E5E7EB] py-24 text-center">
                    <h2 className="font-serif text-3xl text-[#002B5C]">
                        Your cart is empty.
                    </h2>
                    <p className="text-sm text-[#4B5563] mt-2">
                        Explore the catalogue to find your next read.
                    </p>
                    <Link
                        to="/books"
                        data-testid="cart-page-browse-link"
                        className="mt-8 inline-flex items-center gap-2 bg-[#002B5C] text-[#FFFFFF] px-7 py-4 text-sm font-medium"
                    >
                        Browse Bookstore
                    </Link>
                </div>
            ) : (
                <div className="mt-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
                    <div className="lg:col-span-8">
                        <div className="grid grid-cols-12 gap-4 border-b border-[#002B5C] pb-3 text-xs font-mono uppercase tracking-widest text-[#4B5563]">
                            <div className="col-span-6">Title</div>
                            <div className="col-span-2">Qty</div>
                            <div className="col-span-3 text-right">Total</div>
                            <div className="col-span-1"></div>
                        </div>
                        {items.map((i) => (
                            <div
                                key={i.book_id}
                                data-testid={`cart-row-${i.book_id}`}
                                className="grid grid-cols-12 gap-4 py-6 border-b border-[#E5E7EB] items-center"
                            >
                                <div className="col-span-6 flex gap-4">
                                    <img
                                        src={i.cover_image}
                                        alt={i.title}
                                        className="w-20 h-28 object-cover border border-[#E5E7EB]"
                                    />
                                    <div>
                                        <Link
                                            to={`/books/${i.book_id}`}
                                            className="font-serif text-lg text-[#002B5C] hover:text-[#CC0033]"
                                        >
                                            {i.title}
                                        </Link>
                                        <p className="text-xs text-[#4B5563] mt-1">
                                            {i.author}
                                        </p>
                                        <p className="text-xs font-mono text-[#4B5563] mt-2">
                                            {formatINR(i.price)} each
                                        </p>
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <div className="flex items-center border border-[#E5E7EB] bg-white w-fit">
                                        <button
                                            onClick={() =>
                                                updateQty(i.book_id, i.quantity - 1)
                                            }
                                            data-testid={`cart-page-decrement-${i.book_id}`}
                                            className="px-2 py-1 hover:bg-[#F5F7FA]"
                                        >
                                            <Minus size={12} strokeWidth={1.5} />
                                        </button>
                                        <span className="px-3 text-sm font-mono min-w-[28px] text-center">
                                            {i.quantity}
                                        </span>
                                        <button
                                            onClick={() =>
                                                updateQty(i.book_id, i.quantity + 1)
                                            }
                                            data-testid={`cart-page-increment-${i.book_id}`}
                                            className="px-2 py-1 hover:bg-[#F5F7FA]"
                                        >
                                            <Plus size={12} strokeWidth={1.5} />
                                        </button>
                                    </div>
                                </div>
                                <div className="col-span-3 text-right font-serif text-xl text-[#002B5C]">
                                    {formatINR(i.price * i.quantity)}
                                </div>
                                <div className="col-span-1 text-right">
                                    <button
                                        onClick={() => removeItem(i.book_id)}
                                        data-testid={`cart-page-remove-${i.book_id}`}
                                        className="text-[#4B5563] hover:text-[#CC0033]"
                                    >
                                        <Trash2 size={16} strokeWidth={1.5} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <aside className="lg:col-span-4">
                        <div className="sticky top-24 border border-[#002B5C] p-8 bg-white">
                            <div className="overline">Summary</div>
                            <h3 className="font-serif text-3xl mt-2 text-[#002B5C]">
                                Order total
                            </h3>

                            <dl className="mt-6 space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <dt className="text-[#4B5563]">Subtotal</dt>
                                    <dd
                                        data-testid="summary-subtotal"
                                        className="font-mono text-[#002B5C]"
                                    >
                                        {formatINR(subtotal)}
                                    </dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-[#4B5563]">Shipping</dt>
                                    <dd className="font-mono text-[#002B5C]">
                                        {shipping === 0 ? "Free" : formatINR(shipping)}
                                    </dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-[#4B5563]">Tax (5%)</dt>
                                    <dd className="font-mono text-[#002B5C]">
                                        {formatINR(tax)}
                                    </dd>
                                </div>
                            </dl>
                            <div className="mt-5 pt-5 border-t border-[#E5E7EB] flex justify-between items-baseline">
                                <span className="overline">Total</span>
                                <span
                                    data-testid="summary-total"
                                    className="font-serif text-3xl text-[#002B5C]"
                                >
                                    {formatINR(total)}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={proceedToCheckout}
                                data-testid="cart-page-checkout-button"
                                className="mt-6 inline-flex items-center justify-center gap-2 w-full bg-[#002B5C] text-[#FFFFFF] py-4 text-sm font-medium hover:bg-[#001F42] transition-colors"
                            >
                                Proceed to Checkout
                                <ArrowRight size={14} strokeWidth={1.5} />
                            </button>
                            <p className="text-xs text-[#4B5563] text-center mt-3 font-mono">
                                Free shipping on orders over ₹1500.
                            </p>
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
}
