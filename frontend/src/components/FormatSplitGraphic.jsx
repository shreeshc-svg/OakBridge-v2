import React from "react";

/**
 * One book, opened, with a printed page on the left and a screen on the right.
 *
 * WHY ONE OBJECT AND NOT TWO
 *
 * The page argues that print and digital are two ways into the SAME title, not
 * two products. Two separate drawings would have said the opposite before
 * anyone read a word. Sharing a spine is the whole idea, drawn.
 *
 * WHY SVG AND NOT A PHOTOGRAPH
 *
 * There is no eBook photography in the repo, and an uploaded image on a
 * prerendered route is a layout shift waiting to happen — our uploads go
 * through /api/files and carry no intrinsic dimensions, so the browser cannot
 * reserve space for them. An inline SVG with a fixed viewBox has a known
 * aspect ratio before a single byte of network arrives, weighs nothing, and
 * stays sharp on a 3xl display.
 *
 * The style follows TimelineRoad, the only other real illustration here: flat
 * fills, brand hexes, geometry from arithmetic rather than hand-placed points,
 * no gradients and no drop shadows.
 *
 * The amber marks on the screen are the argument for the format — a highlight
 * and an underline are things you cannot do to a printed page you have paid
 * for. They are the only amber in the drawing, so the eye lands there.
 */

const INK = "#002B5C";
const RULE = "#E5E7EB";
const PAPER_MUTED = "#F5F7FA";
const CRIMSON = "#CC0033";
const GOLD = "#F59E0B";

// One text line per row, as a fraction of the column width. A ragged right
// edge reads as prose; equal-length bars read as a placeholder.
const LINE_WIDTHS = [1, 0.94, 0.98, 0.72, 1, 0.88, 0.96, 0.62, 0.99, 0.9, 0.75];

const LINE_TOP = 92;
const LINE_STEP = 21;
const LINE_H = 5;

/** Text rows for one leaf, indented by `x`, `w` wide, skipping any row in `skip`. */
const rows = (x, w, skip = []) =>
    LINE_WIDTHS.map((f, i) => ({
        key: i,
        x,
        y: LINE_TOP + i * LINE_STEP,
        w: Math.round(w * f),
        hidden: skip.includes(i),
    }));

// Screen column geometry, named because three other things are measured from
// it — the highlight, the underline and the right-hand margin. The screen runs
// 298→504, so 318 + 170 leaves a 16px gutter before the bezel; at 182 the text
// came within 4px of it and read as a rendering fault.
const SCREEN_X = 318;
const SCREEN_W = 170;
const HIGHLIGHT_ROW = 3;
const UNDERLINE_ROW = 6;

export default function FormatSplitGraphic({ className = "" }) {
    const paper = rows(66, 186);
    const screen = rows(SCREEN_X, SCREEN_W);
    const hl = screen[HIGHLIGHT_ROW];
    const ul = screen[UNDERLINE_ROW];

    return (
        <svg
            viewBox="0 0 560 400"
            className={`w-full h-auto ${className}`}
            role="img"
            aria-label="One book opened, with a printed page on the left and the same book on an e-reader screen on the right"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* ---------------- left leaf: the printed page ---------------- */}

            {/* The cut edges of the pages behind the one that is open. Three
                hairlines, each shorter, so the block reads as thickness. */}
            {[0, 1, 2].map((i) => (
                <rect
                    key={`edge-${i}`}
                    x={38 - i * 5}
                    y={54 + i * 5}
                    width={6}
                    height={292 - i * 10}
                    fill={i === 0 ? "#FFFFFF" : PAPER_MUTED}
                    stroke={RULE}
                    strokeWidth="1"
                />
            ))}

            {/* The binding. The only crimson in the drawing apart from nothing
                else — it is the spine of a physical object, and red is what
                this site already uses for the printed edition's price. */}
            <rect x="44" y="46" width="9" height="308" fill={CRIMSON} />

            <rect x="53" y="46" width="217" height="308" fill="#FFFFFF" stroke={RULE} strokeWidth="1.5" />

            {/* Running head, then the body text. */}
            <rect x="66" y="66" width="74" height="5" rx="2.5" fill={INK} opacity="0.28" />
            {paper.map((l) => (
                <rect key={`p-${l.key}`} x={l.x} y={l.y} width={l.w} height={LINE_H} rx="2.5" fill={INK} opacity="0.75" />
            ))}
            {/* Folio. Printed pages are numbered; screens are not. */}
            <rect x="151" y="332" width="20" height="5" rx="2.5" fill={INK} opacity="0.35" />

            {/* ---------------- the spine both leaves share ---------------- */}
            <rect x="270" y="46" width="16" height="308" fill={PAPER_MUTED} stroke={RULE} strokeWidth="1.5" />
            <line x1="278" y1="60" x2="278" y2="340" stroke={INK} strokeWidth="1" opacity="0.18" />

            {/* ---------------- right leaf: the same book, on a screen ---------------- */}

            {/* Device body. A 6px radius — barely rounded, because square
                corners are this site's identity, but a slab with none at all
                does not read as a device. */}
            <rect x="286" y="34" width="230" height="332" rx="6" fill={INK} />
            <rect x="298" y="52" width="206" height="272" fill={PAPER_MUTED} />

            <rect x={SCREEN_X} y="66" width="70" height="5" rx="2.5" fill={INK} opacity="0.28" />

            {/* A highlighted passage. Drawn UNDER the text so it reads as ink
                over a marker stroke rather than a bar sitting on top of it, and
                sized FROM the line it sits behind — a fixed width overhung the
                short line it was meant to mark. */}
            <rect
                x={hl.x - 6}
                y={hl.y - 5}
                width={hl.w + 12}
                height={LINE_H + 10}
                fill={GOLD}
                opacity="0.32"
            />

            {screen.map((l) => (
                <rect key={`s-${l.key}`} x={l.x} y={l.y} width={l.w} height={LINE_H} rx="2.5" fill={INK} opacity="0.75" />
            ))}

            {/* An underline under a later line — the second thing you can do to
                a book you are reading on a screen and not to one you own. */}
            <line
                x1={ul.x}
                y1={ul.y + LINE_H + 5}
                x2={ul.x + ul.w}
                y2={ul.y + LINE_H + 5}
                stroke={GOLD}
                strokeWidth="2.5"
            />

            {/* Reading progress, then the bezel's dot row. The device spans
                286→516, so the middle dot sits at 401 — it was at 395, and six
                pixels off centre on a symmetrical object is the kind of thing
                you cannot unsee once you have seen it. */}
            <rect x="298" y="316" width="206" height="4" fill={RULE} />
            <rect x="298" y="316" width="128" height="4" fill={GOLD} />
            {[-1, 0, 1].map((i) => (
                <circle key={`dot-${i}`} cx={401 + i * 16} cy="345" r="3.5" fill="#FFFFFF" opacity="0.45" />
            ))}
        </svg>
    );
}
