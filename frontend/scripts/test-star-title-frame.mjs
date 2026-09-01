/**
 * The Star Title frame, and the scroll containers that clip it.
 *
 *     node frontend/scripts/test-star-title-frame.mjs
 *
 * A starred tile draws two things OUTSIDE its own box: a gold frame bled onto
 * negative insets, and a ribbon that straddles the top edge. Neither is layout —
 * that is the whole design, so one gold book cannot knock a row out of
 * alignment — but it means both live outside the padding box that any scrolling
 * ancestor clips at.
 *
 * And every rail on this site scrolls. `overflow-x-auto` is not one-directional:
 * CSS promotes overflow-y to `auto` the moment overflow-x is anything but
 * visible, and there is no way to split the axes. So a rail with no top padding
 * slices the ribbon off, and one with no side padding shaves the frame off the
 * first and last card. It fails silently and only for starred books, which is
 * why it reached production on the homepage: three of the four rails had been
 * padded and the fourth had not.
 *
 * These numbers are asserted against each other rather than hardcoded twice, so
 * fattening the frame or raising the ribbon fails HERE rather than on the shop.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const read = (...p) => readFileSync(join(SRC, ...p), "utf8");

const card = read("components", "BookCard.jsx");
const rail = read("components", "BookRail.jsx");
const marquee = read("components", "BestsellerCarousel.jsx");
const detail = read("pages", "BookDetail.jsx");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

// Tailwind spacing is 4px per step.
const px = (n) => n * 4;

console.log("-- what the frame actually costs, read off the component --");
const insets = [...card.matchAll(/\$\{compact \? "-inset-(\d)" : "-inset-(\d)"\}/g)][0];
check(!!insets, "the frame declares a compact and a full-size bleed");
const compactBleed = px(Number(insets?.[1] ?? 0));
const fullBleed = px(Number(insets?.[2] ?? 0));
check(fullBleed === 8 && compactBleed === 4,
      `full-size bleeds ${fullBleed}px, compact ${compactBleed}px`);

const lift = Number((card.match(/-translate-y-\[(\d+)%\]/) || [])[1]);
check(lift === 72, "the ribbon is lifted 72% of its own height above the tile edge");
// Ribbon reach = the frame's own bleed plus the part of the ribbon above it.
// Font sizes and padding come straight from the badge's className.
const ribbonFull = fullBleed + Math.ceil(0.72 * (10 + 3 * 2 + 3));   // ~21px, per the component's own note
const ribbonCompact = compactBleed + Math.ceil(0.72 * (8 + 2 * 2 + 3));
check(ribbonFull >= 20 && ribbonFull <= 24, `a full-size ribbon reaches about ${ribbonFull}px above the tile`);
check(ribbonCompact >= 12 && ribbonCompact <= 16, `a compact one about ${ribbonCompact}px`);

console.log("\n-- every clipping rail leaves room for both --");

// Each entry: [label, source, the container's className, whether its cards are compact]
const rails = [
    ["homepage 'New this season'", rail,
     (rail.match(/className="flex gap-4[^"]*"/) || [])[0], false],
    ["bestseller marquee", marquee,
     (marquee.match(/className="relative overflow-hidden[^"]*"/) || [])[0], true],
    ["related titles", detail,
     (detail.match(/className="flex gap-6 md:gap-8 overflow-x-auto[^"]*"/) || [])[0], false],
];

for (const [label, , cls, compact] of rails) {
    const need = compact ? ribbonCompact : ribbonFull;
    const bleed = compact ? compactBleed : fullBleed;
    check(!!cls, `${label}: container class found`);
    if (!cls) continue;

    const pt = px(Number((cls.match(/\bpt-(\d+)\b/) || [])[1] || 0));
    check(pt >= need, `${label}: pt-${pt / 4} gives ${pt}px for a ribbon needing ${need}px`);

    // A horizontal scroller clips the sides too; a marquee that only ever moves
    // its own track does not need side room, so this applies to the two that
    // the user can actually scroll.
    if (/overflow-x-auto/.test(cls)) {
        const pxPad = px(Number((cls.match(/\bpx-(\d+)\b/) || [])[1] || 0));
        check(pxPad >= bleed,
              `${label}: px-${pxPad / 4} gives ${pxPad}px for a frame bleeding ${bleed}px sideways`);
    }
}

console.log("\n-- the homepage rail pays for the room without moving anything --");
const railCls = (rail.match(/className="flex gap-4[^"]*"/) || [""])[0];
// Padding alone would have worked, but this rail has prev/next arrows pinned at
// top-[34%] of the wrapper: growing the wrapper 24px slides them off the cover.
// The negative margins cancel the padding's effect on layout, so the clip box
// grows and nothing else does. Verified in a browser: cards moved 0px.
check(/\bpt-6\b/.test(railCls) && /-mt-6\b/.test(railCls),
      "pt-6 is cancelled by -mt-6, so the section's spacing is untouched");
check(/\bpx-2\b/.test(railCls) && /-mx-2\b/.test(railCls),
      "px-2 is cancelled by -mx-2, so the first card still lines up with the heading above it");
check(/top-\[34%\]/.test(rail),
      "and the arrows are still positioned by percentage — the reason the margins are needed at all");

console.log("\n-- the frame stays free of layout, which is what makes all this safe --");
check(card.includes("pointer-events-none absolute z-[-1]"),
      "the frame is absolutely positioned and cannot be clicked");
check(card.includes('starred ? "relative z-[1]" : ""'),
      "and the card is only promoted to a stacking context when it is starred");
check(!/border-\[1\.5px\] border-\[#C79A3B\][^"]*"\s*\/?>/.test(card.replace(/absolute[^"]*/g, "")),
      "the gold border lives only on the absolute frame, never on the card itself");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
