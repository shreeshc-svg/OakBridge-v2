/**
 * Title tags: the brand is appended only when it fits.
 *
 *   node scripts/test-title-tags.mjs
 *
 * Every title used to carry " · Oakbridge Publishing" — 23 characters — which
 * on a long book title pushed the tag past the ~60 Google renders. The brand
 * was invisible anyway, and it displaced the end of the book's own name, which
 * is the part a customer is scanning for.
 *
 * The book title itself is never shortened. A name cut mid-edition is worse
 * than a long one: the reader cannot tell whether it is the edition they want.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/components/Seo.jsx', import.meta.url)), 'utf8');
const body = src.slice(src.indexOf('const SUFFIX'), src.indexOf('/**\n * React 19'));
const m = await import('data:text/javascript;base64,' +
  Buffer.from(body.replace(/^export /gm, '') + '\nexport { pageTitle, SUFFIX, TITLE_MAX };').toString('base64'));
const { pageTitle, SUFFIX, TITLE_MAX } = m;

let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

console.log('-- short titles keep the brand --');
eq('a page name', pageTitle('Bookstore'), 'Bookstore · Oakbridge Publishing');
eq('an author', pageTitle('Bhumesh Verma — Books'), 'Bhumesh Verma — Books · Oakbridge Publishing');
eq('a short book title', pageTitle('Climate Justice'), 'Climate Justice · Oakbridge Publishing');
eq('nothing at all falls back to the brand', pageTitle(''), 'Oakbridge Publishing');
eq('null is safe', pageTitle(null), 'Oakbridge Publishing');

console.log('\n-- long titles drop it rather than the book --');
const long = 'Master Guide to NTA UGC NET | SET | JRF | PhD Paper 1 (Teaching and Research Aptitude), 7/e';
eq('the book name survives in full', pageTitle(long), long);
eq('nothing is truncated', pageTitle(long).length, long.length);
eq('the brand is gone, not cut in half', pageTitle(long).includes('Oakbridge'), false);

console.log('\n-- the boundary --');
const exact = 'x'.repeat(TITLE_MAX - SUFFIX.length);
eq('exactly at the limit still gets the brand', pageTitle(exact).length, TITLE_MAX);
eq('one character over drops it', pageTitle(exact + 'y'), exact + 'y');

console.log('\n-- and the result is never a fragment --');
for (const t of ['Bookstore', long, 'Climate Justice', exact, exact + 'y']) {
  const out = pageTitle(t);
  if (!out.startsWith(t) && t) { fail++; console.log(`FAIL  "${t}" was altered`); }
}
console.log('ok    every title still begins with the page it names');

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
