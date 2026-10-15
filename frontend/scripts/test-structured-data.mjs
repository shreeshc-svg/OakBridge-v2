/**
 * Structured data: is it valid, and is any of it a lie?
 *
 *   node scripts/test-structured-data.mjs
 *
 * Runs the real src/lib/schema.js builders and parses the static blocks in
 * public/index.html. Two jobs.
 *
 * VALIDITY — a JSON-LD block with a missing required field is not a smaller
 * rich result, it is no rich result, and it fails silently: nothing errors,
 * nothing logs, the page just never qualifies.
 *
 * TRUTHFULNESS — the more important one. Structured data is a set of claims to
 * Google about what is on the page. `rating` defaults to 4.5 on every book, so
 * an aggregateRating built from it would publish scores no reader gave. That is
 * fabricated review content under Google's spam policies, and the penalty lands
 * on the domain, not the page. This asserts we never emit one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');

const src = read('src/lib/schema.js')
  .replace(/^import .*$/gm, 'const SITE = "https://www.oakbridge.in";')
  .replace(/^export /gm, '');
const m = await import('data:text/javascript;base64,' + Buffer.from(
  src + '\nexport { metaDescription, breadcrumbLd, personLd, itemListLd, ordinal, editionLabel, bookSeoTitle, bookFormatUrl, ratingLd };').toString('base64'));
const { metaDescription, breadcrumbLd, personLd, itemListLd, ordinal, editionLabel, bookSeoTitle, bookFormatUrl, ratingLd } = m;

let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

console.log('-- the static blocks in index.html --');
const html = read('public/index.html');
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((x) => JSON.parse(x[1]));
eq('every block is valid JSON', blocks.length >= 2, true);
const org = blocks.find((b) => b['@type'] === 'Organization');
eq('Organization is present', !!org, true);
eq('it names the social profiles', Array.isArray(org.sameAs) && org.sameAs.length >= 3, true);
eq('no tracking parameters in an identity claim', org.sameAs.some((u) => u.includes('?')), false);
eq('every sameAs is an absolute https URL', org.sameAs.every((u) => u.startsWith('https://')), true);
eq('the logo is a logo, not the favicon', org.logo.includes('favicon'), false);
eq('it has a contact point', org.contactPoint['@type'], 'ContactPoint');

console.log('\n-- breadcrumbs --');
const bc = breadcrumbLd([{ name: 'Bookstore', path: '/books' }, { name: 'Climate Justice' }]);
eq('positions start at 1 and run in order', bc.itemListElement.map((i) => i.position), [1, 2]);
eq('intermediate steps carry an absolute URL', bc.itemListElement[0].item, 'https://www.oakbridge.in/books');
eq('the current page carries no URL, per Google', 'item' in bc.itemListElement[1], false);
eq('a single-step trail is still valid', breadcrumbLd([{ name: 'Events' }]).itemListElement.length, 1);

console.log('\n-- author pages --');
const person = personLd(
  { id: 'a1', name: 'Dr Manoj Kumar', bio: 'A conservationist and author.', photoUrl: 'https://x/y.jpg' },
  [{ id: 'b1', title: 'Sacred Tiger Tales', isbn: '9788199624542' }],
);
eq('is a Person', person['@type'], 'Person');
eq('lists the books as works', person.workExample[0].name, 'Sacred Tiger Tales');
eq('each work has an absolute URL', person.workExample[0].url, 'https://www.oakbridge.in/books/b1');
const bare = personLd({ id: 'a2', name: 'No Bio' }, []);
eq('an author with no bio claims no description', 'description' in bare, false);
eq('an author with no photo claims no image', 'image' in bare, false);
eq('an author with no books claims no works', 'workExample' in bare, false);

console.log('\n-- listings --');
const list = itemListLd([{ id: 'b1', title: 'One' }, { id: 'b2', title: 'Two' }], { name: 'Law', path: '/books?category=law' });
eq('counts what is there', list.numberOfItems, 2);
eq('positions match the rendered order', list.itemListElement.map((i) => i.position), [1, 2]);
const big = itemListLd(Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, title: `T${i}` })), {});
eq('caps the entries', big.itemListElement.length, 24);
eq('but still reports the true total', big.numberOfItems, 200);

console.log('\n-- meta descriptions --');
eq('short text is untouched', metaDescription('A short one.'), 'A short one.');
const long = 'Presenting a 360-degree view of the Companies Act, 2013 and the Limited Liability Partnership Act, 2008 with section-wise arrangement of all Circulars, Orders, Rules and Notifications.';
eq('never ends mid-word', /\w$|…$|\.$/.test(metaDescription(long)), true);
eq('stays within the limit', metaDescription(long).length <= 161, true);
eq('collapses whitespace', metaDescription('a\n\n  b'), 'a b');
eq('null is safe', metaDescription(null), '');
eq('ends on a sentence when one falls past halfway',
   metaDescription('A comprehensive commentary on the Act, revised throughout for the 2026 amendments. ' + 'x'.repeat(200)).endsWith('.'), true);
eq('but ignores an early full stop rather than throwing the snippet away',
   metaDescription('Vol 1. ' + 'y '.repeat(200)).length > 100, true);

// Comments explain why aggregateRating is absent, and a naive scan matches
// those. Strip them, or the test reports the explanation as the offence.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n-- the author entity is one entity --');
/*
 * The PDP's Book schema and the author page's Person schema each mint an @id
 * for the same human. If those two strings ever stop agreeing, both documents
 * stay individually valid and Google quietly goes back to treating the author
 * as two unrelated nodes -- no error anywhere, just the entity link gone. So
 * assert the shape on both sides.
 */
