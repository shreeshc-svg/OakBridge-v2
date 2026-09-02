# Fixing CLS on mobile — plan

**Status:** proposal, nothing built yet
**Symptom:** Search Console, Core Web Vitals → Mobile: **56 URLs with CLS > 0.25 (Poor)**. LCP is fine (0 URLs).

---

## 1. What I ruled out first

**Images.** The usual cause. Not this. Every book cover reserves its space through
an `aspect-ratio` wrapper. On a book page, 16 images: 14 reserve space, and the
2 that don't are both the 83×64 logo — far too small to move CLS.

**Fonts.** Already loaded with `display=optional`, which cannot reflow text. The
sanity gate has enforced this for a while.

**Slow API.** LCP is 0 URLs poor. The pages arrive quickly. This is not a speed
problem, it is a *stability* problem.

---

## 2. What it actually is

Every page load throws **three `React error #418`** — *"hydration failed because
the server rendered HTML didn't match the client."* When React cannot hydrate,
it discards the server HTML for that subtree and re-renders it client-side. On a
prerendered page that means the visible content is thrown away and redrawn after
it has already painted. That is a large layout shift, on every page, every load.

### Why the mismatch is guaranteed, not occasional

Three facts about how this app is built, which are individually reasonable and
collectively fatal:

1. **`prerender.js` renders each route in a real browser (puppeteer)** and saves
   the finished HTML — including all the data it fetched. `/` is 195 KB, `/books`
   is 105 KB, a book page is 91 KB. That is fully-populated content, not a shell.

2. **`index.js` calls `hydrateRoot`** when `#root` has children, which it always
   does on a prerendered route.

3. **Every page fetches its data in `useEffect`.** All 20 public pages do this —
   `Home.jsx` alone calls seven endpoints. So the client's *first* render, the one
   React hydrates against, has **no data at all**.

So React compares a fully-rendered page against an empty one. It cannot match.
This happens on every prerendered URL regardless of whether any data changed.

### Two smaller offenders on top

Worth naming because they would still mismatch even after the main fix:

- **Countdown timers** (`useCountdown`) render `4d 05h 40m`. Baked at build time,
  re-rendered at load time — mathematically incapable of matching.
- **The cookie banner** is captured *visible* in the prerender, because the
  prerender browser has no saved consent. A returning visitor renders it hidden.

### Why the trend is worsening

Data drift compounds it. The prerendered HTML is a snapshot from the last Vercel
build; the client fetches live. Verified examples: prerendered `/books` says
*"Business & General 30"* where live says 29, and labels Sacred Tiger Tales
*"General"* where it is now *Coffee Table*. The taxonomy split and the 89 eBook
links and prices on 31 Aug – 1 Sep changed data on most book cards.

---

## 3. Why the cheap fixes don't work

**"Just fix the countdown and the consent banner."** They are symptoms. The
empty-first-render mismatch remains and dominates.

**"Use `createRoot` instead of `hydrateRoot`."** Then React replaces the DOM
deliberately instead of accidentally. Same shift.

**"Stop prerendering."** Removes the mismatch by removing the content. Crawlers
would get an empty shell. This site has invested in prerendering for SEO; giving
that up to fix a layout metric is a bad trade.

There is no way to have prerendered content paint early *and* a different first
client render *without* a shift. The only real fix is to make them equal.

---

## 4. The fix: seed the first render from build-time data

Make the client's first render produce exactly what the prerender produced, then
refresh from the API afterwards.

**During prerender.** `page.evaluateOnNewDocument` sets `window.__PRERENDERING__`.
`lib/api.js` sees the flag and records every GET response into a map keyed by
request URL. After the page settles, the script serialises that map into a
`<script>window.__PRELOAD__ = {...}</script>` in the saved HTML.

**On the client.** One hook:

```js
const [books, setBooks] = usePreloaded("/books?limit=24", fetchBooks, []);
```

- If `__PRELOAD__` has the key, that is the initial state — first render matches
  the prerendered HTML exactly, hydration succeeds, nothing shifts.
- If not (a client-side route change, or a page we did not prerender), it behaves
  exactly as today: fallback value, fetch in an effect.
- Either way it revalidates after mount, so the page is never stale.

### Scope

| Piece | Work |
|---|---|
| `lib/preload.js` — the store and the `usePreloaded` hook | new, small |
| `lib/api.js` — record responses when prerendering | ~15 lines |
| `scripts/prerender.js` — serialise the map into the HTML | ~25 lines |
| Page call sites | ~40 across 20 pages, mechanical |
| `useCountdown` — stable first render, live value after mount | small |
| Cookie banner — not captured by the prerender | small |

### Cost

Measured, not estimated:

| Page | HTML now | Preload adds | Gzipped |
|---|---|---|---|
| `/` | 195 KB | 33 KB | ~6 KB |
| `/books` | 105 KB | 54 KB | ~8 KB |

JSON compresses well, so the real transfer cost is single-digit KB. Worth
watching that it does not push LCP, which is currently healthy.

### Risk

Revalidation can still move something if live data has changed since the build —
a price, a stock line. That is a *small* shift instead of a whole-page redraw,
and it can be reduced further by only setting state when the payload actually
differs.

---

## 5. Suggested order

**Phase 1 — the templates that own the 56 URLs.** Book pages (194 of them),
`/books`, and `/`. Plus the countdown and consent fixes, since they would still
mismatch. This should move the number on its own.

**Phase 2 — the remaining 17 public pages.** Same hook, mechanical.

**Phase 3 — only if needed.** Suppress no-op revalidation updates.

---

## 6. How we verify

**Immediately:** PageSpeed Insights / Lighthouse on a specific URL, before and
after. Lab CLS should go to ~0. Also: the three `#418` errors in the console
should disappear — that is the crisp pass/fail signal, and it needs no waiting.

**Eventually:** Search Console is *field* data on a 28-day rolling window. Even a
perfect fix will not move that chart for weeks. Do not judge the work by it.

---

## 7. Decision needed

- Proceed with Phase 1?
- Or start with just the countdown + consent fixes to see the console go quiet on
  pages without data, which is a half-hour job and proves the diagnosis before
  committing to the bigger change?

I would do the second first. It is cheap, it is needed regardless, and it
validates the mechanism before ~40 call sites are touched.
