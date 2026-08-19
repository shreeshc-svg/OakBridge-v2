/**
 * Responsive image sources.
 *
 * Runs the real src/lib/img.js with no build step:
 *   node scripts/test-responsive-images.mjs
 *
 * The thing worth guarding is the srcset itself. A candidate the browser picks
 * and cannot fetch is worse than offering no candidates at all — it shows
 * nothing, on the largest image on the page. So: only hosts that actually
 * resize, never a width above what was asked for, and no srcset at all when
 * there would be only one entry in it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(fileURLToPath(new URL('../src/lib/img.js', import.meta.url)), 'utf8').replace(/^export /gm,'');
const { responsiveImage } = await import('data:text/javascript;base64,' + Buffer.from(src + '\nexport {responsiveImage};').toString('base64'));
let fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want); if(!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${n}${ok?'':`\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`); };

const u = 'https://images.unsplash.com/photo-1?auto=format&fit=crop&w=1600&q=85';
const r = responsiveImage(u, '100vw', true);
eq('src is untouched', r.src, u);
eq('offers 480 up to what was asked, never above', r.srcSet.match(/ (\d+)w/g).map(s=>+s.trim().replace('w','')), [480,800,1200,1600]);
eq('sizes passes through', r.sizes, '100vw');
eq('LCP image is eager and high priority', [r.loading, r.fetchpriority], ['eager','high']);
eq('non-priority is lazy', responsiveImage(u).loading, 'lazy');
eq('non-priority decodes async', responsiveImage(u).decoding, 'async');

const own = '/api/files/covers/x.jpg';
eq('our own uploads get no srcset (no resizer in front of them)', responsiveImage(own).srcSet, undefined);
eq('...but still get lazy loading', responsiveImage(own).loading, 'lazy');
eq('unknown host untouched', responsiveImage('https://example.com/a.jpg?w=1600').srcSet, undefined);
eq('a 480-wide source is left alone rather than given a 1-entry srcset', responsiveImage('https://images.unsplash.com/p?w=480').srcSet, undefined);
eq('null survives', responsiveImage(null).src, null);
eq('every candidate is a real url', responsiveImage(u).srcSet.split(', ').every(s => s.startsWith('https://images.unsplash.com/photo-1?auto=format&fit=crop&w=')), true);
console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail?1:0);
