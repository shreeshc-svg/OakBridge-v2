# Prerendering — rollout and verification

## The problem this solves

Every route served the same HTML: the CRA shell, with the homepage's title and
canonical, and a body reading "You need to enable JavaScript to run this app."
Google renders JavaScript and eventually sees the real page. Bing, LinkedIn,
WhatsApp, X and most AI crawlers do not — they index the shell, or nothing.

`yarn build:seo` runs the normal build, then loads every route in a real browser
and writes the rendered HTML to `build/<route>/index.html`. Vercel serves a
matching file before it consults `rewrites`, so a crawler gets real HTML while
the SPA still hydrates and behaves exactly as before.

## What changed

| File | Change |
|---|---|
| `vercel.json` | `buildCommand` → sanity check, install Chromium, `yarn build:seo`. Catch-all rewrite now targets `/app-shell.html`. `BACKEND_URL` set for route discovery. |
| `package.json` | `build` also writes the app shell; `build:seo` chains off it |
| `scripts/app-shell.js` | new — publishes `build/app-shell.html`, the neutral SPA fallback |
| `scripts/prerender.js` | rewritten: fails loudly, parallel, robust waits, serves the shell from memory |
| `scripts/sanity-check.js` | new — static gate, run on commit and in the build |
| `.githooks/pre-commit` | new — runs the gate before every commit |
| `.puppeteerrc.cjs` | new — keeps Chromium inside the project (locality, *not* caching) |
| `public/index.html` | page-level `<title>`/canonical/OG removed — they would duplicate |
| `pages/BookDetail.jsx` | absolute cover URLs, www hosts, `offers` block removed |
| `pages/Authors.jsx` | author detail gained a `<Seo>` — it was the only untitled route |
| `pages/admin/AdminLayout.jsx` | supplies its own tab title, now that index.html doesn't |

## Verify on the preview deployment — do not merge before this passes

Vercel builds a preview for the `seo/prerender` branch. Production keeps using
the `Oak-v2-UAT` config until this is merged, so nothing below can affect the
live shop.

**1. The build finished, and did the work.** In the Vercel build log:

```
Discovered 194 book routes.
Discovered NN author routes.
  208/208 rendered
Prerendered 208/208 routes in NNNs.
```

Zero books, or a "Prerender failed" line, means it stopped on purpose — read the
message. The script now refuses to publish a catalogue-free build rather than
succeeding quietly, which is what the old version did on every Vercel build.

**2. Real HTML reaches a crawler.**

```
curl -s https://<preview>.vercel.app/books | grep -o '<title>[^<]*</title>'
curl -s https://<preview>.vercel.app/books | grep -c 'data-testid="catalog'   # want >= 1
```

The title must name the Bookstore, not the homepage.

> Do **not** test for the absence of "You need to enable JavaScript". That text
> lives in a `<noscript>`, which survives serialisation and appears in every
> correctly prerendered page. Its presence proves nothing either way; the
> presence of real markup is what to check.

**3. Exactly one canonical, and one title.** The failure mode most likely to
bite, because React appends head tags rather than replacing them:

```
curl -s https://<preview>.vercel.app/books | grep -o 'rel="canonical"' | wc -l   # want 1
curl -s https://<preview>.vercel.app/books | grep -o '<title' | wc -l            # want 1
```

> `grep -c` counts matching *lines*, not matches. Minified HTML puts the whole
> head on one line, so `grep -c` returns 1 whether there is one canonical or
> five — it cannot detect the very thing this step exists to catch. Use
> `grep -o | wc -l`.

Two canonicals is worse than the single wrong canonical we had before: Google
discards a page with conflicting canonicals rather than picking one.

**4. A book page carries its structured data.**

```
curl -s https://<preview>.vercel.app/books/<id> | grep -o 'application/ld+json' | wc -l
```

Expect 4: Organization and WebSite from index.html, plus Book and
BreadcrumbList from the page. Confirm there is no `offers` block — see below.

**4b. The SPA fallback is a neutral shell, not the homepage.**

```
curl -s https://<preview>.vercel.app/cart | grep -o '<title[^>]*>[^<]*' | head -1
```

Must **not** return the homepage title. `/cart` is not prerendered, so it falls
through to `/app-shell.html`. If that file were the prerendered homepage,
every un-prerendered URL — cart, checkout, account, admin, all 404s — would
serve homepage markup with a homepage canonical.

**5. Build time is tolerable.** Note the figure from step 1. It is paid on every
deploy from now on. Above roughly ten minutes, raise `PRERENDER_CONCURRENCY`.

**6. The site still works as a site.** Click through the preview: navigation,
search, add to cart. Prerendered HTML hydrates into the same app, but hydration
mismatches are the classic way this breaks, and they are invisible to curl.

## Why book pages no longer publish a price to Google

Prerendered HTML is frozen at build time. Price and stock are exactly the fields
that change without a deploy, so an `Offer` block in prerendered output states
last-deploy figures indefinitely. A search result advertising a price we no
longer charge is a consumer-protection problem in India, not just an SEO one,
and "InStock" on a sold-out title buys a cancelled order and a refund.

Google therefore shows no price rich-result for these pages. That is the
intended outcome: no claim beats a wrong claim. If price in search becomes
worth having, the fix is a deploy hook triggered by price changes — not
restoring the block.

## Check this BEFORE deploying

`REACT_APP_BACKEND_URL` must be set in the Vercel project for the preview
environment. CRA bakes it in at build time. If it is missing or wrong, every
page renders its not-found branch during prerendering, `document.title` never
gets set, all ~208 routes time out at 15s each, and the build fails at the 10%
gate — after burning about ten minutes. It is not in `vercel.json`, so it must
already exist in project settings. Confirm it does.

Related: Vercel's Root Directory is `frontend`, so `backend/` is not present
during the build. The sanity check reports the Python and route-parity checks
as *warnings* there rather than passing silently — if you see those two lines
marked `warn` in the Vercel log, that is expected. Locally they run properly.

## Known gaps after this ships

- **New books are not prerendered until the next deploy.** They work normally
  for people (the SPA fallback handles them) and they are in the sitemap
  immediately, but crawlers see the shell until a rebuild. A weekly scheduled
  deploy would close this.
- **Still no genuine 404 status.** Unknown URLs render the 404 page with HTTP
  200 — a soft 404. The `noindex` on that page is what makes it work.
- **`/book/<slug>` legacy URLs still blanket-redirect** to `/books`. The 1:1
  slug map is a separate job.
