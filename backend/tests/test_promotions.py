"""Festive promotions: the business rules (promotions_core.py) + wiring.

Run: python backend/tests/test_promotions.py
"""
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import promotions_core as pc  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


utc = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)  # noqa: E731
DIWALI = {"label": "Diwali Sale", "message": "Celebrate with books", "kind": "percent", "value": 10, "max_discount": 500,
          "min_order": 999, "starts_at": "2026-10-28", "ends_at": "2026-11-03", "active": True, "banner": True}

print("-- admin input --")
d, e = pc.clean(DIWALI)
check(not e and d["label"] == "Diwali Sale" and d["max_discount"] == 500, "a complete promotion saves")
_, e = pc.clean({**DIWALI, "label": "", "value": 95})
check(any("name" in x for x in e) and any("between 1 and 90" in x for x in e), "missing name / silly % refused")
_, e = pc.clean({**DIWALI, "kind": "flat", "value": 1000, "min_order": 999})
check(any("smaller than the minimum" in x for x in e), "flat off >= minimum order refused")
_, e = pc.clean({**DIWALI, "ends_at": "2026-10-01"})
check(any("after the start" in x for x in e), "end before start refused")
check(pc.clean({**DIWALI, "label": "<b>Diwali</b>"})[0]["label"] == "bDiwali/b", "no markup in the label")
check(pc.clean({**DIWALI, "kind": "flat", "value": 100, "max_discount": 50})[0]["max_discount"] == 0, "a cap only applies to %")

print("-- when it runs (India time) --")
check(pc.is_live(d, utc("2026-10-27T18:30:00")), "starts 28 Oct 00:00 IST (= 27 Oct 18:30 UTC)")
check(not pc.is_live(d, utc("2026-10-27T18:29:00")), "not a minute before")
check(pc.is_live(d, utc("2026-11-03T18:29:00")) and not pc.is_live(d, utc("2026-11-03T18:30:00")), "ends 3 Nov 23:59:59 IST")
check(not pc.is_live({**d, "active": False}, utc("2026-10-30T10:00:00")), "switched off = not live")
check(pc.status(d, utc("2026-10-01T00:00:00")) == "scheduled" and pc.status(d, utc("2026-12-01T00:00:00")) == "ended", "status words")
check(pc.overlaps(d, {**d, "starts_at": "2026-11-03", "ends_at": "2026-11-10"}), "overlapping windows detected")
check(not pc.overlaps(d, {**d, "starts_at": "2026-11-04", "ends_at": "2026-11-10"}), "back-to-back is fine")
check(not pc.overlaps(d, {**d, "active": False}), "an inactive one never blocks")

print("-- the discount --")
items = [{"price": 600, "quantity": 2}, {"price": 649, "quantity": 1, "product_type": "hamper"},
         {"price": 476, "quantity": 1, "preorder": True}, {"price": 1756, "quantity": 1, "product_type": "pack"}]
el = pc.eligible_subtotal(items)
check(el == 2956.0, f"hampers and live pre-orders don't earn it; packs do ({el})")
check(pc.discount(d, el, 4081) == 296.0, "10% of eligible books, whole rupees")
check(pc.discount(d, 9000, 9000) == 500.0, "capped at the max discount")
check(pc.discount(d, 800, 800) == 0.0, "below the minimum order: nothing")
check(pc.discount(d, 500, 1149) == 50.0, "minimum is on the whole cart; % only on the eligible books")
flat = {**d, "kind": "flat", "value": 150, "max_discount": 0}
check(pc.discount(flat, 100, 1200) == 100.0, "flat never more than the eligible books are worth")
check(pc.discount(None, 1000, 1000) == 0.0 and pc.discount(d, 0, 2000) == 0.0, "no promotion / nothing eligible")

print("-- coupon or promotion: the better one, never both --")
check(pc.choose(296, 200) == "promo" and pc.choose(100, 250) == "coupon", "the bigger saving wins")
check(pc.choose(200, 200) == "promo", "a tie keeps the coupon's uses")
check(pc.choose(0, 0) == "", "neither")

print("-- what customers read --")
check(pc.offer_text(d) == "10% off every book, up to ₹500 on orders over ₹999", pc.offer_text(d))
check(pc.offer_text(flat) == "₹150 off your order on orders over ₹999", pc.offer_text(flat))
pv = pc.public_view({**d, "id": "x", "created_by": "admin@x"})
check("created_by" not in pv and pv["label"] == "Diwali Sale" and pv["offer"], "storefront sees no internal fields")

print("-- wiring --")
ROOT = os.path.dirname(os.path.dirname(HERE))
srv = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
check("pcore.choose(promo_off, discount) == \"promo\"" in srv and "discount, coupon_code = promo_off, None" in srv,
      "order endpoint decides on the server; a winning promotion replaces the coupon (no double discount)")
check(('"product_type": 1},' in srv or '"product_type": 1, "pod": 1},' in srv) and "promo_label: Optional[str] = None" in srv, "book type loaded; promo fields declared on Order")
check("app.include_router(promotions_admin_router)" in srv, "routers mounted")
pr = open(os.path.join(ROOT, "backend", "promotions.py"), encoding="utf-8").read()
check('prefix="/api/admin/coupons/promotions"' in pr and "pc.overlaps(doc, other)" in pr, "admin under Coupons permission; overlaps refused")
inv = open(os.path.join(ROOT, "backend", "invoice.py"), encoding="utf-8").read()
check('order.get("promo_label")' in inv, "invoice names the occasion")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
