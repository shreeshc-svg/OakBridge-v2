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
import { saveCart, loadCart, fetchSettings, fetchSiteContent, fetchPromotion } from "../lib/api";
import { track } from "../lib/analytics";
import { trackStep } from "../lib/attribution";
import { API } from "../lib/api";
import { preorderState } from "../lib/preorder";
import { useBootState } from "../lib/boot";
import { isPrerender } from "../lib/runtime";
import { PROMO_KEY, promoDiscount } from "../lib/promotion";
import { podActive, POD_MAX_QTY, dispatchWindow } from "../lib/pod";
import { fetchPodSchedule } from "../lib/api";

const CartContext = createContext(null);
const STORAGE_KEY = "oakbridge_cart_v1";
// A pre-order cannot be capped at what is on the shelf, because nothing is.
// Ten is a bookshop-sized limit: enough for a department, low enough that a
// mistyped quantity is not a five-figure order for a book nobody has printed.
const PREORDER_MAX_QTY = 10;

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
    // Boot state, not plain state: every BookCard reads these while rendering
    // (delivery line, eBook label), so an empty first render here broke
    // hydration on every page with a book grid. See lib/boot.js.
    const [settings, setSettings] = useBootState("cart:settings", null);
    /*
     * Site content lives here beside settings so a book card can read it.
     *
     * BookCard needs the eBook labels and toggles, and it renders dozens of
     * times per page — fetching per card would be dozens of identical requests,
     * and threading it down as a prop would mean touching every page that
     * renders a grid. One fetch, shared by everything under the provider.
     */
    const [site, setSite] = useBootState("cart:site", null);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }, [items]);

    useEffect(() => {
        fetchSettings().then(setSettings).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    }, [setSettings, setSite]);

    /*
     * Festive promotion (Admin → Coupons & Promotions). Plain state, loaded
     * after the first render and never in the prerender: an offer starts and
     * ends between builds, so baking it into the page would be wrong for
     * somebody. The last one seen is remembered so the banner appears at once
     * on the next page; it is dropped when its end time passes.
     */
    const [promo, setPromo] = useState(null);
    // Print-on-demand holidays (for the 5–7 working-day dates). Loaded after
    // the first render: the dates depend on today, so they never belong in
    // the prerendered page.
    const [podSchedule, setPodSchedule] = useState(null);
    useEffect(() => {
        if (isPrerender()) return;
        fetchPodSchedule().then(setPodSchedule).catch(() => setPodSchedule({ holidays: [] }));
    }, []);
    useEffect(() => {
        if (isPrerender()) return;
        try {
            const c = JSON.parse(localStorage.getItem(PROMO_KEY) || "null");
            if (c && new Date(c.ends_at) > new Date()) setPromo(c);
        } catch { /* ignore */ }
        fetchPromotion()
            .then((p) => {
                setPromo(p);
                try { p ? localStorage.setItem(PROMO_KEY, JSON.stringify(p)) : localStorage.removeItem(PROMO_KEY); } catch { /* private mode */ }
            })
            .catch(() => {});
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
        /*
         * A pre-order is a sale of something that does not exist yet, so the
         * stock guard has to stand aside — otherwise the Pre-order button
         * silently does nothing and the feature is decorative.
         *
         * The cap below is lifted with it: `stock` for these titles is 0, and
         * Math.min(qty, 0) would put a zero-quantity line in the cart. A
         * pre-order is capped at a sane per-order number instead of at what is
         * on the shelf.
         */
        const preorder = preorderState(book).active;
        // Print on demand (lib/pod.js): sold at zero stock, printed per order.
        const pod = podActive(book, preorder);
        if (stock <= 0 && !preorder && !pod) return;
        trackStep(API, "add_to_cart"); // Marketing → Growth funnel step (cookie-free, once per session)
        const cap = preorder ? PREORDER_MAX_QTY : pod ? POD_MAX_QTY : stock;
        const k = keyOf(book.id, binding, size);
        setItems((prev) => {
            const existing = prev.find((i) => itemKey(i) === k);
            if (existing) {
                const capped = Math.min(existing.quantity + qty, cap);
                return prev.map((i) => (itemKey(i) === k ? { ...i, quantity: capped, stock: cap, price } : i));
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
                    quantity: Math.min(qty, cap),
                    stock: cap,
                    preorder,
                    // For the festive offer preview: hampers don't earn it.
                    product_type: book.product_type || "book",
                    pod,
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
        // Coupon vs festive promotion: the better of the two, never both —
        // the same rule the server applies (promotions_core.py). This is a
        // preview; the order endpoint decides.
        const couponOff = coupon && subtotal > 0 ? Math.min(coupon.discount, subtotal) : 0;
        const promoOff = promoDiscount(promo, items, subtotal);
        const discountSource = promoOff <= 0 && couponOff <= 0 ? "" : promoOff >= couponOff ? "promo" : "coupon";
        const discount = discountSource === "promo" ? promoOff : couponOff;
        const promoShort = promo && promo.min_order > subtotal ? Math.ceil(promo.min_order - subtotal) : 0;
        const discounted = Math.max(0, subtotal - discount);
        const shipping = discounted === 0 ? 0 : discounted > freeThr ? 0 : shipFlat;
        const tax = Math.round((discounted * taxPct) / 100);
        const total = discounted + shipping + tax;
        // A cart with a print-on-demand book ships together, in 5–7 working days.
        const hasPod = items.some((i) => i.pod);
        const podWindow = hasPod && podSchedule ? dispatchWindow(Date.now(), podSchedule.holidays) : null;
        return { subtotal, discount, shipping, tax, total, count, taxPct, couponOff, promoOff, discountSource, promoShort, hasPod, podWindow };
    }, [items, coupon, settings, promo, podSchedule]);

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
            promo,
            podSchedule,
            itemKey,
            ...totals,
        }),
        [items, isOpen, addItem, removeItem, updateQty, clear, coupon, setCoupon, clearCoupon, settings, site, promo, podSchedule, totals],
    );

    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error("useCart must be used inside CartProvider");
    return ctx;
};
