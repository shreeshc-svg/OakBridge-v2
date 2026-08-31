/**
 * The two decisions behind the bookstore's "a filter is already on" notice.
 *
 * They live here, as plain functions with no React in them, because both are
 * easy to get subtly wrong and neither is observable from the outside once it
 * is tangled into a component: a notice that fires for a visitor who chose the
 * category themselves just looks like a notice, and a count that is off by the
 * size of one category just looks like a number. Pulled out, they can be tested
 * against the cases that actually matter.
 */

/**
 * Should the notice appear at all?
 *
 * Yes only when THIS page applied the default. A visitor who clicked Academic,
 * or arrived on a campaign link that already carried a category, is being told
 * about their own decision — which is noise, and noise is how a useful strip
 * becomes wallpaper. A search is an explicit intent too, and the search path
 * drops the category anyway, so there is nothing left to announce.
 *
 * @param {object}  o
 * @param {boolean} o.autoFiltered  the page set the category itself on mount
 * @param {object}  o.activeCat     the category currently applied, if any
 * @param {string}  o.search        the active search term
 * @param {boolean} o.dismissed     the visitor has closed it before
 */
export function shouldShowFilterNotice({ autoFiltered, activeCat, search, dismissed }) {
    if (!autoFiltered) return false;
    if (dismissed) return false;
    if (!activeCat || !activeCat.name) return false;
    if (search) return false;
    return true;
}

/**
 * How many titles sit outside the applied filter — or null when we cannot say.
 *
 * Null is the important return. Category counts arrive from /categories a beat
 * after first paint, so a naive subtraction renders "0 more titles" in the gap:
 * a sentence that both contradicts the sidebar and tells the visitor there is
 * nothing to see, which is the exact opposite of the point. Anything that is
 * not a positive whole number becomes null, and the component then says "more
 * titles" with no figure at all.
 *
 * @param {number} total  every title across every category
 * @param {number} shown  titles inside the applied category
 * @returns {number|null}
 */
export function remainingOutsideFilter(total, shown) {
    const t = Number(total);
    const s = Number(shown);
    if (!Number.isFinite(t) || !Number.isFinite(s)) return null;
    const rest = Math.trunc(t - s);
    return rest > 0 ? rest : null;
}

/**
 * Total across the sidebar's own category counts.
 *
 * Summing the numbers already on screen is deliberate: the notice and the
 * sidebar can then never disagree, and adding a title to the catalogue updates
 * both without anyone editing a string.
 */
export function catalogueTotalFrom(cats) {
    if (!Array.isArray(cats)) return 0;
    return cats.reduce((n, c) => n + (Number(c && c.book_count) || 0), 0);
}
