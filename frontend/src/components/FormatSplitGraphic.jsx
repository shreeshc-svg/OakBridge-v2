import React from "react";

/**
 * An open book releasing its type into an e-reader.
 *
 * WHY THIS IS THE ONE ILLUSTRATION ALLOWED DEPTH
 *
 * The rest of the site is flat fills and hairlines, and two earlier attempts at
 * this drawing obeyed that. Both read as diagrams: grey bars standing in for
 * words look like a loading skeleton, and a flat elevation of a closed book has
 * no moment in it. This one is asked to sell rather than to explain, so it gets
 * gradients, a cast shadow and a glow. Nothing else does — including the cloud
 * panel directly beneath it, which a test keeps flat, because a flat design
 * language dies by copy-paste.
 *
 * THE IDEA
 *
 * Letters leave the page and land on the screen. Actual letterforms, section
 * and pilcrow marks among them, because that is what a statute page is made of
 * and they read as legal text faster than any Latin letter does. The running
 * head on the open page and the title on the screen are the same words: one
 * book arriving, not two books side by side.
 *
 * HOW THE OPEN BOOK IS BUILT
 *
 * Everything hangs off four numbers — the two outer edges, the gutter, and how
 * far the paper sags into it. Pages, cover board, page-block striations, the
 * gutter shadow and every line of body text are derived from those, so the book
 * can be made fatter or flatter by changing one constant instead of by
 * redrawing nine paths that have to agree with each other.
 *
 * SAFE ON A PRERENDERED ROUTE
 *
 * One inline SVG, fixed viewBox, nothing fetched — so the browser knows the
 * aspect ratio before a byte of network arrives and nothing shifts under it.
 * Gradient and filter ids are prefixed `fg-` because SVG ids are global to the
 * document and this drawing shares a page with another one.
 */

const GOLD = "#F59E0B";
const INK = "#002B5C";
const RULE = "#E5E7EB";

/* The site's heading face. Named explicitly: SVG does not inherit the page's
   font stack the way a block element does. */
const FACE = "Public Sans, ui-sans-serif, system-ui, sans-serif";

/* ------------------------------------------------------------ the open book */

const OUT_L = 44; // left fore-edge
const OUT_R = 300; // right fore-edge
const GUT = 172; // the gutter, where the two pages meet
const TOP_OUT = 198; // top edge at the fore-edge…
const TOP_GUT = 224; // …and where it sags into the gutter
const BOT_OUT = 316;
const BOT_GUT = 344;

/* A page as a closed path: along the top edge from the fore-edge into the
   gutter, straight down the gutter, then back out along the bottom edge. `dir`
   is +1 for the right-hand page, which is the same shape mirrored. */
const pagePath = (outer, dir) =>
    `M ${outer} ${TOP_OUT} ` +
    `C ${outer + dir * 48} ${TOP_OUT + 4}, ${GUT - dir * 30} ${TOP_GUT - 9}, ${GUT} ${TOP_GUT} ` +
    `L ${GUT} ${BOT_GUT} ` +
    `C ${GUT - dir * 30} ${BOT_GUT - 9}, ${outer + dir * 48} ${BOT_OUT + 6}, ${outer} ${BOT_OUT} Z`;

/* The cover board, drawn behind and a little proud of the paper on every side —
   which is the detail that stops an open book reading as two sheets of A4. */
const COVER_PATH =
    `M 34 190 C 88 195, 142 210, ${GUT} 220 C 202 210, 256 195, 310 190 ` +
    `L 310 330 C 256 335, 202 350, ${GUT} 360 C 142 350, 88 335, 34 330 Z`;

