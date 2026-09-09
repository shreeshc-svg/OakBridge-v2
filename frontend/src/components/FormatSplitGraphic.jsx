import React from "react";

/**
 * An open book releasing its type into an e-reader.
 *
 * WHY THIS IS THE ONE ILLUSTRATION ALLOWED DEPTH
 *
 * The rest of the site is flat fills and hairlines, and earlier attempts at
 * this drawing obeyed that. They read as diagrams: grey bars standing in for
 * words look like a loading skeleton, and a flat elevation of a book has no
 * moment in it. This one is asked to sell rather than to explain, so it gets
 * gradients, a cast shadow and a glow. Nothing else does — including the cloud
 * panel directly beneath it, which a test keeps flat, because a flat design
 * language dies by copy-paste.
 *
 * TWO COLOUR FAMILIES THAT EXIST ONLY HERE
 *
 * Paper cream and a cool blue. Neither is in the site palette, and both are
 * deliberate: pure white paper read as a UI mockup rather than a book, and the
 * digital side needs a colour the printed side does not have. A test confines
 * both families to this file.
 *
 * WHY THE COLOUR STEPS RATHER THAN BLENDS
 *
 * Gold interpolated to blue passes through a desaturated olive, and the middle
 * of the stream — the part the eye actually follows — turns to mud. So the
 * letters are warm near the page, cool near the screen, and alternate across
 * the handover. The transition reads without a dead zone in it.
 *
 * WHY THE BOOK IS NAMED FROM CONTENT
 *
 * A hardcoded title is a product claim baked into an illustration. The title,
 * author, chapter and extent come from admin content keys, so the featured book
 * can change without a deploy — and the page count drives the reading position
 * and the percentage, so those three numbers can never contradict each other.
 *
 * SAFE ON A PRERENDERED ROUTE
 *
 * One inline SVG, fixed viewBox, nothing fetched, so the browser knows the
 * aspect ratio before a byte of network arrives. Gradient and filter ids carry
 * an `fg-` prefix because SVG ids are global to the document and this drawing
 * shares a page with another one.
 */

const GOLD = "#F59E0B";
const BLUE = "#2F6FB5"; // the digital side. Used nowhere else on the site.
const INK = "#002B5C";
const FACE = "Public Sans, ui-sans-serif, system-ui, sans-serif";

/* --------------------------------------------------------------- the book */

const GUT = 178;
const OUT_L = 40;
const OUT_R = 316;
const TOP_OUT = 158;
const TOP_GUT = 184;
const BOT_OUT = 314;
const BOT_GUT = 340;

/* One page: out along the top edge into the gutter, down the gutter, back out
   along the bottom. `dir` is +1 for the left page, -1 for its mirror. */
const pagePath = (outer, dir) =>
    `M ${outer} ${TOP_OUT} C ${outer + dir * 48} ${TOP_OUT + 4}, ${GUT - dir * 30} ${TOP_GUT - 9}, ${GUT} ${TOP_GUT} ` +
    `L ${GUT} ${BOT_GUT} C ${GUT - dir * 30} ${BOT_GUT - 9}, ${outer + dir * 48} ${BOT_OUT + 6}, ${outer} ${BOT_OUT} Z`;

/* The board, proud of the paper on every side — the detail that stops an open
   book reading as two sheets of A4. */
const COVER_PATH =
    `M 30 150 C 84 154, 146 170, ${GUT} 180 C 210 170, 272 154, 326 150 ` +
    `L 326 328 C 272 332, 210 348, ${GUT} 358 C 146 348, 84 332, 30 328 Z`;

const BLOCK_EDGES = [0, 1, 2].flatMap((j) => [
    { key: `bl-${j}`, d: `M ${OUT_L} ${BOT_OUT + 4 * j} C 88 ${BOT_OUT + 6 + 4 * j}, 148 ${BOT_GUT - 9 + 4 * j}, ${GUT} ${BOT_GUT + 4 * j}` },
    { key: `br-${j}`, d: `M ${OUT_R} ${BOT_OUT + 4 * j} C 268 ${BOT_OUT + 6 + 4 * j}, 208 ${BOT_GUT - 9 + 4 * j}, ${GUT} ${BOT_GUT + 4 * j}` },
]);

