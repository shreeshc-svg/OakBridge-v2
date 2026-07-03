import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "oakbridge_cart_v1";

export function CartProvider({ children }) {
    const [items, setItems] = useState(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });
    const [isOpen, setIsOpen] = useState(false);
    const [coupon, setCouponState] = useState(null); // { code, discount, kind, value }

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }, [items]);

    const addItem = useCallback((book, qty = 1) => {
        const stock = Number.isFinite(book.stock) ? book.stock : 9999;
        if (stock <= 0) return; // out of stock — cannot add
        setItems((prev) => {
            const existing = prev.find((i) => i.book_id === book.id);
            if (existing) {
                const capped = Math.min(existing.quantity + qty, stock);
                return prev.map((i) =>
                    i.book_id === book.id
                        ? { ...i, quantity: capped, stock }
                        : i,
                );
            }
            return [
                ...prev,
                {
                    book_id: book.id,
                    title: book.title,
                    author: book.author,
                    cover_image: book.cover_image,
                    price: book.price,
                    quantity: Math.min(qty, stock),
                    stock,
                },
            ];
        });
        setIsOpen(true);
    }, []);

    const removeItem = useCallback((book_id) => {
        setItems((prev) => prev.filter((i) => i.book_id !== book_id));
    }, []);

    const updateQty = useCallback(
        (book_id, quantity) => {
            if (quantity <= 0) {
                removeItem(book_id);
                return;
            }
            setItems((prev) =>
                prev.map((i) => {
                    if (i.book_id !== book_id) return i;
                    const cap = Number.isFinite(i.stock) ? i.stock : quantity;
                    return { ...i, quantity: Math.min(quantity, cap) };
                }),
            );
        },
        [removeItem],
    );

    const clear = useCallback(() => {
        setItems([]);
        setCouponState(null);
    }, []);

    const setCoupon = useCallback((c) => setCouponState(c), []);
    const clearCoupon = useCallback(() => setCouponState(null), []);

    const totals = useMemo(() => {
        const subtotal = items.reduce(
            (sum, i) => sum + i.price * i.quantity,
            0,
        );
        const count = items.reduce((sum, i) => sum + i.quantity, 0);
        const discount = coupon && subtotal > 0 ? Math.min(coupon.discount, subtotal) : 0;
        const discounted = Math.max(0, subtotal - discount);
        const shipping = discounted === 0 ? 0 : discounted > 1500 ? 0 : 60;
        const tax = Math.round(discounted * 0.05);
        const total = discounted + shipping + tax;
        return { subtotal, discount, shipping, tax, total, count };
    }, [items, coupon]);

    const value = useMemo(
        () => ({
            items,
            isOpen,
            setIsOpen,
            addItem,
            removeItem,
            updateQty,
            clear,
            coupon,
            setCoupon,
            clearCoupon,
            ...totals,
        }),
        [items, isOpen, addItem, removeItem, updateQty, clear, coupon, setCoupon, clearCoupon, totals],
    );

    return (
        <CartContext.Provider value={value}>{children}</CartContext.Provider>
    );
}

export const useCart = () => {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error("useCart must be used inside CartProvider");
    return ctx;
};
