/**
 * The Add-missing dialog must not hide work it can do.
 *
 *   node scripts/test-admin-import-dialog.mjs
 *
 * It was written when the endpoint could only INSERT. The endpoint later gained
 * the ability to patch an existing record -- which is how a bio or a portrait
 * reaches someone already on the roster -- and the dialog kept counting only
 * inserts. A run with 0 to add and 1 photo to attach displayed "Nothing to add"
 * and greyed out Apply, so the one piece of work available could not be started.
 *
 * These assertions read the component source, because the failure was a stale
 * assumption in the UI rather than anything the endpoint got wrong.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const read = (rel) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
let fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};

const src = read('src/pages/admin/AdminAuthors.jsx');
const dlg = src.slice(src.indexOf('function ImportAuthorsDialog'), src.indexOf('export default function AdminAuthors'));

console.log('-- the dialog counts updates, not just inserts --');
eq('it reads would_update', /would_update/.test(dlg), true);
eq('and updated, for the applied run', /preview\.updated/.test(dlg), true);
eq('Apply is gated on adds PLUS updates', /const n = adds \+ updates/.test(dlg), true);
eq('it no longer reads the removed already_present field',
   /already_present/.test(dlg), false);

console.log('\n-- the numbers a run actually turns on --');
for (const f of ['photos_attached', 'photos_found', 'photos_matching_nobody', 'updating']) {
  eq(`${f} is surfaced`, dlg.includes(f), true);
}

console.log('\n-- and the copy matches what it now does --');
// It updates existing records. Saying otherwise on the button someone is about
// to press is worse than saying nothing.
eq('no longer claims an existing author is skipped',
   /skipped, never overwritten/.test(dlg), false);
eq('says a blank field does not overwrite', /never overwrites/.test(dlg), true);

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