/* Leaves peeling off the right-hand page and curling away — where the letters
   are coming from. */
const LEAVES = [0, 1, 2, 3, 4].map((i) => {
    const sx = 302 - i * 7;
    const tipX = 334 + i * 17;
    const tipTop = 152 - i * 13;
    const tipBottom = 316 - i * 5;
    return {
        i,
        rootX: sx, // the pivot the flutter turns about
        d:
            `M ${sx} ${172 + i * 3} C ${sx + 26} ${162 - i * 8}, ${tipX - 22} ${tipTop - 6}, ${tipX} ${tipTop} ` +
            `C ${tipX + 11} ${(tipTop + tipBottom) / 2}, ${tipX - 6} ${tipBottom - 14}, ${tipX - 14} ${tipBottom} ` +
            `C ${tipX - 40} ${tipBottom + 6}, ${sx + 20} ${330 - i * 3}, ${sx} ${328 - i * 4} Z`,
        opacity: 0.96 - i * 0.15,
    };
});

/* -------------------------------------------------------------- the flight */

const GLYPHS = ["§", "C", "l", "¶", "i", "m", "a", "t", "e", "J", "u", "s", "t", "i", "c", "e", "§", "r"];

const LETTERS = GLYPHS.map((ch, i) => {
    const t = i / (GLYPHS.length - 1);
    const wobble = ((i * 5) % 7) - 3;
    /* Wide at the page, narrow at the screen: the convergence is what makes the
       stream read as going somewhere rather than merely scattering. */
    const spread = 118 * (1 - t * 0.76);
    return {
        ch,
        i,
        x: Math.round(330 + t * 168 + wobble * 5),
        y: Math.round(240 + Math.sin(i * 1.9) * spread),
        size: Math.round(27 - t * 16 + (i % 3) * 2),
        rotate: Math.round(Math.sin(i * 2.4) * 28),
        opacity: Number((0.96 - t * 0.3).toFixed(2)),
        colour: t < 0.36 ? GOLD : t > 0.64 ? BLUE : i % 2 ? GOLD : BLUE,
        /* Spread across the whole 5.2s cycle, and negative so every letter is
           already part-way through it on the first frame. */
        delay: `${(-(t * 5.2)).toFixed(2)}s`,
    };
});

/* Torn page scraps travelling with the letters. Without them the flight reads
   as a font specimen rather than as a book coming apart. */
const SCRAPS = [0, 1, 2, 3].map((i) => {
    const t = (i + 1) / 6;
    const x = 346 + t * 90;
    const y = 190 + ((i * 67) % 150);
    const s = 13 - i * 2;
    return { i, x, y, s, rotate: (i * 47) % 360, opacity: 0.7 - i * 0.12 };
});

/* The last of the paper, already pixels, arriving at the screen. */
const PIXELS = Array.from({ length: 14 }, (_, i) => {
    const t = i / 13;
    return {
        i,
        x: Math.round(404 + t * 80 + (((i * 7) % 5) - 2) * 4),
        y: 190 + ((i * 53) % 130),
        size: Math.max(3, 8 - Math.round(t * 4) + (i % 2)),
        opacity: Number((0.7 - t * 0.35).toFixed(2)),
        delay: `${(-(t * 3.6)).toFixed(2)}s`,
    };
});

/* ------------------------------------------------------------ the e-reader */

const DEV_X = 496;
const SCREEN_X = 508;
const SCREEN_W = 112;
const SCREEN_MID = SCREEN_X + SCREEN_W / 2; // 564

const SCREEN_BODY = [90, 82, 88, 66, 86, 78, 90, 72, 60].map((w, i) => ({
    width: w,
    y: 206 + i * 11,
}));

/* Split a title into at most two balanced lines. A long title set on one line
   either overflows the page or has to be shrunk until it is unreadable. */
