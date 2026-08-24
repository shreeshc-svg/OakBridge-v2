/**
 * printOutOffer — what a book shows once the print run is out.
 *
 *   node scripts/test-oos-offer.mjs
 *
 * Runs the real src/lib/ebook.js. The rule this file exists to hold: an
 * out-of-print title must never claim an eBook price it cannot sell. The price
 * is gated behind BOTH a link and the admin toggles, and if either is missing
 * the card says "Coming soon" rather than printing a number that leads nowhere.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');
const src = read('src/lib/ebook.js').replace(/^export /gm, '');
const m = await import('data:text/javascript;base64,' + Buffer.from(
  src + '\nexport { ebookGrossPrice, ebookEdition, printOutOffer };').toString('base64'));
const { printOutOffer, ebookEdition } = m;

let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

// Everything on: feature, the placement mark, and the price for that placement.
const ON = {
  ebook_enabled: 'on',
  ebook_plp_enabled: 'on', ebook_pdp_enabled: 'on',
  ebook_price_plp_enabled: 'on', ebook_price_pdp_enabled: 'on',
  ebook_gst_percent: 0,
};
const BOOK = { price: 2495, ebook_price: 1799, ebook_url: 'https://ebooks.oakbridge.in/x' };

console.log('-- the two states --');
eq('priced and linked sells the eBook', printOutOffer(BOOK, ON).state, 'ebook');
eq('and carries both prices', [printOutOffer(BOOK, ON).printPrice, printOutOffer(BOOK, ON).ebookPrice], [2495, 1799]);
eq('no eBook price falls back', printOutOffer({ ...BOOK, ebook_price: null }, ON).state, 'soon');
eq('no eBook link falls back too', printOutOffer({ ...BOOK, ebook_url: '' }, ON).state, 'soon');
eq('the print price survives the fallback', printOutOffer({ ...BOOK, ebook_price: null }, ON).printPrice, 2495);
eq('and the eBook price is null, not zero', printOutOffer({ ...BOOK, ebook_price: null }, ON).ebookPrice, null);

console.log('\n-- it never sells what the admin has switched off --');
// This is the state the site is in today: the feature is off site-wide and
// neither price toggle is on. Every out-of-print title must read "Coming soon".
eq('feature off site-wide', printOutOffer(BOOK, { ...ON, ebook_enabled: 'off' }).state, 'soon');
eq('price toggle off for listings', printOutOffer(BOOK, { ...ON, ebook_price_plp_enabled: 'off' }, 'plp').state, 'soon');
eq('price toggle off for the product page', printOutOffer(BOOK, { ...ON, ebook_price_pdp_enabled: 'off' }, 'pdp').state, 'soon');
eq('the mark itself hidden on listings', printOutOffer(BOOK, { ...ON, ebook_plp_enabled: 'off' }, 'plp').state, 'soon');
eq('live site today (all off) is soon', printOutOffer(BOOK, {
  ebook_enabled: 'off', ebook_price_plp_enabled: 'off', ebook_price_pdp_enabled: 'off',
}).state, 'soon');
eq('no site content at all is soon, not a crash', printOutOffer(BOOK, undefined).state, 'soon');
eq('a null book is soon, not a crash', printOutOffer(null, ON).state, 'soon');

console.log('\n-- placement is honoured --');
const plpOnly = { ...ON, ebook_price_pdp_enabled: 'off' };
eq('listing sells', printOutOffer(BOOK, plpOnly, 'plp').state, 'ebook');
eq('product page does not', printOutOffer(BOOK, plpOnly, 'pdp').state, 'soon');

console.log('\n-- GST rides along, exactly as on an in-stock title --');
eq('18% is applied to the eBook price',
   printOutOffer(BOOK, { ...ON, ebook_gst_percent: 18 }).ebookPrice, 2123);
eq('and matches ebookEdition, which the in-stock card uses',
   printOutOffer(BOOK, { ...ON, ebook_gst_percent: 18 }).ebookPrice,
   ebookEdition(BOOK, { ...ON, ebook_gst_percent: 18 }).price);

console.log('\n-- the card and the page cannot disagree --');
// A price on the tile that vanishes on the page it links to reads as a bug to
// the customer and as a pricing error to us.
for (const cfg of [ON, { ...ON, ebook_gst_percent: 5 }, { ...ON, ebook_enabled: 'off' }]) {
  const a = printOutOffer(BOOK, cfg, 'plp');
  const b = printOutOffer(BOOK, cfg, 'pdp');
  eq(`same answer both sides (gst=${cfg.ebook_gst_percent}, on=${cfg.ebook_enabled})`,
     [a.state, a.ebookPrice], [b.state, b.ebookPrice]);
}

console.log('\n-- no "out of stock" wording anywhere in the new UI --');
// The whole point of the change: the struck price says it, so nothing else
// should. Comments are stripped first, or the explanation reads as the offence.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const card = strip(read('src/components/BookCard.jsx'));
eq('the OUT OF STOCK band is gone from the card', /Out of Stock/i.test(card), false);
eq('and the cover is no longer greyed', /grayscale/.test(card), false);
eq('the card shows a struck print price', /line-through/.test(card), true);
eq('and offers the eBook', /Read eBook/.test(card), true);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
