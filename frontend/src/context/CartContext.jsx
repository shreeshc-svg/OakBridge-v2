import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useAuth } from "./AuthContext";
import { saveCart, loadCart, fetchSettings, fetchSiteContent } from "../lib/api";
import { track } from "../lib/analytics";

const CartContext = createContext(null);
const STORAGE_KEY = "oakbridge_cart_v1";

const keyOf = (book_id, binding, size) => `${book_id}::${binding || ""}::${size || ""}`;
const itemKey = (i) => i.key || keyOf(i.book_id, i.binding, i.size);

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
    const [coupon, setCouponState] = useState(null);
    const [settings, setSettings] = useState(null);
    /*
     * Site content lives here beside settings so a book card can read it.
     *
     * BookCard needs the eBook labels and toggles, and it renders dozens of
     * times per page — fetching per card would be dozens of identical requests,
     * and threading it down as a prop would mean touching every page that
     * renders a grid. One fetch, shared by everything under the provider.
     */
    const [site, setSite] = useState(null);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }, [items]);

    useEffect(() => {
        fetchSettings().then(setSettings).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);

    const { isAuthenticated } = useAuth();
    const cartLoaded = useRef(false);

    useEffect(() => {
        if (!isAuthenticated || cartLoaded.current) return;
        cartLoaded.current = true;
        (async () => {
            try {
                if (items.length === 0) {
                    const data = await loadCart();
                    if (data?.items?.length) setItems(data.items);
                } else {
                    await saveCart(items);
                }
            } catch {
                /* non-blocking */
            }
        })();
    }, [isAuthenticated, items]);

    useEffect(() => {
        if (!isAuthenticated) return;
        const t = setTimeout(() => {
            saveCart(items).catch(() => {});
        }, 800);
        return () => clearTimeout(t);
    }, [items, isAuthenticated]);

    const addItem = useCallback((book, qty = 1, variant = null) => {
        const binding = variant?.binding || null;
        const size = variant?.size || null;
        const price = variant && variant.price != null ? Number(variant.price) : book.price;
        const stock = Number.isFinite(variant?.stock)
            ? variant.stock
            : Number.isFinite(book.stock)
              ? book.stock
              : 9999;
        if (stock <= 0) return;
        const k = keyOf(book.id, binding, size);
        setItems((prev) => {
            const existing = prev.find((i) => itemKey(i) === k);
            if (existing) {
                const capped = Math.min(existing.quantity + qty, stock);
                return prev.map((i) => (itemKey(i) === k ? { ...i, quantity: capped, stock, price } : i));
            }
            return [
                ...prev,
                {
                    key: k,
                    book_id: book.id,
                    title: book.title,
                    author: book.author,
                    cover_image: book.cover_image,
                    price,
                    quantity: Math.min(qty, stock),
                    stock,
                    binding,
                    size,
                },
            ];
        });
        /*
         * Fired here, not in BookCard, because this is the one place every
         * route into the cart converges: the card's "Add +", the product page,
         * the quick-add on a carousel. Instrumenting the buttons instead would
         * mean finding all of them, and missing the next one somebody adds.
         *
         * Sent after the stock guard above, so a click on an out-of-stock title
         * is not counted as an add that never happened.
         */
        track("add_to_cart", {
            book_id: book.id,
            title: book.title,
            price,
            quantity: qty,
            binding,
            size,
        });
        setIsOpen(true);
    }, []);

    const removeItem = useCallback((key) => {
        setItems((prev) => prev.filter((i) => itemKey(i) !== key));
    }, []);

    const updateQty = useCallback((key, quantity) => {
        if (quantity <= 0) {
            setItems((prev) => prev.filter((i) => itemKey(i) !== key));
            return;
        }
        setItems((prev) =>
            prev.map((i) => {
                if (itemKey(i) !== key) return i;
                const cap = Number.isFinite(i.stock) ? i.stock : quantity;
                return { ...i, quantity: Math.min(quantity, cap) };
            }),
        );
    }, []);

    const clear = useCallback(() => {
        setItems([]);
        setCouponState(null);
    }, []);

    const setCoupon = useCallback((c) => setCouponState(c), []);
    const clearCoupon = useCallback(() => setCouponState(null), []);

    const totals = useMemo(() => {
        const taxPct = Number(settings?.tax_percent ?? 0);
        const freeThr = Number(settings?.free_ship_threshold ?? 1500);
        const shipFlat = Number(settings?.ship_flat ?? 60);
        const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const count = items.reduce((sum, i) => sum + i.quantity, 0);
        const discount = coupon && subtotal > 0 ? Math.min(coupon.discount, subtotal) : 0;
        const discounted = Math.max(0, subtotal - discount);
        const shipping = discounted === 0 ? 0 : discounted > freeThr ? 0 : shipFlat;
        const tax = Math.round((discounted * taxPct) / 100);
        const total = discounted + shipping + tax;
        return { subtotal, discount, shipping, tax, total, count, taxPct };
    }, [items, coupon, settings]);

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
            settings,
            site,
            itemKey,
            ...totals,
        }),
        [items, isOpen, addItem, removeItem, updateQty, clear, coupon, setCoupon, clearCoupon, settings, site, totals],
    );

    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error("useCart must be used inside CartProvider");
    return ctx;
};
