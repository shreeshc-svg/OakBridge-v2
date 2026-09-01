/**
 * The eBook price on a book card, and the row height that lets it be big.
 *
 *     node frontend/scripts/test-ebook-price-size.mjs
 *
 * The eBook price is an ALTERNATIVE to the print price -- ₹555 against ₹636 for
 * the same title -- so it is set in the same face and size. Setting it smaller
 * made it read as a footnote rather than as one of two things you can buy.
 *
 * The catch is where it lives. The delivery/eBook row is the bottom-most element
 * of the mt-auto cluster that pins the price, so its height must be IDENTICAL on
 * every card in a grid row; a taller row on the ~110 titles that have an eBook
 * would lift their prices out of step with the ~84 that do not. So the row
 * carries a min-height equal to the enlarged link, and these two numbers have to
 * stay locked together. That is what this file checks.
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

// Tailwind's scale, only the entries used here.
const FONT = { "text-base": { size: 16, line: 24 }, "text-xl": { size: 20, line: 28 } };
const PAD = { "pt-1.5": 6, "pt-2": 8 };

console.log("-- the eBook price matches the print price exactly --");
const printSizes = card.match(/font-serif text-\[#002B5C\] \$\{compact \? "(text-\w+)" : "(text-\w+)"\}/);
check(!!printSizes, "found the print price's classes");
const [, printCompact, printFull] = printSizes || [];
check(printFull === "text-xl" && printCompact === "text-base",
      `print price is ${printFull} / ${printCompact} compact`);

const ebookSpan = card.match(/font-serif border-b border-\[#0A7D55\]\/40 pb-px \$\{compact \? "(text-\w+)" : "(text-\w+)"\}/);
check(!!ebookSpan, "the eBook label carries its own size classes");
const [, ebookCompact, ebookFull] = ebookSpan || [];
check(ebookFull === printFull, `eBook price is ${ebookFull}, same as the print price`);
check(ebookCompact === printCompact, `and ${ebookCompact} on compact cards, same as the print price`);
check(/font-serif border-b border-\[#0A7D55\]/.test(card),
      "in the same face too — matching the size but not the face would look like an accident");
check(/<BookOpen\s+size=\{compact \? 14 : 17\}/.test(card),
      "and the icon scales with it, so the mark reads as one unit");

console.log("-- the row reserves that height on EVERY card, eBook or not --");
const rowCls = (card.match(/flex items-center gap-2 \$\{compact \? "[^"]*" : "[^"]*"\}/) || [""])[0];
check(!!rowCls, "found the delivery/eBook row");
const minH = {
    full: parseFloat((rowCls.match(/: "pt-2 text-\[11px\] min-h-\[([\d.]+)rem\]/) || [])[1]) * 16,
    compact: parseFloat((rowCls.match(/compact \? "pt-1\.5 text-\[10px\] min-h-\[([\d.]+)rem\]/) || [])[1]) * 16,
};

/*
 * The link's real height is NOT its line-height. The underline adds pb-px and a
 * 1px border below the line box, so a text-xl link is 30px, not 28. Reserving 28
 * left exactly 2px of drift in a row holding one card with an eBook and one
 * without -- measured in a browser, which is how the number was corrected.
 */
const UNDERLINE = 1 + 1; // pb-px + border-b
for (const [variant, font, pad] of [["full", FONT[ebookFull], PAD["pt-2"]],
                                    ["compact", FONT[ebookCompact], PAD["pt-1.5"]]]) {
    const need = font.line + UNDERLINE + pad;
    check(minH[variant] === need,
          `${variant}: min-h is ${minH[variant]}px for a ${font.line}px line + ${UNDERLINE}px underline + ${pad}px padding = ${need}px`);
}

console.log("-- and the reasons the row exists at all still hold --");
check(card.includes('!ebookOnPlp && <span aria-hidden="true">&nbsp;</span>'),
      "a card with no eBook and no delivery line still renders the row");
check(/min-h-\[[\d.]+rem\]/.test(rowCls),
      "the floor is on the row itself, not on the link — the link is absent on most cards");
check(card.includes("ebookOnPlp && ("),
      "the link still appears only for titles that actually have an eBook");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