/* Cut edges of the pages still lying under the open ones. */
const BLOCK_EDGES = [0, 1, 2].flatMap((j) => [
    { key: `bl-${j}`, d: `M ${OUT_L} ${BOT_OUT + 4 * j} C 92 ${BOT_OUT + 6 + 4 * j}, 142 ${BOT_GUT - 9 + 4 * j}, ${GUT} ${BOT_GUT + 4 * j}` },
    { key: `br-${j}`, d: `M ${OUT_R} ${BOT_OUT + 4 * j} C 252 ${BOT_OUT + 6 + 4 * j}, 202 ${BOT_GUT - 9 + 4 * j}, ${GUT} ${BOT_GUT + 4 * j}` },
]);

/* Body copy, curving with the paper. Each line drops as it runs into the
   gutter, by the same sag the page edges use. The last line of each page is
   short, because a paragraph that ends flush reads as a placeholder. */
const TEXT_LINES = Array.from({ length: 8 }, (_, i) => {
    const yOuter = 216 + i * 13;
    const yGutter = yOuter + 24;
    const last = i === 7;
    return {
        i,
        left: `M 58 ${yOuter} Q 110 ${yOuter + 14} ${last ? 128 : 160} ${last ? yOuter + 19 : yGutter}`,
        right: `M ${last ? 216 : 184} ${last ? yOuter + 19 : yGutter} Q 234 ${yOuter + 14} 286 ${yOuter}`,
    };
});

/* Leaves peeling off the fore-edge — where the letters are coming from. */
const LIFTING = [0, 1, 2].map((i) => ({
    i,
    d:
        `M ${OUT_R} ${206 + i * 2} ` +
        `C ${330 + i * 16} ${186 - i * 14}, ${354 + i * 24} ${190 - i * 18}, ${364 + i * 26} ${212 - i * 14} ` +
        `C ${358 + i * 24} 256, ${336 + i * 16} ${290 - i * 4}, ${OUT_R} ${310 - i * 2} Z`,
    opacity: 1 - i * 0.26,
}));

/* -------------------------------------------------------------- the flight */

const GLYPHS = ["§", "A", "e", "¶", "n", "o", "t", "r", "s", "i", "a", "l", "m", "d", "e", "c"];

const LETTERS = GLYPHS.map((ch, i) => {
    const t = i / (GLYPHS.length - 1);
    const wobble = ((i * 5) % 7) - 3;
    /* Wide at the page, narrow at the screen. The convergence is what makes the
       stream read as going somewhere rather than merely scattering. */
    const spread = 120 * (1 - t * 0.75);
    return {
        ch,
        i,
        x: Math.round(344 + t * 190 + wobble * 5),
        y: Math.round(236 + Math.sin(i * 1.9) * spread),
        size: Math.round(26 - t * 15 + (i % 3) * 2),
        rotate: Math.round(Math.sin(i * 2.4) * 26),
        opacity: Number((0.95 - t * 0.3).toFixed(2)),
        gold: i % 3 === 0,
    };
});

/* ------------------------------------------------------------ the e-reader */

const DEV_X = 498;
const SCREEN_X = 510;
const SCREEN_W = 110;
const SCREEN_MID = SCREEN_X + SCREEN_W / 2; // 565

const SCREEN_BODY = [88, 80, 86, 64, 84, 76, 88, 70, 58].map((w, i) => ({
    width: w,
    y: 188 + i * 11,
}));

/** Two rules and a diamond. The same mark sits on the page and on the screen. */
function Ornament({ cx, cy, reach, size = 4 }) {
    return (
        <g>
            <line x1={cx - reach} y1={cy} x2={cx - size - 3} y2={cy} stroke={GOLD} strokeWidth="0.9" />
            <line x1={cx + size + 3} y1={cy} x2={cx + reach} y2={cy} stroke={GOLD} strokeWidth="0.9" />
            <polygon
                points={`${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`}
                fill={GOLD}
            />
        </g>
    );
}

