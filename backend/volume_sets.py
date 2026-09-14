"""
Multi-volume sets — one book record, several volumes.

WHY A FLAG, AND NOT A PRODUCT TYPE, AND NOT A SECOND COLLECTION

A volume is never sold on its own. It has no price, no cart line, no order
line and no stock of its own, so it is not a product — it is a row in the
specifications table. The purchasable thing is the SET, and a set is an
ordinary book: one ISBN, one price, one stock count, one cover, one
description.

So this is a boolean on db.books. Not product_type="volume_set", and not a
collection of its own. It is the same argument the hamper flag makes one level
further down: cart, Razorpay, orders, stock, invoices, coupons, search, the
sitemap, the CSV export and Admin → Orders all keep seeing a book, and not one
of them has to learn a new shape. A separate admin screen would have meant
maintaining a second copy of the book form on a live store, and the second copy
is the one that stops getting the new fields.

It also keeps ISBN unique, which is load-bearing in two places that do not
announce themselves: inventory_sync.py matches stock with
find_one({"isbn": isbn}), and the eBook price-list uploader matches the same
way. Three volume records sharing one ISBN — which is what the publisher
actually prints on them — would have made both of those ambiguous, and
ambiguous in the silent direction: first match wins, no error.

THE PAGE COUNT IS DERIVED, NEVER TYPED

`pages` on the set is the sum of the volumes' pages. It is stored AND
recomputed on read:

  - stored, because the CSV export and the inventory export read raw documents
    straight out of Mongo and never pass through the API's response models;
  - recomputed in _decorate_book, which is the one function every book response
    already passes through, because the bulk CSV importer writes `pages` from a
    column. A hand-edited backup could therefore put a total into Mongo that
    disagrees with the volumes stored beside it.

Deriving on the way out means the product page can never print a total that
contradicts the per-volume rows printed directly underneath it. That is the
whole reason the total is not simply another number the admin types.
"""
from __future__ import annotations

from typing import Any

# Two, because a "set" of one is a book. The admin ticking the box and adding a
# single volume is a half-finished entry, and shipping it would put "Set of 1
# volume" on a product card.
MIN_VOLUMES = 2

# Runaway guard on a list that comes from a form. Nothing in the catalogue is
# near this; it exists so a malformed payload cannot make a 10,000-row spec table.
MAX_VOLUMES = 50


def _int(value: Any, default: int = 0) -> int:
    """Coerce a form value to int. Number inputs arrive as strings, and blank
    arrives as "" — both have to land on a number rather than raising."""
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def normalise(raw: Any) -> list[dict]:
    """Coerce whatever the admin form sent into clean volume rows.

    Volumes are RENUMBERED 1..n rather than trusting `no` from the client. The
    repeater lets a row be deleted from the middle, and a set that lists
    "Volume 1, Volume 3" is an artefact of that deletion, not a fact about the
    book. Renumbering here means no other code has to wonder.

    Entirely blank rows are dropped rather than rejected: clicking "+ Add
    volume" one time too many is not an error worth a red toast.
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw[:MAX_VOLUMES]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        blurb = str(item.get("blurb") or "").strip()
        pages = max(0, _int(item.get("pages"), 0))
        if not title and not blurb and pages == 0:
            continue
        out.append(
            {"no": len(out) + 1, "title": title, "pages": pages, "blurb": blurb}
        )
    return out


def total_pages(volumes: Any) -> int:
    """The set's page count: the sum of its volumes."""
    if not isinstance(volumes, list):
        return 0
    return sum(
        max(0, _int(v.get("pages"), 0)) for v in volumes if isinstance(v, dict)
    )


def validate(is_set: bool, volumes: list[dict]) -> str | None:
    """Return a human error string, or None when the set is well-formed.

    Only enforced when the box is ticked. An ordinary book may carry leftover
    volume rows from a set that was unticked — they are kept rather than wiped,
    so that re-ticking restores them, and every display path keys off the flag
    rather than off the rows being present.
    """
    if not is_set:
        return None
    if len(volumes) < MIN_VOLUMES:
        return (
            f"A volume set needs at least {MIN_VOLUMES} volumes. "
            "Add another volume, or untick “This is a volume set”."
        )
    blank = [str(v.get("no")) for v in volumes if _int(v.get("pages"), 0) <= 0]
    if blank:
        return (
            "Every volume needs a page count — the set's total is the sum of "
            f"them. Missing on volume {', '.join(blank)}."
        )
    return None


def apply(doc: dict | None) -> dict | None:
    """Normalise the volumes and derive `pages` from them, in place.

    A no-op on anything that is not a ticked set, so it is safe to call on
    every book document unconditionally — which is exactly how _decorate_book
    calls it.
    """
    if not isinstance(doc, dict) or not doc.get("is_volume_set"):
        return doc
    volumes = normalise(doc.get("volumes"))
    doc["volumes"] = volumes
    if volumes:
        doc["pages"] = total_pages(volumes)
    return doc
