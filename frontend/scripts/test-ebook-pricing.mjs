/**
 * eBook pricing — what may be shown, and for how much.
 *
 * Runs the real src/lib/ebook.js, no build step and no browser:
 *   node scripts/test-ebook-pricing.mjs
 *
 * Two things are being protected. The arithmetic, because a rounding artifact
 * prices a title a rupee under what the eReader charges and nobody notices for
 * months. And the gates, because "hide all eBook buttons" has to hide the
 * prices too, and a price with no link is an advert for something the customer
 * cannot buy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/lib/ebook.js', import.meta.url)), 'utf8')
  .replace(/^export /gm, '');
const mod = await import('data:text/javascript;base64,' + Buffer.from(src + '\nexport {ebookGrossPrice, ebookEdition};').toString('base64'));
const { ebookGrossPrice, ebookEdition } = mod;

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const linked = { ebook_url: 'https://ebooks.oakbridge.in/x', ebook_price: 466 };
const on = { ebook_price_plp_enabled: 'on', ebook_gst_percent: '5' };

console.log('-- GST maths --');
eq('466 + 5% rounds to 489', ebookGrossPrice(linked, on), 489);
eq('0% leaves it alone', ebookGrossPrice(linked, {ebook_gst_percent:'0'}), 466);
eq('18% on 1000', ebookGrossPrice({ebook_price:1000}, {ebook_gst_percent:'18'}), 1180);
eq('missing rate is treated as 0, never NaN', ebookGrossPrice(linked, {}), 466);
eq('junk rate is treated as 0', ebookGrossPrice(linked, {ebook_gst_percent:'abc'}), 466);
eq('negative rate refused', ebookGrossPrice(linked, {ebook_gst_percent:'-5'}), 466);
eq('no price -> null', ebookGrossPrice({ebook_price:null}, on), null);
eq('zero price -> null, not free', ebookGrossPrice({ebook_price:0}, on), null);
eq('junk price -> null', ebookGrossPrice({ebook_price:'abc'}, on), null);
eq('half rupee rounds up', ebookGrossPrice({ebook_price:100}, {ebook_gst_percent:'0.5'}), 101);

console.log('\n-- who may see a price --');
const price = (book, site) => ebookEdition(book, site, 'plp').price;
eq('linked + priced + on', price(linked, on), 489);
eq('price switch off (the default)', price(linked, {ebook_gst_percent:'5'}), null);
eq('no url -> hidden, per the rule', price({ebook_price:466}, on), null);
eq('blank url -> hidden', price({ebook_url:'   ', ebook_price:466}, on), null);
eq('no price -> hidden', price({ebook_url:'x'}, on), null);
eq('all ebook buttons hidden -> price hidden', price(linked, {...on, ebook_enabled:'off'}), null);
eq('listing mark hidden -> price hidden', price(linked, {...on, ebook_plp_enabled:'off'}), null);
eq('pdp switch does not leak onto tiles', price(linked, {...on, ebook_price_pdp_enabled:'on'}), 489);

console.log('\n-- pdp reads its own switches --');
const pdp = (book, site) => ebookEdition(book, site, 'pdp').price;
eq('pdp off while plp on', pdp(linked, on), null);
eq('pdp on', pdp(linked, {ebook_price_pdp_enabled:'on', ebook_gst_percent:'5'}), 489);
eq('pdp mark hidden -> price hidden', pdp(linked, {ebook_price_pdp_enabled:'on', ebook_pdp_enabled:'off'}), null);

console.log('\n-- the link survives without a price --');
const unpriced = ebookEdition({ ebook_url: 'https://ebooks.oakbridge.in/x' }, on, 'plp');
eq('linked but unpriced still gets its link', [unpriced.linked, unpriced.price], [true, null]);
eq('unlinked gets neither', (() => { const e = ebookEdition({ebook_price:466}, on, 'plp'); return [e.linked, e.price]; })(), [false, null]);
eq('hiding all ebook buttons kills the link too', ebookEdition(linked, {...on, ebook_enabled:'off'}, 'plp').linked, false);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
