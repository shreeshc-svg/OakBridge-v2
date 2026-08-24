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

const read = (rel) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

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

console.log('\n-- the solutions detail pages --');
/*
 * These three shipped a document with nothing in its head at all: no title, no
 * meta description, no canonical. The listing branch of Solutions.jsx had a
 * <Seo>; the detail branch never did. Semrush reported it three separate ways,
 * all naming the same URLs.
 *
 * Two halves, and both are asserted here, because either alone leaves the page
 * broken for a crawler that does not run JS.
 */
const sol = read('src/pages/Solutions.jsx');
const detail = sol.slice(sol.indexOf('function SolutionDetail'), sol.indexOf('export default'));
eq('SolutionDetail renders a Seo', /<Seo\b/.test(detail), true);
eq('with a canonical built from the slug', /path=\{`\/solutions\/\$\{slug\}`\}/.test(detail), true);
eq('and a description, not just a title', /description=\{metaDescription\(/.test(detail), true);

const pre = read('scripts/prerender.js');
for (const slug of ['schools', 'higher-ed', 'educators']) {
  eq(`/solutions/${slug} is prerendered`, pre.includes(`"/solutions/${slug}"`), true);
}
// Titles have to survive the 60-char rule that drops the suffix rather than
// truncating the page's own name.
for (const [t_, k] of [['For Schools', 'K-12 Programmes'], ['For Colleges', 'Higher Education'],
                       ['For Educators', 'Teacher Resources']]) {
  const full = pageTitle(`${t_} — ${k}`);
  eq(`"${t_}" keeps its suffix`, full.endsWith('Oakbridge Publishing'), true);
  eq(`   and fits in 60 chars (${full.length})`, full.length <= 60, true);
}

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
