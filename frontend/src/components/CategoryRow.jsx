import React, { useEffect, useRef } from "react";

/**
 * The bookstore's categories, as a row above the books instead of a list beside
 * them.
 *
 * They used to sit in the left sidebar, which on a phone means behind a
 * "Filters" button that most visitors never press — so the single most useful
 * thing about the shop, the fact that it has a Law shelf and a Tax shelf, was
 * invisible on the device most people arrive on. Up here it is the first thing
 * under the hero on every width.
 *
 * A CATEGORY WITH NO TITLES DOES NOT APPEAR. Coffee Table and Bespoke exist in
 * the taxonomy before they have stock, and a tab that opens an empty shelf is
 * worse than no tab: it advertises a gap. Assigning one book in Admin makes the
 * tab appear by itself, because the count comes from the same live query the
 * old sidebar used. "All" is exempt, since it is not a category.
 *
 * It scrolls sideways rather than wrapping. Two ragged lines of categories read
 * as a mess; one line that runs off the edge reads as navigation, which is what
 * this is.
 */
/*
 * Declared OUTSIDE CategoryRow on purpose.
 *
 * A component defined in a render body gets a new function identity every
 * render, so React sees a changed element *type* and unmounts and remounts it
 * rather than updating it. For a row of buttons that re-renders on every
 * selection, that means the button a keyboard user just activated is destroyed
 * underneath them: focus falls to document.body and they tab from the top of
 * the page again. It also throws away the hover transition mid-animation.
 */
function Tab({ id, label, count, isOn, onSelect, innerRef }) {
    return (
        <button
            type="button"
            ref={innerRef}
            onClick={() => onSelect(id)}
            aria-current={isOn ? "true" : undefined}
            data-testid={`category-tab-${id || "all"}`}
            className={`flex-shrink-0 flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 pt-1 min-h-[44px] sm:min-h-0 text-sm transition-colors ${
                isOn
                    ? "border-[#002B5C] text-[#002B5C] font-semibold"
                    : "border-transparent text-[#4B5563] hover:text-[#002B5C]"
            }`}
        >
            {label}
            {count != null && (
                <span className="font-mono text-[10px] text-[#9CA3AF]">{count}</span>
            )}
        </button>
    );
}

export default function CategoryRow({ cats, active, onSelect, total }) {
    const railRef = useRef(null);
    const activeRef = useRef(null);

    const shown = (cats || []).filter((c) => (Number(c.book_count) || 0) > 0);

    // Arriving on /books?category=bespoke with the tab off-screen looks like the
    // tab is missing. Bring it into view — but only along the rail, never by
    // scrolling the page, which would jump the visitor past the hero.
    //
    // `shown.length` IS a dependency, not noise. On the first render cats is
    // still empty, so no tab carries the ref and this returns early; the
    // categories then arrive without `active` changing, and keyed on [active]
    // alone the effect would never run again — missing the deep-link case that
    // is the only reason it exists.
    useEffect(() => {
        const el = activeRef.current;
        const rail = railRef.current;
        if (!el || !rail) return;
        const left = el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2;
        rail.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    }, [active, shown.length]);

    return (
        <div className="relative border-b border-[#E5E7EB] mb-6" data-testid="category-row">
            <div
                ref={railRef}
                // `.scrollbar-none` is defined in index.css for WebKit; these two
                // are the Firefox and IE equivalents, which have no class form.
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                className="flex gap-6 sm:gap-7 overflow-x-auto scrollbar-none"
            >
                {/*
                 * "All" lights up whenever nothing else can. A visitor sitting on
                 * a category that has just been emptied — or on a retired id like
                 * ?category=professional — has no tab of their own, and a row
                 * with nothing highlighted reads as broken.
                 */}
                <Tab
                    id=""
                    label="All"
                    count={total || null}
                    isOn={!shown.some((c) => c.id === active)}
                    onSelect={onSelect}
                    innerRef={shown.some((c) => c.id === active) ? null : activeRef}
                />
                {shown.map((c) => (
                    <Tab
                        key={c.id}
                        id={c.id}
                        label={c.name}
                        count={c.book_count}
                        isOn={active === c.id}
                        onSelect={onSelect}
                        innerRef={active === c.id ? activeRef : null}
                    />
                ))}
            </div>
            {/* Fades the last tab out rather than clipping it, so it is obvious
                the row continues. Hidden from lg up, where everything fits. */}
            <div className="pointer-events-none absolute right-0 top-0 bottom-px w-10 bg-gradient-to-r from-transparent to-white lg:hidden" />
        </div>
    );
}
