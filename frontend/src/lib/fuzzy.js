/**
 * Typo-tolerant matching for the storefront search.
 *
 * The search logs showed real customers typing "cconstitution", "constition"
 * and "intermidiaries" and getting an empty shelf — three lost sales from three
 * slips of the keyboard. Exact matching (even punctuation-tolerant) cannot
 * recover those, so when a search returns nothing we fall back to comparing the
 * query against the catalogue index with a small edit-distance budget.
 *
 * Runs in the browser against the already-cached title/author index, so it costs
 * no extra request and never delays a search that did find something.
 */

/** Case/punctuation-folded form used for all comparisons. */
export const fold = (s) =>
    (s || "")
        .toLowerCase()
        .replace(/['']/g, "'")
        .replace(/\s*&\s*/g, " and ")
        .replace(/[^0-9a-z ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Levenshtein distance, abandoned early once it exceeds `max`.
 * Bailing out keeps this cheap across a few hundred titles.
 */
function editDistance(a, b, max = 2) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        let best = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (cur[j] < best) best = cur[j];
        }
        if (best > max) return max + 1; // no cell in this row can still win
        prev = cur;
    }
    return prev[b.length];
}

/** How much slack a word of this length earns. Short words get none. */
const budget = (w) => (w.length <= 4 ? 0 : w.length <= 7 ? 1 : 2);

/** Does `word` appear in `haystackWords`, allowing for a typo? */
function wordMatches(word, haystackWords) {
    const allow = budget(word);
    for (const h of haystackWords) {
        if (h.includes(word)) return true;
        // plural/singular
        if (word.endsWith("s") && h.includes(word.slice(0, -1))) return true;
        if (h.endsWith("s") && h.slice(0, -1).includes(word)) return true;
        if (allow > 0 && editDistance(word, h, allow) <= allow) return true;
    }
    return false;
}

/**
 * Books whose title or author plausibly match `query` despite typos.
 * `books` is the suggest index: [{ id, t, a, c }].
 */
export function fuzzySearch(books, query, limit = 12) {
    const words = fold(query).split(" ").filter(Boolean);
    if (!words.length) return [];

    const scored = [];
    for (const b of books) {
        const hay = `${fold(b.t)} ${fold(b.a)}`;
        const hayWords = hay.split(" ").filter(Boolean);
        let hits = 0;
        let exact = 0;
        for (const w of words) {
            if (hay.includes(w)) {
                hits += 1;
                exact += 1;
            } else if (wordMatches(w, hayWords)) {
                hits += 1;
            }
        }
        // Require most of the query to land, so a single common word like "law"
        // cannot drag in half the catalogue.
        const needed = words.length <= 2 ? words.length : Math.ceil(words.length * 0.7);
        if (hits >= needed) scored.push({ book: b, hits, exact });
    }

    scored.sort((x, y) => y.hits - x.hits || y.exact - x.exact);
    return scored.slice(0, limit).map((s) => s.book);
}

/**
 * The closest single phrase to show as "Did you mean …".
 * Returns null when nothing is close enough to be worth suggesting.
 */
export function didYouMean(books, query) {
    const words = fold(query).split(" ").filter(Boolean);
    if (!words.length) return null;

    const corrected = [];
    let changed = false;
    const vocab = new Set();
    for (const b of books) {
        for (const w of `${fold(b.t)} ${fold(b.a)}`.split(" ")) if (w) vocab.add(w);
    }

    for (const w of words) {
        if (vocab.has(w)) {
            corrected.push(w);
            continue;
        }
        const allow = budget(w);
        let best = null;
        let bestD = allow + 1;
        if (allow > 0) {
            for (const v of vocab) {
                const d = editDistance(w, v, allow);
                if (d < bestD) {
                    bestD = d;
                    best = v;
                }
            }
        }
        if (best) {
            corrected.push(best);
            changed = true;
        } else {
            corrected.push(w);
        }
    }
    return changed ? corrected.join(" ") : null;
}