const personIdOf = personLd({ id: 'k-kannan', name: 'K Kannan' }, []);
eq('personLd mints an @id', personIdOf['@id'], 'https://www.oakbridge.in/authors/k-kannan#person');
eq('and it is distinct from url', personIdOf['@id'] !== personIdOf.url, true);
const pdp = read('src/pages/BookDetail.jsx');
eq('BookDetail mints the same shape',
   /\$\{SITE\}\/authors\/\$\{a\.id\}#person/.test(pdp), true);
eq('BookDetail maps every matched author, not just the first',
   /author:\s*[\s\S]{0,200}bookAuthors\.map\(/.test(pdp), true);
eq('and still falls back to the raw string when none match',
   /"@type":\s*"Person",\s*name:\s*book\.author/.test(pdp), true);

console.log('\n-- no invented biography --');
// The tab used to print "A distinguished Oakbridge author with deep subject
// expertise and years of classroom experience" under whichever name was on the
// book -- a specific claim about a real person that nobody had verified.
// Read the stripped source: the comment explaining WHY this line went away
// quotes it verbatim, and a raw scan reports the explanation as the offence.
eq('the generic author paragraph is gone', /A distinguished Oakbridge author/.test(strip(pdp)), false);
eq('the bio shown is the author record\'s own', /\{a\.bio\}/.test(pdp), true);

console.log('\n-- book page titles, descriptions, markup (15 Oct 2026) --');
eq('title adds the author', bookSeoTitle({ title: 'Compulsory English for IAS (Mains) Examination 6/e', author: 'A P Bhardwaj' }),
   'Compulsory English for IAS (Mains) Examination 6/e by A P Bhardwaj');
eq('a long author list becomes "et al."', bookSeoTitle({ title: 'T', author: 'Pramod Rao, Ritvik Lukose & Balanand Menon Kumar' }), 'T by Pramod Rao et al.');
eq('a title that already names the author is left alone', bookSeoTitle({ title: 'A P Bhardwaj on English', author: 'A P Bhardwaj' }), 'A P Bhardwaj on English');
eq('hampers get no "by"', bookSeoTitle({ title: 'Festive Hamper', author: 'Various', product_type: 'hamper' }), 'Festive Hamper');
eq('ordinals', [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
eq('"6" -> "6th edition" (was "6 edition")', editionLabel('6'), '6th edition');
eq('worded editions are kept', [editionLabel('2nd ed.'), editionLabel('Revised edition'), editionLabel('Second'), editionLabel(null)],
   ['2nd ed.', 'Revised edition', 'Second edition', '']);
eq('bookFormat follows the binding (was Hardcover for everything)',
   [bookFormatUrl('Paperback'), bookFormatUrl('Hardback'), bookFormatUrl('eBook'), bookFormatUrl('')],
   ['https://schema.org/Paperback', 'https://schema.org/Hardcover', 'https://schema.org/EBook', undefined]);
const pdpSrc = strip(read('src/pages/BookDetail.jsx'));
eq('the PDP uses them', /title=\{bookSeoTitle\(book\)\}/.test(pdpSrc) && /bookFormatUrl\(book\.binding\)/.test(pdpSrc)
   && /editionLabel\(book\.edition\)/.test(pdpSrc) && !/schema\.org\/Hardcover"/.test(pdpSrc), true);
eq('the byline links to the author pages', /data-testid="book-byline"[\s\S]{0,400}to=\{`\/authors\/\$\{a\.id\}`\}/.test(pdpSrc), true);

console.log('\n-- nothing fabricated --');
const all = strip(read('src/lib/schema.js')) + strip(read('src/pages/BookDetail.jsx'));
// Ratings: only from real reviews. The 4.5 creation default (`book.rating`)
// is never shown or marked up.
eq('no rating without reviews', [ratingLd({ rating: 4.5 }), ratingLd({ review_count: 0, rating_avg: 4 }), ratingLd({ review_count: 3 })], [{}, {}, {}]);
eq('real reviews -> aggregateRating', ratingLd({ rating: 4.5, review_count: 2, rating_avg: 3.5 }).aggregateRating,
   { '@type': 'AggregateRating', ratingValue: 3.5, reviewCount: 2, bestRating: 5, worstRating: 1 });
eq('the 4.5 default is never read on the page or in markup', /book\.rating\b(?!_)/.test(all) || /\.rating\b(?!_avg)/.test(strip(read('src/lib/schema.js')).replace(/ratingLd|ratingValue/g, '')), false);
eq('aggregateRating is built in one place only', (all.match(/aggregateRating:/g) || []).length, 1);
eq('the Book schema still omits offers (prices go stale in prerendered HTML)',
   /"@type": "Book"/.test(read('src/pages/BookDetail.jsx')) && !/\boffers\s*:/.test(read('src/pages/BookDetail.jsx')), true);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