function titleLines(title) {
    const words = String(title || "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return words;
    let best = 1;
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(" ").length;
        const b = words.slice(i).join(" ").length;
        if (Math.abs(a - b) < bestDiff) {
            bestDiff = Math.abs(a - b);
            best = i;
        }
    }
    return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/** Two rules and a diamond. The same mark sits on the page and on the screen. */
function Ornament({ cx, cy, reach, size = 3.5 }) {
    return (
        <g>
            <line x1={cx - reach} y1={cy} x2={cx - size - 3} y2={cy} stroke={GOLD} strokeWidth="0.9" />
            <line x1={cx + size + 3} y1={cy} x2={cx + reach} y2={cy} stroke={GOLD} strokeWidth="0.9" />
            <polygon points={`${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`} fill={GOLD} />
        </g>
    );
}

export default function FormatSplitGraphic({
    title = "Climate Justice",
    author = "Sudhir Mishra",
    chapter = "Chapter One",
    pages = 231,
    animate = true,
    className = "",
}) {
    /* Classes are added rather than the keyframes switched off, so with
       animation disabled the markup carries no animated class at all — nothing
       to compute, and nothing a future stylesheet can reanimate by accident. */
    const cls = (name) => (animate ? name : undefined);
    const at_ = (style) => (animate ? style : undefined);
    const lines = titleLines(title);
    /* Reading position, extent and percentage are derived from one number, so
       the three can never contradict each other on screen. */
    const total = Math.max(1, parseInt(pages, 10) || 231);
    const at = Math.max(1, Math.round(total * 0.2));
    const pct = Math.round((at / total) * 100);
    const chapterCaps = String(chapter || "").toUpperCase();

    return (
        <svg
            viewBox="0 0 660 420"
            className={`w-full h-auto ${className}`}
            role="img"
            aria-label={`An open copy of ${title} with its letters lifting off the page and streaming into an e-reader, where they settle as the same text`}
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id="fg-pl" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#FBF6EC" />
                    <stop offset="70%" stopColor="#F6EFE1" />
                    <stop offset="100%" stopColor="#E6DCC8" />
                </linearGradient>
                <linearGradient id="fg-pr" x1="1" y1="0" x2="0" y2="0">
                    <stop offset="0%" stopColor="#FBF6EC" />
                    <stop offset="70%" stopColor="#F6EFE1" />
                    <stop offset="100%" stopColor="#E6DCC8" />
                </linearGradient>
                <linearGradient id="fg-leaf" x1="0" y1="0" x2="1" y2="0.4">
                    <stop offset="0%" stopColor="#FFFDF8" />
                    <stop offset="100%" stopColor="#E7DCC7" />
                </linearGradient>
                <linearGradient id="fg-cover" x1="0" y1="0" x2="0.4" y2="1">
                    <stop offset="0%" stopColor="#0A3A6E" />
                    <stop offset="60%" stopColor="#002B5C" />
                    <stop offset="100%" stopColor="#00142E" />
                </linearGradient>
                <linearGradient id="fg-dev" x1="0" y1="0" x2="0.45" y2="1">
                    <stop offset="0%" stopColor="#123F6B" />
                    <stop offset="100%" stopColor="#00152F" />
                </linearGradient>
                <linearGradient id="fg-scr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="100%" stopColor="#EAF0F7" />
                </linearGradient>
                {/* The valley where the paper turns into the spine. */}
                <linearGradient id="fg-gut" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#9C8E74" stopOpacity="0" />
                    <stop offset="50%" stopColor="#8B7C60" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#9C8E74" stopOpacity="0" />
                </linearGradient>
                {/* Warm where the paper is, cool where the screen is. These two
                    washes replace the reference's black vignette, which cannot
                    meet a white page without a hard edge.

                    The extra stop at 86% is not decoration. A radial gradient
                    is only transparent at its own outer edge, so a wash whose
                    ellipse extends past the viewBox gets sliced off part way
                    down its falloff and leaves a visible straight line — which
                    is exactly what the blue one did, cut at roughly 5% opacity
                    down the right-hand side. Reaching zero early means even a
                    clipped wash meets the edge at nothing. */}
                <radialGradient id="fg-warm">
                    <stop offset="0%" stopColor={GOLD} stopOpacity="0.22" />
                    <stop offset="60%" stopColor={GOLD} stopOpacity="0.08" />
                    <stop offset="86%" stopColor={GOLD} stopOpacity="0.01" />
                    <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
                </radialGradient>
                <radialGradient id="fg-cool">
                    <stop offset="0%" stopColor={BLUE} stopOpacity="0.2" />
                    <stop offset="60%" stopColor={BLUE} stopOpacity="0.07" />
                    <stop offset="86%" stopColor={BLUE} stopOpacity="0.01" />
                    <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
                </radialGradient>
                <radialGradient id="fg-cast">
                    <stop offset="0%" stopColor={INK} stopOpacity="0.26" />
                    <stop offset="100%" stopColor={INK} stopOpacity="0" />
                </radialGradient>
                {/* dy + 3×stdDeviation is how far the shadow actually reaches.
                    At 12 and 14 the device's shadow landed on y=420, the bottom
                    of the canvas, and was cut flat. 10 and 11 finishes at 409. */}
                <filter id="fg-lift" x="-40%" y="-40%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="10" stdDeviation="11" floodColor={INK} floodOpacity="0.26" />
                </filter>
                {/* fg-lift is the only filter left, and it is on the device,
                    which does NOT animate — so its shadow is composited once
                    and never recomputed. Nothing that moves is filtered. */}
            </defs>

            {/* Both washes are sized to finish INSIDE the viewBox — SVG clips
                to it, and a gradient that ends outside is a straight edge. The
                blue one used to run to x=705 against a 660 canvas. */}
            {/* The cool halo beats a third of a cycle behind the warm one, so
                the pulse reads as travelling from the page to the screen rather
                than as the whole picture throbbing at once. */}
            <ellipse cx="228" cy="234" rx="208" ry="172" fill="url(#fg-warm)" className={cls("fg-halo")} />
            <ellipse
                cx="498"
                cy="224"
                rx="152"
                ry="166"
                fill="url(#fg-cool)"
                className={cls("fg-halo")}
                style={at_({ animationDelay: "0.85s" })}
            />
            <ellipse cx="178" cy="366" rx="150" ry="24" fill="url(#fg-cast)" />

            {/* ---------------- the open book ---------------- */}
            <g className={cls("fg-book")} style={{ transformOrigin: "178px 254px" }}>
                <path d={COVER_PATH} fill="url(#fg-cover)" />
                {BLOCK_EDGES.map((e) => (
                    <path key={e.key} d={e.d} fill="none" stroke="#CFC4AC" strokeWidth="0.8" />
                ))}

                <path d={pagePath(OUT_R, -1)} fill="url(#fg-pr)" />
                {LEAVES.map((leaf) => (
                    <path
                        key={`leaf-${leaf.i}`}
                        d={leaf.d}
                        fill="url(#fg-leaf)"
                        stroke="#DCD0B8"
                        strokeWidth="0.9"
                        opacity={leaf.opacity}
                        className={cls("fg-leaf")}
                        /* Pivot at the leaf's own root, near the spine, and
                           each one a beat behind the last so the fan ripples
                           instead of moving as a single slab. */
                        style={{
                            transformOrigin: `${leaf.rootX}px 250px`,
                            ...(animate ? { animationDelay: `${(leaf.i * -0.6).toFixed(2)}s` } : {}),
                        }}
                    />
                ))}
                <path d={pagePath(OUT_L, 1)} fill="url(#fg-pl)" />
                <rect x={GUT - 13} y={TOP_GUT} width="26" height={BOT_GUT - TOP_GUT} fill="url(#fg-gut)" />

                {/* The left page carries the title block; the right page is
                    already coming apart, so it carries only body text. */}
                <text x="105" y="204" fontFamily={FACE} fontSize="6.5" letterSpacing="2" fontWeight="600" fill={INK} opacity="0.5" textAnchor="middle">
                    {chapterCaps}
                </text>
                {lines.map((line, i) => (
                    <text
                        key={`t-${i}`}
                        x="105"
                        y={230 + i * 18}
                        fontFamily={FACE}
                        fontSize="15"
                        letterSpacing="0.4"
                        fontWeight="700"
                        fill={INK}
                        textAnchor="middle"
                    >
                        {line}
                    </text>
                ))}
                <Ornament cx={105} cy={230 + lines.length * 18} reach={26} />
                <text x="105" y={250 + lines.length * 18} fontFamily={FACE} fontSize="7" letterSpacing="1.2" fontWeight="500" fill={INK} opacity="0.62" textAnchor="middle">
                    {String(author || "").toUpperCase()}
                </text>
                <g stroke={INK} strokeOpacity="0.26" strokeWidth="2" strokeLinecap="round" fill="none">
                    {[0, 1, 2].map((i) => (
                        <path key={`lb-${i}`} d={`M 62 ${300 + i * 10} Q 105 ${304 + i * 10} 150 ${306 + i * 10}`} />
                    ))}
                </g>
                <text x="105" y="332" fontFamily={FACE} fontSize="6" fill={INK} opacity="0.35" textAnchor="middle">
                    {at}
                </text>

                <g stroke={INK} strokeOpacity="0.22" strokeWidth="2" strokeLinecap="round" fill="none">
                    {Array.from({ length: 7 }, (_, i) => (
                        <path key={`rb-${i}`} d={`M 200 ${208 + i * 15} Q 250 ${202 + i * 15} 296 ${196 + i * 15}`} />
                    ))}
                </g>
            </g>

            {/* ---------------- the flight ---------------- */}
            {SCRAPS.map((s) => (
                <g
                    key={`scrap-${s.i}`}
                    className={cls("fg-scrap")}
                    style={at_({ animationDelay: `${(-1.6 * s.i).toFixed(2)}s` })}
                >
                    <g transform={`rotate(${s.rotate} ${s.x} ${s.y})`} opacity={s.opacity}>
                        <path
                        d={
                            `M ${s.x - s.s} ${s.y - s.s} C ${s.x} ${s.y - s.s - 4}, ${s.x + s.s} ${s.y - s.s + 3}, ${s.x + s.s} ${s.y - s.s} ` +
                            `L ${s.x + s.s} ${s.y + s.s} C ${s.x} ${s.y + s.s + 4}, ${s.x - s.s} ${s.y + s.s - 3}, ${s.x - s.s} ${s.y + s.s} Z`
                        }
                            fill="#FFFDF8"
                            stroke="#DCD0B8"
                            strokeWidth="0.7"
                        />
                    </g>
                </g>
            ))}

            {/* A blurred pass under every third letter, so the stream glows
                without a filter over the whole group softening all of it. */}
            {/* THE BLOOM PASS — and why it is not a blur.

                This used to be the same letters inside a feGaussianBlur, which
                looks lovely and is the wrong thing to animate: a filtered
                region re-runs its blur on every frame, so six moving letters
                would have had the browser recomputing a Gaussian over a
                170×200 area sixty times a second, on a page whose visitors are
                largely on mid-range Android.

                A second copy at 1.3× and low opacity gives most of the halo for
                the cost of drawing text, which the compositor handles. Same
                delay as its solid twin, so the two travel together.

                Negative delays throughout, so on load the stream is already
                mid-flight along its whole length rather than firing as one
                burst the moment it renders. */}
            {LETTERS.filter((l) => l.i % 3 === 0).map((l) => (
                <g key={`glow-${l.i}`} className={cls("fg-letter")} style={at_({ animationDelay: l.delay })}>
                    <text
                        x={l.x}
                        y={l.y}
                        fontFamily={FACE}
                        fontSize={Math.round(l.size * 1.3)}
                        fontWeight="700"
                        fill={l.colour}
                        opacity="0.22"
                        textAnchor="middle"
                        transform={`rotate(${l.rotate} ${l.x} ${l.y})`}
                    >
                        {l.ch}
                    </text>
                </g>
            ))}
            {LETTERS.map((l) => (
                <g key={`ltr-${l.i}`} className={cls("fg-letter")} style={at_({ animationDelay: l.delay })}>
                    <text
                        x={l.x}
                        y={l.y}
                        fontFamily={FACE}
                        fontSize={l.size}
                        fontWeight={l.i % 3 === 0 ? 700 : 600}
                        fill={l.colour}
                        opacity={l.opacity}
                        textAnchor="middle"
                        transform={`rotate(${l.rotate} ${l.x} ${l.y})`}
                    >
                        {l.ch}
                    </text>
                </g>
            ))}
            {PIXELS.map((p) => (
                <g key={`px-${p.i}`} className={cls("fg-pixel")} style={at_({ animationDelay: p.delay })}>
                    <rect x={p.x} y={p.y} width={p.size} height={p.size} fill={BLUE} opacity={p.opacity} />
                </g>
            ))}

            {/* ---------------- the e-reader ---------------- */}
            <g filter="url(#fg-lift)">
                <rect x={DEV_X} y="78" width="130" height="288" rx="12" fill="url(#fg-dev)" />
                <rect x={SCREEN_X} y="94" width={SCREEN_W} height="238" fill="url(#fg-scr)" />

                {/* A status bar costs six rectangles and buys most of the
                    realism in the device. */}
                <text x="514" y="106" fontFamily={FACE} fontSize="6" fontWeight="600" fill={INK} opacity="0.5">9:41</text>
                <g fill={INK} opacity="0.42">
                    <rect x="584" y="101" width="2" height="6" rx="1" />
                    <rect x="588" y="99" width="2" height="8" rx="1" />
                    <rect x="592" y="97" width="2" height="10" rx="1" />
                    <rect x="596" y="101" width="14" height="6" rx="1.5" />
                    <rect x="611" y="103" width="2" height="2" rx="0.5" />
                </g>

                <text x={SCREEN_MID} y="130" fontFamily={FACE} fontSize="6" letterSpacing="1.8" fontWeight="600" fill={INK} opacity="0.5" textAnchor="middle">
                    {chapterCaps}
                </text>
                {lines.map((line, i) => (
                    <text
                        key={`st-${i}`}
                        x={SCREEN_MID}
                        y={154 + i * 16}
                        fontFamily={FACE}
                        fontSize="13"
                        fontWeight="700"
                        fill={INK}
                        textAnchor="middle"
                    >
                        {line}
                    </text>
                ))}
                <Ornament cx={SCREEN_MID} cy={155 + lines.length * 16} reach={22} size={3.2} />

                {/* Each line brightens a beat after the one above it, so the
                    text appears to settle down the screen as the letters
                    arrive. Staggered forwards, not backwards — this one is
                    meant to be read as an event, not to be already running. */}
                <g fill={INK} opacity="0.55">
                    {SCREEN_BODY.map((b, i) => (
                        <rect
                            key={`sb-${i}`}
                            x="519"
                            y={b.y}
                            width={b.width}
                            height="3"
                            rx="1.5"
                            className={cls("fg-line")}
                            style={at_({ animationDelay: `${(i * 0.13).toFixed(2)}s` })}
                        />
                    ))}
                </g>

                <rect x="519" y="308" width="90" height="3" rx="1.5" fill="#E5E7EB" />
                <rect x="519" y="308" width={Math.max(4, Math.round(90 * (pct / 100)))} height="3" rx="1.5" fill={BLUE} />
                <text x="519" y="324" fontFamily={FACE} fontSize="6.5" fontWeight="500" fill={INK} opacity="0.45">
                    {`Page ${at} of ${total}`}
                </text>
                <text x="609" y="324" fontFamily={FACE} fontSize="6.5" fontWeight="500" fill={INK} opacity="0.45" textAnchor="end">
                    {`${pct}%`}
                </text>

                <circle cx={SCREEN_MID} cy="348" r="4.5" fill="#FFFFFF" opacity="0.28" />
            </g>
        </svg>
    );
}
