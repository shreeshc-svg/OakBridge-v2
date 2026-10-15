# "Available on" stores

## Homepage strip (logos only)
1. Admin → Pages → Homepage → **"Available on" stores**.
2. Drop each store's **official logo** on its tile (transparent PNG/SVG, ~80 px tall). Stores without a logo are not shown.
3. **Save stores.** Drag rows (or arrows) to set logo order; untick **Show** to hide one.
4. Heading and scroll speed: the two text rows under the editor.
5. Position on the page / hide the whole strip: Admin → Pages → **Section order & visibility** → "Available on — store logos" (defaults to right under the hero).

The strip scrolls only when the logos don't fit the screen; with "reduce motion" on it never scrolls.

## Book page buttons ("Also available on")
- One book: Admin → Books → edit → **Also available on — store links**. `https://` links only; blank = not sold there.
- Many books: Admin → Pages → "Available on" stores → **Book links in bulk** — CSV/XLSX with an `ISBN` column and one column per store (header = store name or id, e.g. `Amazon`, `Flipkart`, `Kindle`). Preview first, then **Save these links**. Empty cells never erase a link.
- The Oakbridge eReader keeps its own field (eBook edition link) and Read button.

## Store id
The id (e.g. `amazon`) ties a store to every book's link. Rename freely; don't change the id after links are saved.
