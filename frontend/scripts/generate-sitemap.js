/* Regenerate public/sitemap.xml from live categories + books.
   Usage:  BACKEND_URL=http://localhost:8000 SITE_URL=https://oakbridge.in node scripts/generate-sitemap.js
   Requires Node 18+ (global fetch). */
const fs = require("fs");
const path = require("path");

const BACKEND = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
const SITE = (process.env.SITE_URL || "https://oakbridge.in").replace(/\/$/, "");

const STATIC = [
  ["/", "weekly", "1.0"], ["/books", "daily", "0.9"], ["/authors", "weekly", "0.6"],
  ["/events", "weekly", "0.6"], ["/about", "monthly", "0.5"], ["/contact", "monthly", "0.5"],
  ["/submissions", "monthly", "0.5"], ["/academy", "monthly", "0.4"], ["/digital-solutions", "monthly", "0.4"],
  ["/what-we-do", "monthly", "0.5"],
  ["/terms", "yearly", "0.3"], ["/privacy", "yearly", "0.3"],
  ["/refund-policy", "yearly", "0.3"], ["/shipping-policy", "yearly", "0.3"],
];

async function main() {
  const urls = STATIC.map(([loc, cf, pr]) => ({ loc: SITE + loc, cf, pr }));
  try {
    const cats = await fetch(`${BACKEND}/api/categories`).then((r) => r.json());
    for (const c of cats) urls.push({ loc: `${SITE}/books?category=${c.id}`, cf: "weekly", pr: "0.7" });
    const books = await fetch(`${BACKEND}/api/books?limit=1000`).then((r) => r.json());
    for (const b of books) urls.push({ loc: `${SITE}/books/${b.id}`, cf: "weekly", pr: "0.8" });
    console.log(`Added ${cats.length} categories + ${books.length} books.`);
  } catch (e) {
    console.warn("Could not reach API — writing static routes only:", e.message);
  }
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc><changefreq>${u.cf}</changefreq><priority>${u.pr}</priority></url>`).join("\n") +
    `\n</urlset>\n`;
  fs.writeFileSync(path.join(__dirname, "..", "public", "sitemap.xml"), xml);
  console.log(`Wrote public/sitemap.xml (${urls.length} URLs).`);
}
main();
