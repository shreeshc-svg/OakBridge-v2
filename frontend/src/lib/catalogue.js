/**
 * How many titles the bookstore sells, all told.
 *
 * Summed from the same per-category counts the row above the grid prints, so
 * the "All" tab can never disagree with the tabs beside it, and adding a title
 * updates both without anyone editing a number.
 *
 * (This module is what is left of lib/filterNotice.js. The bookstore used to
 * open on a pre-applied Professional filter and needed a strip explaining that;
 * the visible category row replaced both the default and the explanation.)
 */
export function catalogueTotalFrom(cats) {
    if (!Array.isArray(cats)) return 0;
    return cats.reduce((n, c) => n + (Number(c && c.book_count) || 0), 0);
}