export default function FormatSplitGraphic({ className = "" }) {
    return (
        <svg
            viewBox="0 0 660 420"
            className={`w-full h-auto ${className}`}
            role="img"
            aria-label="An open Oakbridge book with its letters lifting off the page and streaming into an e-reader, where they settle as the same text"
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id="fg-page-l" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="70%" stopColor="#F2F5F9" />
                    <stop offset="100%" stopColor="#D2DCE6" />
                </linearGradient>
                <linearGradient id="fg-page-r" x1="1" y1="0" x2="0" y2="0">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="70%" stopColor="#F2F5F9" />
                    <stop offset="100%" stopColor="#D2DCE6" />
                </linearGradient>
                <linearGradient id="fg-leaf" x1="0" y1="0" x2="1" y2="0.3">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="100%" stopColor="#DCE4ED" />
                </linearGradient>
                <linearGradient id="fg-cover" x1="0" y1="0" x2="0.3" y2="1">
                    <stop offset="0%" stopColor="#0A3A6E" />
                    <stop offset="60%" stopColor="#002B5C" />
                    <stop offset="100%" stopColor="#00142E" />
                </linearGradient>
                <linearGradient id="fg-device" x1="0" y1="0" x2="0.45" y2="1">
                    <stop offset="0%" stopColor="#11406F" />
                    <stop offset="100%" stopColor="#00173A" />
                </linearGradient>
                <linearGradient id="fg-screen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="100%" stopColor="#E9EFF6" />
                </linearGradient>
                {/* The valley where the paper turns into the spine. Nothing says
                    "open book" faster than this and nothing else in the drawing
                    needs it. */}
                <linearGradient id="fg-gutter" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#7A8AA0" stopOpacity="0" />
                    <stop offset="50%" stopColor="#5A6C86" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#7A8AA0" stopOpacity="0" />
                </linearGradient>
                <radialGradient id="fg-glow">
                    <stop offset="0%" stopColor={GOLD} stopOpacity="0.4" />
                    <stop offset="55%" stopColor={GOLD} stopOpacity="0.1" />
                    <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
                </radialGradient>
                <radialGradient id="fg-cast">
                    <stop offset="0%" stopColor={INK} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={INK} stopOpacity="0" />
                </radialGradient>
                <filter id="fg-lift" x="-40%" y="-40%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor={INK} floodOpacity="0.28" />
                </filter>
                <filter id="fg-soft" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="4.5" />
                </filter>
            </defs>

            {/* Heat of the transfer, and the book's own shadow on the surface. */}
            <ellipse cx="430" cy="230" rx="205" ry="180" fill="url(#fg-glow)" />
            <ellipse cx="172" cy="368" rx="150" ry="26" fill="url(#fg-cast)" />

            {/* ---------------- the open book ---------------- */}
            <g>
                <path d={COVER_PATH} fill="url(#fg-cover)" />

                {/* Leaves peeling off the fore-edge, behind the flat pages so
                    their roots tuck under rather than butting against them. */}
                {LIFTING.map((leaf) => (
                    <path
                        key={`lift-${leaf.i}`}
                        d={leaf.d}
                        fill="url(#fg-leaf)"
                        stroke={RULE}
                        strokeWidth="1"
                        opacity={leaf.opacity}
                    />
                ))}

                {BLOCK_EDGES.map((e) => (
                    <path key={e.key} d={e.d} fill="none" stroke="#C6D0DB" strokeWidth="0.8" />
                ))}

                <path d={pagePath(OUT_L, 1)} fill="url(#fg-page-l)" />
                <path d={pagePath(OUT_R, -1)} fill="url(#fg-page-r)" />
                <rect x={GUT - 14} y={TOP_GUT} width="28" height={BOT_GUT - TOP_GUT} fill="url(#fg-gutter)" />

                {/* Running head — the same words the screen carries. */}
                <text
                    x="235"
                    y="212"
                    fontFamily={FACE}
                    fontSize="7.5"
                    letterSpacing="1.4"
                    fontWeight="600"
                    fill={INK}
                    opacity="0.5"
                    textAnchor="middle"
                >
                    THE COMMENTARY
                </text>

                <g stroke={INK} strokeOpacity="0.34" strokeWidth="2.4" strokeLinecap="round" fill="none">
                    {TEXT_LINES.map((l) => (
                        <React.Fragment key={`tl-${l.i}`}>
                            <path d={l.left} />
                            {l.i > 0 && <path d={l.right} />}
                        </React.Fragment>
                    ))}
                </g>

                <text x="70" y="330" fontFamily={FACE} fontSize="7" fill={INK} opacity="0.4">248</text>
                <text x="278" y="330" fontFamily={FACE} fontSize="7" fill={INK} opacity="0.4" textAnchor="end">249</text>
            </g>

            {/* ---------------- the letters in flight ---------------- */}
            {/* Gold ones are drawn twice — a blurred pass underneath — so they
                glow without a filter over the whole group, which would soften
                the navy ones too and cost far more to composite. */}
            <g filter="url(#fg-soft)" opacity="0.75">
                {LETTERS.filter((l) => l.gold).map((l) => (
                    <text
                        key={`glow-${l.i}`}
                        x={l.x}
                        y={l.y}
                        fontFamily={FACE}
                        fontSize={l.size}
                        fontWeight="700"
                        fill={GOLD}
                        textAnchor="middle"
                        transform={`rotate(${l.rotate} ${l.x} ${l.y})`}
                    >
                        {l.ch}
                    </text>
                ))}
            </g>
            {LETTERS.map((l) => (
                <text
                    key={`ltr-${l.i}`}
                    x={l.x}
                    y={l.y}
                    fontFamily={FACE}
                    fontSize={l.size}
                    fontWeight={l.gold ? 700 : 600}
                    fill={l.gold ? GOLD : INK}
                    opacity={l.gold ? l.opacity : l.opacity * 0.6}
                    textAnchor="middle"
                    transform={`rotate(${l.rotate} ${l.x} ${l.y})`}
                >
                    {l.ch}
                </text>
            ))}

            {/* ---------------- the e-reader ---------------- */}
            <g filter="url(#fg-lift)">
                <rect x={DEV_X} y="70" width="134" height="300" rx="12" fill="url(#fg-device)" />
                <rect x={SCREEN_X} y="90" width={SCREEN_W} height="240" fill="url(#fg-screen)" />

                <text x={SCREEN_MID} y="126" fontFamily={FACE} fontSize="8.5" letterSpacing="2.4" fontWeight="600" fill={INK} textAnchor="middle">
                    THE
                </text>
                <text x={SCREEN_MID} y="145" fontFamily={FACE} fontSize="10" letterSpacing="0.4" fontWeight="600" fill={INK} textAnchor="middle">
                    COMMENTARY
                </text>
                <Ornament cx={SCREEN_MID} cy={164} reach={22} size={3.5} />

                <g fill={INK} opacity="0.6">
                    {SCREEN_BODY.map((b, i) => (
                        <rect key={`sb-${i}`} x="520" y={b.y} width={b.width} height="3" rx="1.5" />
                    ))}
                </g>

                {/* Reading position — the one thing on the screen with no printed
                    counterpart, so the one thing left in gold. */}
                <rect x="520" y="296" width="90" height="3" rx="1.5" fill={RULE} />
                <rect x="520" y="296" width="26" height="3" rx="1.5" fill={GOLD} />
                <text x="520" y="315" fontFamily={FACE} fontSize="7" fontWeight="500" fill={INK} opacity="0.45">
                    Page 248 of 612
                </text>
                <text x="610" y="315" fontFamily={FACE} fontSize="7" fontWeight="500" fill={INK} opacity="0.45" textAnchor="end">
                    41%
                </text>

                <circle cx={SCREEN_MID} cy="350" r="4.5" fill="#FFFFFF" opacity="0.3" />
            </g>
        </svg>
    );
}
