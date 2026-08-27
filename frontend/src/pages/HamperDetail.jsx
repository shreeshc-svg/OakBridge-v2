import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingBag, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { breadcrumbLd, metaDescription } from "../lib/schema";
import { getHamper, formatINR, mediaUrl } from "../lib/api";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";

/**
 * The hamper product page.
 *
 * Not a book page with the specs hidden. A book sells on its author and its
 * contents; a hamper sells on what is in the box, what the box would cost if
 * you bought it piece by piece, and whether it will arrive in time. So the
 * specs strip (ISBN, pages, binding, edition) is replaced by the contents
 * list, a value line and a delivery line.
 *
 * Every visible string here comes from `hamper_copy`, filled server-side from
 * defaults in hampers.py. Nothing user-facing is written into this file, so
 * fixing a typo on a live seasonal page is an edit in Admin, not a deploy.
 */

/** {value} and {stock} substituted late, so an admin can move them mid-sentence. */
const fill = (tpl, vars) =>
    String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

function ContentsRow({ item, badge }) {
    const img = (item.image || "").trim();
    return (
        <div className="flex gap-4 py-3.5 border-b border-[#E5E7EB] items-center">
            {/*
              * A fixed 46x62 for every line, cropped to fill.
              *
              * These sit in a column beside book covers, which are all roughly
              * the same portrait shape. A scrunchie photographed square and a
              * carry bag photographed landscape, left at their own aspect
              * ratios, make every row a different height and the list stops
              * reading as a list. The placeholder is the same size for the same
              * reason — a row with no picture must not be shorter than its
              * neighbours.
              */}
            {img ? (
                <img
                    src={mediaUrl(img)}
                    alt={item.label || "Item in this hamper"}
                    className="w-[46px] h-[62px] shrink-0 object-cover object-center border border-[#E5E7EB]"
                />
            ) : (
                <div
                    aria-hidden="true"
                    className="w-[46px] h-[62px] shrink-0 bg-[#F5F7FA] border border-[#E5E7EB]"
                />
            )}
            <div className="min-w-0">
                <div className="text-sm font-semibold leading-snug text-[#002B5C]">
                    {item.label}
                    {item.is_book && badge && (
                        <span className="ml-2 text-[9px] font-mono tracking-widest uppercase text-[#002B5C] border border-[#E5E7EB] px-1.5 py-0.5">
                            {badge}
                        </span>
                    )}
                    {item.missing && (
                        <span className="ml-2 text-[10px] text-[#CC0033]">unavailable</span>
                    )}
                </div>
                {item.note && <div className="text-xs text-[#4B5563] mt-0.5">{item.note}</div>}
            </div>
            <div className="ml-auto text-sm text-[#4B5563] whitespace-nowrap">
                {Number(item.value) > 0 ? formatINR(item.value) : "Included"}
            </div>
        </div>
    );
}

