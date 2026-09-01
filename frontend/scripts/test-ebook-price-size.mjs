/**
 * The eBook price on a book card, and the row height that pays for it.
 *
 *     node frontend/scripts/test-ebook-price-size.mjs
 *
 * The eBook price is an ALTERNATIVE to the print price -- 555 against 636 for
 * the same title -- so it is set near it rather than in the row's 11px, where it
 * read as a footnote. Near, not level: set at the same 20px it became the
 * headline, two numbers of equal weight on one card with the cheaper one
 * underlined in green, pulling the eye off what the Add button actually buys.
 * It sits three pixels down.
 *
 * The catch is where it lives. The delivery/eBook row is the bottom-most element
 * of the mt-auto cluster that pins the price, so its height must be IDENTICAL on
 * every card in a grid row; a taller row on the titles that have an eBook would
 * lift their prices out of step with the ones that do not. So the row carries a
 * min-height derived from the link, and the two must never drift apart. That
 * coupling is what this file exists to hold.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const card = readFileSync(join(HERE, "..", "src", "components", "BookCard.jsx"), "utf8");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

// Only the Tailwind steps used by the print price.
const NAMED = { "text-base": 16, "text-xl": 20 };
const PAD = { "pt-1.5": 6, "pt-2": 8 };
const UNDERLINE = 1 + 1;               // pb-px + border-b, both BELOW the line box
const REM = 16;

console.log("-- the print price, read off the component --");
const printM = card.match(/font-serif text-\[#002B5C\] \$\{compact \? "(text-\w+)" : "(text-\w+)"\}/);
check(!!printM, "found the print price's classes");
const print = { compact: NAMED[printM?.[1]], full: NAMED[printM?.[2]] };
check(print.full === 20 && print.compact === 16,
      `print price is ${print.full}px, ${print.compact}px on compact cards`);

console.log("\n-- the eBook price sits just under it, in the same face --");
const ebookM = card.match(
    /font-serif border-b border-\[#0A7D55\]\/40 pb-px \$\{compact \? "text-\[(\d+)px\] leading-\[(\d+)px\]" : "text-\[(\d+)px\] leading-\[(\d+)px\]"\}/,
);
check(!!ebookM, "the eBook label declares an explicit size AND line-height");
const ebook = {
    compact: { size: +ebookM?.[1], line: +ebookM?.[2] },
    full: { size: +ebookM?.[3], line: +ebookM?.[4] },
};
for (const v of ["full", "compact"]) {
    const drop = print[v] - ebook[v].size;
    check(drop >= 2 && drop <= 4,
          `${v}: ${ebook[v].size}px is ${drop}px under the ${print[v]}px print price — near it, not level with it`);
}
check(/font-serif border-b border-\[#0A7D55\]/.test(card),
      "same face as the print price — matching the weight but not the face would look like an accident");
check(ebook.full.line > ebook.full.size && ebook.compact.line > ebook.compact.size,
      "the line-height is explicit, because an arbitrary font size would otherwise inherit the row's 11px");
const iconM = card.match(/<BookOpen\s+size=\{compact \? (\d+) : (\d+)\}/);
check(!!iconM, "the icon declares its own sizes");
check(+iconM[2] < ebook.full.size + 2 && +iconM[2] > ebook.full.size - 4,
      `the icon (${iconM[2]}px) tracks the text (${ebook.full.size}px), so the mark reads as one unit`);
check(+iconM[1] < +iconM[2], "and is smaller again on compact cards");

console.log("\n-- the row reserves that exact height on EVERY card, eBook or not --");
const rowCls = (card.match(/flex items-center gap-2 \$\{compact \? "[^"]*" : "[^"]*"\}/) || [""])[0];
check(!!rowCls, "found the delivery/eBook row");
const declared = {
    full: parseFloat((rowCls.match(/: "pt-2 text-\[11px\] min-h-\[([\d.]+)rem\]/) || [])[1]) * REM,
    compact: parseFloat((rowCls.match(/compact \? "pt-1\.5 text-\[10px\] min-h-\[([\d.]+)rem\]/) || [])[1]) * REM,
};
for (const [v, pad] of [["full", PAD["pt-2"]], ["compact", PAD["pt-1.5"]]]) {
    const need = ebook[v].line + UNDERLINE + pad;
    check(declared[v] === need,
          `${v}: min-h is ${declared[v]}px for a ${ebook[v].line}px line + ${UNDERLINE}px underline + ${pad}px padding = ${need}px`);
}

console.log("\n-- and the reasons the row exists at all still hold --");
check(card.includes('!ebookOnPlp && <span aria-hidden="true">&nbsp;</span>'),
      "a card with no eBook and no delivery line still renders the row");
check(/min-h-\[[\d.]+rem\]/.test(rowCls),
      "the floor is on the row itself, not on the link — the link is absent on most cards");
check(card.includes("ebookOnPlp && ("),
      "the link still appears only for titles that actually have an eBook");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
