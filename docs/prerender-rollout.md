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
| `vercel.json` | `buildCommand` → installs Chromium, then `yarn build:seo`. `BACKEND_URL` set for route discovery. |
| `.puppeteerrc.cjs` | new — pins Chromium inside the project so the build cache keeps it |
| `scripts/prerender.js` | rewritten: fails loudly, parallel, robust waits, 18 static routes |
| `public/index.html` | page-level `<title>`/canonical/OG removed — they would duplicate |
| `pages/BookDetail.jsx` | absolute cover URLs, www hosts, `offers` block removed |
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

**2. Real HTML reaches a crawler.** Against the preview URL:

```
curl -s https://<preview>.vercel.app/books | grep -c "enable JavaScript"     # want 0
curl -s https://<preview>.vercel.app/books | grep -o "<title>[^<]*</title>"
```

The title must name the Bookstore, not the homepage.

**3. Exactly one canonical, and one title.** This is the failure mode most
likely to bite, because React appends head tags rather than replacing them:

```
curl -s https://<preview>.vercel.app/books | grep -c 'rel="canonical"'       # want 1
curl -s https://<preview>.vercel.app/books | grep -c '<title'               # want 1
```

Two canonicals is worse than the wrong single canonical we had before — Google
discards a page with conflicting canonicals rather than picking one.

**4. A book page carries its structured data.**

```
curl -s https://<preview>.vercel.app/books/<id> | grep -c 'application/ld+json'
```

Expect 3: Organization and WebSite from index.html, plus Book + BreadcrumbList
from the page. Confirm there is no `offers` block — see below.

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

## Known gaps after this ships

- **New books are not prerendered until the next deploy.** They work normally
  for people (the SPA fallback handles them) and they are in the sitemap
  immediately, but crawlers see the shell until a rebuild. A weekly scheduled
  deploy would close this.
- **Still no genuine 404 status.** Unknown URLs render the 404 page with HTTP
  200 — a soft 404. The `noindex` on that page is what makes it work.
- **`/book/<slug>` legacy URLs still blanket-redirect** to `/books`. The 1:1
  slug map is a separate job.