export default function HamperDetail({ id }) {
    const [h, setH] = useState(null);
    const [err, setErr] = useState(false);
    const [qty, setQty] = useState(1);
    const [shot, setShot] = useState(0);
    const [gift, setGift] = useState({ message: "", recipient: "" });
    const { addItem } = useCart();
    const { isAuthenticated } = useAuth();

    useEffect(() => {
        let live = true;
        getHamper(id)
            .then((d) => live && setH(d))
            .catch(() => live && setErr(true));
        return () => {
            live = false;
        };
    }, [id]);

    const copy = h?.hamper_copy || {};
    const shots = useMemo(() => {
        const all = [h?.cover_image, ...(h?.gallery || [])].filter(Boolean);
        return all.length ? all : [];
    }, [h]);

    const stock = Number(h?.stock ?? 0);
    const oos = stock <= 0;
    // Shown only when it is actually scarce. "Only 40 left" on a run of 40 is
    // not urgency, it is arithmetic, and customers read it as a gimmick.
    const scarce = !oos && stock <= 15;

    /*
     * The struck-through figure, and where it came from.
     *
     * An explicit list price wins over the sum of the contents. Both are honest
     * claims but they answer different questions — "this is what the box used to
     * cost" versus "this is what the pieces come to separately" — and showing
     * both would make the customer arbitrate. When an admin has typed a list
     * price they have made that decision; when they have not, the contents sum
     * is the better answer than no answer.
     *
     * `basis` travels with the number because the sentence under it only makes
     * sense for one of the two. A struck MRP explains itself; "bought
     * separately, the contents come to..." does not describe an MRP at all.
     */
    const savings = useMemo(() => {
        const price = Number(h?.price || 0);
        const listed = Number(h?.original_price || 0);
        const contents = Number(h?.contents_value || 0);
        const full = listed > price ? listed : contents;
        const basis = listed > price ? "list" : "contents";
        if (!full || full <= price) return null;
        return { full, basis, amount: full - price, pct: Math.round((1 - price / full) * 100) };
    }, [h]);

    const orderBy = useMemo(() => {
        if (!h?.order_by) return null;
        const d = new Date(h.order_by);
        if (Number.isNaN(d.getTime())) return null;
        // Past its own cut-off, the promise is withdrawn rather than left to
        // mislead — the product stays buyable, the deadline does not.
        if (d.getTime() < Date.now()) return null;
        return d.toLocaleDateString("en-IN", { day: "numeric", month: "long" });
    }, [h]);

    if (err) {
        return (
            <div className="max-w-3xl mx-auto px-7 py-24 text-center">
                <h1 className="font-serif text-3xl text-[#002B5C]">We couldn't find that hamper</h1>
                <Link to="/gifting" className="inline-block mt-6 text-sm text-[#002B5C] border-b border-[#002B5C]">
                    See what else is available
                </Link>
            </div>
        );
    }
    if (!h) return <div className="max-w-6xl mx-auto px-7 py-24 text-[#4B5563]">Loading…</div>;

    const onAdd = (thenCheckout) => {
        addItem(
            {
                id: h.id,
                title: h.title,
                author: "",
                cover_image: h.cover_image,
                price: h.price,
            },
            qty,
        );
        if (!thenCheckout) {
            toast.success(`${h.title} added to your cart.`);
            return;
        }
        if (isAuthenticated) window.location.assign("/checkout");
        else window.location.assign("/login");
    };

    return (
        <div className="max-w-6xl mx-auto px-7 py-10" data-testid="hamper-detail">
            <Seo
                title={`${h.title} — Oakbridge Gifting`}
                description={metaDescription(h.subtitle || h.description || "")}
                path={`/books/${h.id}`}
                image={h.cover_image}
                jsonLd={breadcrumbLd([
                    { name: "Gifting", path: "/gifting" },
                    { name: h.title },
                ])}
            />
            <Breadcrumbs
                inset
                items={[{ label: "Gifting", to: "/gifting" }, { label: h.title }]}
            />

            <div className="grid lg:grid-cols-[minmax(0,1fr)_440px] gap-14 mt-6">
                {/* ---------- photography ---------- */}
                <div>
                    {/*
                      * The photograph IS the frame.
                      *
                      * This used to be a fixed 4:3 box with the image contained
                      * inside it. Product photography is whatever shape the
                      * photographer shot it, so anything not exactly 4:3 sat in
                      * a grey band top and bottom — which reads as an image that
                      * failed to load rather than a deliberate mat.
                      *
                      * The grey box now appears ONLY when there is no photograph,
                      * where it is doing real work: holding the layout open and
                      * saying so. When there is one, the image sets its own
                      * height and there is nothing behind it to show through.
                      */}
                    {shots[shot] ? (
                        <img
                            src={mediaUrl(shots[shot])}
                            alt={`${h.title} — photograph ${shot + 1}`}
                            className="w-full h-auto block border border-[#E5E7EB]"
                        />
                    ) : (
                        <div className="bg-[#F5F7FA] border border-[#E5E7EB] aspect-[4/3] flex items-center justify-center">
                            <span className="text-xs font-mono text-[#9CA3AF] tracking-widest uppercase">
                                No photograph yet
                            </span>
                        </div>
                    )}
                    {shots.length > 1 && (
                        <div className="flex gap-2.5 mt-3">
                            {shots.map((s, i) => (
                                <button
                                    key={s + i}
                                    onClick={() => setShot(i)}
                                    data-testid={`hamper-shot-${i}`}
                                    aria-label={`View photograph ${i + 1}`}
                                    className={`w-[78px] h-[78px] border bg-[#F5F7FA] overflow-hidden ${
                                        i === shot ? "border-2 border-[#002B5C]" : "border-[#E5E7EB]"
                                    }`}
                                >
                                    <img
                                        src={mediaUrl(s)}
                                        alt={`${h.title} thumbnail ${i + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                </button>
                            ))}
                        </div>
                    )}
                    {h.description && (
                        <p className="mt-8 text-sm leading-relaxed text-[#4B5563] whitespace-pre-line">
                            {h.description}
                        </p>
                    )}
                </div>

                {/* ---------- the offer ---------- */}
                <div>
                    <div className="overline">
                        {copy.eyebrow}
                        {h.occasion ? ` · ${h.occasion}` : ""}
                    </div>
                    <h1 className="font-serif text-4xl leading-tight mt-3 text-[#002B5C]">{h.title}</h1>
                    {h.subtitle && <p className="text-[#4B5563] mt-2 leading-relaxed">{h.subtitle}</p>}

                    <div className="flex items-baseline gap-3.5 flex-wrap mt-6">
                        <div className="font-serif text-3xl text-[#002B5C]">{formatINR(h.price)}</div>
                        {savings && (
                            <>
                                <div className="text-[#4B5563] line-through text-sm">
                                    {formatINR(savings.full)}
                                </div>
                                <div className="bg-[#FEF2F2] text-[#CC0033] text-[11.5px] font-semibold font-mono tracking-wider px-2.5 py-1">
                                    SAVE {formatINR(savings.amount)} · {savings.pct}%
                                </div>
                            </>
                        )}
                    </div>
                    {savings?.basis === "contents" && copy.value_note && (
                        <p className="text-xs text-[#4B5563] mt-2">
                            {fill(copy.value_note, { value: formatINR(savings.full) })}
                        </p>
                    )}

                    {scarce && (
                        <div data-testid="hamper-scarce" className="flex items-center gap-2 text-sm text-[#CC0033] font-medium mt-5">
                            <AlertTriangle size={15} strokeWidth={1.5} />
                            {fill(copy.stock_note, { stock })}
                        </div>
                    )}

                    {/* ---------- what's inside ---------- */}
                    {h.hamper_items?.length > 0 && (
                        <div className="mt-7 border-t-2 border-[#002B5C]">
                            <div className="flex justify-between items-baseline pt-3.5 pb-1.5">
                                <div className="overline !text-[10px]">{copy.contents_heading}</div>
                                <div className="overline !text-[10px]">{copy.contents_value_heading}</div>
                            </div>
                            {h.hamper_items.map((it, i) => (
                                <ContentsRow key={i} item={it} badge={copy.contents_badge} />
                            ))}
                        </div>
                    )}

                    {/* ---------- gifting ---------- */}
                    {h.gift_message_enabled && (
                        <div className="mt-6 border border-dashed border-[#F59E0B] bg-[#FFFBEB] p-5">
                            <div className="overline !text-[10px]">{copy.gift_heading}</div>
                            <label className="block text-xs text-[#4B5563] mt-2.5 mb-1.5">
                                {copy.gift_message_label}{" "}
                                <span className="text-[#9CA3AF]">({copy.gift_message_hint})</span>
                            </label>
                            <textarea
                                rows={2}
                                maxLength={200}
                                value={gift.message}
                                onChange={(e) => setGift((g) => ({ ...g, message: e.target.value }))}
                                placeholder={copy.gift_message_placeholder}
                                data-testid="hamper-gift-message"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2.5 text-base md:text-sm resize-none outline-none focus:border-[#002B5C]"
                            />
                            <p className="text-[11px] text-[#4B5563] mt-2.5 leading-relaxed">
                                {copy.deliver_elsewhere_label} — {copy.deliver_elsewhere_note}
                            </p>
                        </div>
                    )}

                    {/* ---------- buy ---------- */}
                    {oos ? (
                        <div className="mt-6 border border-[#E5E7EB] p-5 text-sm text-[#4B5563]">
                            This hamper is sold out.{" "}
                            <Link to="/gifting" className="text-[#002B5C] border-b border-[#002B5C]">
                                See the others
                            </Link>
                        </div>
                    ) : (
                        <div className="flex gap-3 mt-6 flex-wrap items-stretch">
                            <div className="flex border border-[#E5E7EB]">
                                <button
                                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                                    aria-label="Reduce quantity"
                                    className="px-4 text-[#002B5C] disabled:opacity-40"
                                    disabled={qty <= 1}
                                >
                                    −
                                </button>
                                <span className="px-4 py-3.5 border-x border-[#E5E7EB] text-sm min-w-[52px] text-center">
                                    {qty}
                                </span>
                                <button
                                    onClick={() => setQty((q) => Math.min(stock, q + 1))}
                                    aria-label="Increase quantity"
                                    className="px-4 text-[#002B5C] disabled:opacity-40"
                                    disabled={qty >= stock}
                                >
                                    +
                                </button>
                            </div>
                            <button
                                onClick={() => onAdd(false)}
                                data-testid="hamper-add-to-cart"
                                className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 bg-[#002B5C] text-white px-7 py-4 text-sm font-medium hover:bg-[#001F42]"
                            >
                                <ShoppingBag size={16} strokeWidth={1.5} />
                                {copy.add_to_cart_label}
                            </button>
                            <button
                                onClick={() => onAdd(true)}
                                data-testid="hamper-buy-now"
                                className="flex-1 min-w-[140px] border border-[#002B5C] text-[#002B5C] px-7 py-4 text-sm font-medium hover:bg-[#F5F7FA]"
                            >
                                {copy.buy_now_label}
                            </button>
                        </div>
                    )}

                    {/* Honest, and never a promise about a festival. Whatever the
                        occasion, this is what dispatch actually does. */}
                    <p data-testid="hamper-delivery-note" className="text-xs text-[#4B5563] mt-4 leading-relaxed">
                        {orderBy ? `${fill(copy.order_by_label, { date: orderBy })} · ` : ""}
                        {copy.delivery_note}
                    </p>

                    {copy.assurances?.length > 0 && (
                        <div className="grid grid-cols-2 gap-3 mt-6 border-t border-[#E5E7EB] pt-5">
                            {copy.assurances.map((a, i) => (
                                <div key={i} className="text-xs text-[#4B5563] leading-relaxed">
                                    <b className="block text-[#002B5C]">{a.label}</b>
                                    {a.value}
                                </div>
                            ))}
                        </div>
                    )}

                    {h.bulk_enquiry && copy.bulk_heading && (
                        <div className="mt-6 bg-[#F5F7FA] border-l-[3px] border-[#002B5C] px-5 py-4">
                            <div className="font-serif text-base text-[#002B5C]">{copy.bulk_heading}</div>
                            <p className="text-[13px] text-[#4B5563] mt-1.5 leading-relaxed">
                                {copy.bulk_text}{" "}
                                <Link
                                    to={copy.bulk_link || "/contact"}
                                    className="text-[#002B5C] font-semibold border-b border-[#002B5C]"
                                >
                                    {copy.bulk_cta} →
                                </Link>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
