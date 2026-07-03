import React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { X, Minus, Plus, Trash2 } from "lucide-react";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "./ui/sheet";
import { useCart } from "../context/CartContext";
import { formatINR } from "../lib/api";

export default function CartSheet() {
    const {
        items,
        isOpen,
        setIsOpen,
        removeItem,
        updateQty,
        subtotal,
        count,
    } = useCart();
    const nav = useNavigate();
    const { isAuthenticated } = useAuth();

    const goCheckout = () => {
        setIsOpen(false);
        if (isAuthenticated) {
            nav("/checkout");
        } else {
            toast.info("Please sign in to complete your purchase.");
            nav("/login", { state: { from: { pathname: "/checkout" } } });
        }
    };
    const goCart = () => {
        setIsOpen(false);
        nav("/cart");
    };

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetContent
                data-testid="cart-sheet"
                className="bg-[#FFFFFF] border-l border-[#E5E7EB] w-full sm:max-w-md p-0 flex flex-col"
            >
                <SheetHeader className="px-6 py-5 border-b border-[#E5E7EB]">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="font-serif text-2xl text-[#002B5C]">
                            Your Cart
                        </SheetTitle>
                        <span className="font-mono text-xs text-[#4B5563]">
                            {count} {count === 1 ? "item" : "items"}
                        </span>
                    </div>
                </SheetHeader>

                {items.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
                        <div className="overline">Empty</div>
                        <h3 className="font-serif text-2xl mt-3 text-[#002B5C]">
                            Your shelf is bare.
                        </h3>
                        <p className="text-sm text-[#4B5563] mt-2">
                            Explore our bookstore to find your next great read.
                        </p>
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                nav("/books");
                            }}
                            data-testid="cart-browse-books-button"
                            className="mt-6 bg-[#002B5C] text-[#FFFFFF] px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                        >
                            Browse Books
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                            {items.map((i) => (
                                <div
                                    key={i.book_id}
                                    data-testid={`cart-item-${i.book_id}`}
                                    className="flex gap-4 border-b border-[#E5E7EB] pb-5"
                                >
                                    <img
                                        src={i.cover_image}
                                        alt={i.title}
                                        className="w-16 h-24 object-cover border border-[#E5E7EB]"
                                    />
                                    <div className="flex-1 flex flex-col">
                                        <h4 className="font-serif text-base leading-tight text-[#002B5C] line-clamp-2">
                                            {i.title}
                                        </h4>
                                        <p className="text-xs text-[#4B5563] mt-0.5">
                                            {i.author}
                                        </p>
                                        <div className="mt-auto flex items-center justify-between">
                                            <div className="flex items-center border border-[#E5E7EB]">
                                                <button
                                                    onClick={() =>
                                                        updateQty(
                                                            i.book_id,
                                                            i.quantity - 1,
                                                        )
                                                    }
                                                    data-testid={`cart-decrement-${i.book_id}`}
                                                    className="px-2 py-1 hover:bg-[#F5F7FA]"
                                                    aria-label="Decrease"
                                                >
                                                    <Minus
                                                        size={12}
                                                        strokeWidth={1.5}
                                                    />
                                                </button>
                                                <span className="px-3 text-sm font-mono min-w-[28px] text-center">
                                                    {i.quantity}
                                                </span>
                                                <button
                                                    onClick={() =>
                                                        updateQty(
                                                            i.book_id,
                                                            i.quantity + 1,
                                                        )
                                                    }
                                                    data-testid={`cart-increment-${i.book_id}`}
                                                    className="px-2 py-1 hover:bg-[#F5F7FA]"
                                                    aria-label="Increase"
                                                >
                                                    <Plus
                                                        size={12}
                                                        strokeWidth={1.5}
                                                    />
                                                </button>
                                            </div>
                                            <span className="font-serif text-lg text-[#002B5C]">
                                                {formatINR(
                                                    i.price * i.quantity,
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeItem(i.book_id)}
                                        data-testid={`cart-remove-${i.book_id}`}
                                        className="self-start text-[#4B5563] hover:text-[#CC0033]"
                                        aria-label="Remove"
                                    >
                                        <Trash2
                                            size={16}
                                            strokeWidth={1.5}
                                        />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="border-t border-[#E5E7EB] px-6 py-5 bg-white">
                            <div className="flex items-baseline justify-between">
                                <span className="overline">Subtotal</span>
                                <span
                                    data-testid="cart-subtotal"
                                    className="font-serif text-2xl text-[#002B5C]"
                                >
                                    {formatINR(subtotal)}
                                </span>
                            </div>
                            <p className="text-xs text-[#4B5563] mt-1">
                                Shipping & taxes calculated at checkout.
                            </p>
                            <div className="grid grid-cols-2 gap-3 mt-4">
                                <button
                                    onClick={goCart}
                                    data-testid="cart-view-full-button"
                                    className="border border-[#002B5C] text-[#002B5C] py-3 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                                >
                                    View Cart
                                </button>
                                <button
                                    onClick={goCheckout}
                                    data-testid="cart-checkout-button"
                                    className="bg-[#002B5C] text-[#FFFFFF] py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                                >
                                    Checkout
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
