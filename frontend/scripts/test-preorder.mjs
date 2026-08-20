/**
 * Pre-order state machine.
 *
 *   node scripts/test-preorder.mjs
 *
 * Runs the real src/lib/preorder.js. The countdown hook needs React, so this
 * covers the part that decides WHETHER a book is a pre-order — which is what
 * the tile, the product page and the cart all branch on, and what has to agree
 * across all three.
 *
 * The case worth guarding is the one that needs no admin action: the morning
 * after publication, the date is in the past, and the book must go back to
 * being an ordinary title on its own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/lib/preorder.js', import.meta.url)), 'utf8')
  .replace(/^import .*$/gm, '')                   // the hook's React import
  .replace(/export const useCountdown[\s\S]*$/m, '')   // and the hook itself
  .replace(/^export /gm, '');
const m = await import('data:text/javascript;base64,' +
  Buffer.from(src + '\nexport { preorderState, launchDate, formatLaunchDate };').toString('base64'));
const { preorderState, launchDate, formatLaunchDate } = m;

let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const NOW = Date.parse('2026-08-19T12:00:00Z');
const soon = { coming_soon: true, launch_at: '2026-09-14T00:00:00Z' };
const past = { coming_soon: true, launch_at: '2026-08-01T00:00:00Z' };

console.log('-- while it is still ahead --');
eq('flag + future date is a pre-order', preorderState(soon, NOW).active, true);
eq('and it is not lapsed', preorderState(soon, NOW).lapsed, false);
eq('label defaults', preorderState(soon, NOW).label, 'Coming soon');
eq('label can be overridden', preorderState({ ...soon, coming_soon_label: 'Pre-order now' }, NOW).label, 'Pre-order now');
eq('a blank label falls back rather than showing an empty band', preorderState({ ...soon, coming_soon_label: '   ' }, NOW).label, 'Coming soon');

console.log('\n-- it clears itself --');
eq('the day after publication it is not a pre-order', preorderState(past, NOW).active, false);
eq('but it is reported lapsed, for admins', preorderState(past, NOW).lapsed, true);
eq('one second before, still live', preorderState({ coming_soon: true, launch_at: new Date(NOW + 1000).toISOString() }, NOW).active, true);
eq('at the exact moment, over', preorderState({ coming_soon: true, launch_at: new Date(NOW).toISOString() }, NOW).active, false);

console.log('\n-- half-configured shows nothing --');
eq('flag with no date', preorderState({ coming_soon: true }, NOW).active, false);
eq('flag with an empty date', preorderState({ coming_soon: true, launch_at: '   ' }, NOW).active, false);
eq('flag with junk', preorderState({ coming_soon: true, launch_at: 'next tuesday' }, NOW).active, false);
eq('date with no flag', preorderState({ launch_at: '2026-09-14' }, NOW).active, false);
eq('neither', preorderState({}, NOW).active, false);
eq('a null book (the page renders before it loads)', preorderState(null, NOW).active, false);

console.log('\n-- date handling --');
eq('a date-only value is accepted', launchDate({ launch_at: '2026-09-14' }) instanceof Date, true);
eq('junk is refused rather than becoming Invalid Date', launchDate({ launch_at: 'nope' }), null);
eq('formats for a reader', formatLaunchDate(new Date('2026-09-14T00:00:00Z')).includes('September'), true);
eq('no date formats to nothing', formatLaunchDate(null), '');

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
