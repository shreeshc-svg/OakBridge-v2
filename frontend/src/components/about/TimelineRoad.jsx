import React from "react";

/**
 * The About timeline as a road climbing a mountain, every year open at once.
 *
 * WHY THIS SHAPE
 *
 * Nine years of milestones ran past the fold, so "how far has this company
 * come" cost a scroll and a memory. A climb answers it in one look: 2017 at the
 * foot of the frame, today at the summit, and the distance between them is the
 * point of the graphic.
 *
 * WHY EVERY CARD IS OPEN
 *
 * The first version showed two years permanently and hid the other eight behind
 * hover, with a floating panel in the corner that changed as you pointed. That
 * failed twice over: eight years were invisible at rest, and the panel was a
 * second copy of whichever card you were already looking at. Nothing is hidden
 * now, nothing needs pointing at, and no year appears twice.
 *
 * WHY THE CARDS ARE DRAWN IN SVG RATHER THAN HTML
 *
 * Ten boxes cannot be placed without knowing exactly how big they are. HTML
 * cards wrap their own text at a width the browser picks and report a height
 * only after layout — too late to place anything against them. Text here is
 * wrapped by this component, so a card's height is known BEFORE it is
 * positioned. That is what makes "no box overlaps anything" a property the
 * layout can be tested for rather than hoped for.
 *
 * It also means one scaling coordinate system: a narrow desktop renders the
 * same collision-free arrangement smaller, not a different broken one.
 */

/**
 * One milestone's text into discrete points.
 *
 * Single source of truth, imported by the list and the road. Three copies of
 * this had drifted apart — the now-deleted spine's copy did not strip a leading
 * bullet character, so a year where the editor typed their own dashes counted
 * as one point in the spine and three in the list.
 */
export function splitPoints(text) {
    return String(text || "")
        .split("\n")
        // Tolerate an author who types their own bullet character or dash.
        .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
        .filter(Boolean);
}

/**
 * The plain vertical timeline. Used below lg, and as the road's own fallback
 * when the mountain cannot hold the content — same markup either way, so the
 * two can never drift.
 */
export function MilestoneList({ items }) {
    return (
        <div className="space-y-0">
            {items.map((m, i) => {
                const points = splitPoints(m.text);
                return (
                    <div
                        key={`${m.id || m.year || ""}-${i}`}
                        className="grid grid-cols-12 gap-6 py-8 border-t border-[#002B5C]/20"
                    >
                        <div className="col-span-3 md:col-span-2 font-serif text-3xl text-[#CC0033]">
                            {m.year}
                        </div>
                        <div className="col-span-9 md:col-span-10 text-[#002B5C] leading-relaxed">
                            {points.length <= 1 ? (
                                <p>{points[0] || ""}</p>
                            ) : (
                                <ul className="space-y-2 list-disc pl-5 marker:text-[#CC0033]">
                                    {points.map((p, j) => (
                                        <li key={j}>{p}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

const VW = 1120;
const VH = 820;

const NAVY = "#002B5C";
const RED = "#CC0033";
const AMBER = "#F59E0B";
const GREY = "#4B5563";

// The climb: seven switchbacks from the foot (78,790) to the summit (858,175).
const ROAD =
    "M 78 790 C 240 784 332 746 374 686 C 416 626 374 574 288 552 " +
    "C 202 530 198 473 290 446 C 382 418 520 421 586 394 " +
    "C 652 366 626 317 546 298 C 466 279 476 235 566 219 " +
    "C 656 202 790 219 858 175";

// ---- Card metrics, in the same units as everything else --------------------
const PAD = 11;
const YEAR_H = 24; // year line plus the rule under it
const LINE_H = 16;
const GAP = 6; // between bullets
const BODY_SIZE = 13;
const BULLET_GUTTER = 9;
// Georgia at 19px. The year is drawn outside the wrapped body text, so it is
// the one string measure() does not size the card around — it is clipped to
// fit instead. Four digits never come close; an admin typing "2017-2018 (FY)"
// would otherwise spill out of a rectangle the collision grid believes is clear.
const YEAR_SIZE = 19;
const YEAR_CHAR_W = 10.5;
// Average glyph width for the body font at BODY_SIZE. Deliberately generous:
// over-estimating adds a line, under-estimating overflows the box that was
// measured for it, and only one of those is visible to a reader.
const CHAR_W = 6.7;

const CLEAR_ROAD = 15; // card-to-tarmac (the stroke is 11 wide)
const CLEAR_DOT = 16; // card-to-marker
const CLEAR_CARD = 12; // card-to-card
const MARGIN = 12; // card-to-frame
const GRID = 10; // placement resolution

/**
 * Card widths tried in order. A crowded timeline gets narrower, taller cards
 * rather than losing one; only when even the narrowest will not fit does the
 * road stand down and let the list render.
 */
const CARD_WIDTHS = [250, 222, 196, 174];

/** Beyond this the mountain is the wrong instrument and the list is better. */
export const ROAD_MAX_YEARS = 20;

/** Greedy wrap on whole words; over-long words are hard-broken so nothing overflows. */
function wrap(text, chars) {
    const out = [];
    let line = "";
    for (const word of String(text).split(/\s+/)) {
        if (!word) continue;
        if (!line.length) line = word;
        else if (line.length + 1 + word.length <= chars) line += " " + word;
        else {
            out.push(line);
            line = word;
        }
        while (line.length > chars) {
            out.push(line.slice(0, chars));
            line = line.slice(chars);
        }
    }
    if (line) out.push(line);
    return out.length ? out : [""];
}

function measure(points, w) {
    const chars = Math.max(8, Math.floor((w - PAD * 2 - BULLET_GUTTER) / CHAR_W));
    const wrapped = points.map((p) => wrap(p, chars));
    const lines = wrapped.reduce((n, x) => n + x.length, 0);
    return {
        wrapped,
        h: PAD + YEAR_H + lines * LINE_H + Math.max(0, points.length - 1) * GAP + PAD,
    };
}

/** Years are drawn, not wrapped, so they are clipped to the card instead. */
function clipYear(year, w) {
    const max = Math.max(3, Math.floor((w - PAD * 2) / YEAR_CHAR_W));
    const s = String(year || "");
    return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

const overlaps = (a, b, pad) =>
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export default function TimelineRoad({ items }) {
    const roadRef = React.useRef(null);
    const [layout, setLayout] = React.useState(null);
    const [hover, setHover] = React.useState(-1);

    const count = items.length;

    React.useLayoutEffect(() => {
        const path = roadRef.current;
        if (!path || !count) {
            setLayout(null);
            return;
        }
        if (count > ROAD_MAX_YEARS) {
            setLayout({ failed: true });
            return;
        }

        const L = path.getTotalLength();
        const at = (t) => path.getPointAtLength(Math.max(0, Math.min(1, t)) * L);

        const dots = items.map((m, i) => {
            const t = count === 1 ? 0.5 : 0.015 + (i / (count - 1)) * 0.97;
            const p = at(t);
            const n = splitPoints(m.text).length;
            return { i, x: p.x, y: p.y, r: 5 + Math.min(Math.max(n, 1), 4) * 1.6 };
        });

        // ---- Occupancy grid ------------------------------------------------
        // Everything a card must avoid — the road and every marker, each grown
        // by its clearance — is burned into a coarse grid once. A summed-area
        // table then answers "is this rectangle clear?" in constant time
        // regardless of its size, which is what makes it affordable to consider
        // every position in the frame for every card instead of guessing at a
        // handful of offsets. Guessing was the first implementation, and it
        // could not place the corner years at all.
        const cols = Math.ceil(VW / GRID);
        const rows = Math.ceil(VH / GRID);
        const blocked = new Uint8Array(cols * rows);
        const stamp = (cx, cy, rad) => {
            const c0 = Math.max(0, Math.floor((cx - rad) / GRID));
            const c1 = Math.min(cols - 1, Math.floor((cx + rad) / GRID));
            const r0 = Math.max(0, Math.floor((cy - rad) / GRID));
            const r1 = Math.min(rows - 1, Math.floor((cy + rad) / GRID));
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
        };
        for (let s = 0; s <= 600; s++) {
            const p = path.getPointAtLength((s / 600) * L);
            stamp(p.x, p.y, CLEAR_ROAD);
        }
        for (const d of dots) stamp(d.x, d.y, CLEAR_DOT + d.r);

        const W = cols + 1;
        const sums = new Int32Array(W * (rows + 1));
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                sums[(r + 1) * W + c + 1] =
                    blocked[r * cols + c] + sums[r * W + c + 1] + sums[(r + 1) * W + c] - sums[r * W + c];
            }
        }
        const hits = (x, y, w, h) => {
            const c0 = Math.max(0, Math.floor(x / GRID));
            const c1 = Math.min(cols - 1, Math.floor((x + w) / GRID));
            const r0 = Math.max(0, Math.floor(y / GRID));
            const r1 = Math.min(rows - 1, Math.floor((y + h) / GRID));
            if (c1 < c0 || r1 < r0) return false;
            return (
                sums[(r1 + 1) * W + c1 + 1] -
                    sums[r0 * W + c1 + 1] -
                    sums[(r1 + 1) * W + c0] +
                    sums[r0 * W + c0] >
                0
            );
        };

        // ---- Pack ----------------------------------------------------------
        //
        // Greedy placement is order-dependent and no single order is right.
        // Tallest-first gives the big cards the room they need, but leaves the
        // one-line years until last, by which point the ground beside their own
        // marker is taken — 2020 ended up in the opposite corner of the frame
        // with a leader line most of the way across the mountain. Road order
        // fixes that year and starves the tall ones instead.
        //
        // So four orders are tried and the best arrangement wins. "Best" is the
        // WORST leader line in each: one card stranded across the frame is what
        // a reader notices, and the total is only the tie-break.
        //
        // Re-placing one card at a time cannot get there. 2020 can only improve
        // if 2021 moves first, and neither improves alone — a single-card repair
        // pass measured exactly zero change on the real timeline.
        const gap2 = (r, d) => {
            const dx = Math.max(r.x - d.x, 0, d.x - (r.x + r.w));
            const dy = Math.max(r.y - d.y, 0, d.y - (r.y + r.h));
            return dx * dx + dy * dy;
        };

        const greedy = (order) => {
            const out = [];
            for (const card of order) {
                const d = dots[card.i];
                let best = null;
                let bestGap = Infinity;
                for (let y = MARGIN; y + card.h <= VH - MARGIN; y += GRID) {
                    for (let x = MARGIN; x + card.w <= VW - MARGIN; x += GRID) {
                        if (hits(x, y, card.w, card.h)) continue;
                        const rect = { x, y, w: card.w, h: card.h };
                        if (out.some((q) => overlaps(rect, q, CLEAR_CARD))) continue;
                        const g = gap2(rect, d);
                        if (g < bestGap) {
                            bestGap = g;
                            best = rect;
                        }
                    }
                }
                if (!best) return null;
                out.push({ ...card, ...best });
            }
            return out;
        };

        for (const w of CARD_WIDTHS) {
            const cards = items.map((m, i) => {
                const points = splitPoints(m.text);
                return { i, points, w, ...measure(points, w) };
            });

            const orderings = [
                [...cards].sort((a, b) => b.h - a.h), // tallest first
                [...cards].sort((a, b) => a.i - b.i), // along the road
                [...cards].sort((a, b) => b.i - a.i), // against the road
                [...cards].sort((a, b) => a.h - b.h), // smallest first
            ];

            let winner = null;
            let winnerScore = null;
            for (const order of orderings) {
                const placed = greedy(order);
                if (!placed) continue;
                const gaps = placed.map((c) => gap2(c, dots[c.i]));
                const score = [Math.max(...gaps), gaps.reduce((n, g) => n + g, 0)];
                if (
                    !winnerScore ||
                    score[0] < winnerScore[0] ||
                    (score[0] === winnerScore[0] && score[1] < winnerScore[1])
                ) {
                    winner = placed;
                    winnerScore = score;
                }
            }

            if (winner) {
                setLayout({ dots, cards: winner.sort((a, b) => a.i - b.i) });
                return;
            }
        }

        setLayout({ failed: true });
    }, [items, count]);

    /**
     * The path this component measures has to be in the document before the
     * layout pass, and has to STAY there through every early return.
     *
     * Putting the ref on the visible road deadlocked the component: the visible
     * SVG only rendered once `layout` existed, `layout` only existed once the
     * effect could read the ref, and the effect could only read the ref once
     * the SVG had rendered. The effect set layout to null, React bailed out on
     * the identical value, the deps never changed, and the timeline rendered
     * nothing at all — forever, and silently, since /about has no prerender
     * assertion that would have failed the build.
     *
     * Refs attach during commit, before layout effects run, so a zero-size copy
     * rendered on the very first pass is enough to break the cycle.
     */
    const measuringPath = (
        <svg
            width="0"
            height="0"
            aria-hidden="true"
            focusable="false"
            style={{ position: "absolute", width: 0, height: 0 }}
        >
            <path ref={roadRef} d={ROAD} fill="none" />
        </svg>
    );

    if (!count) return null;

    // Not measured yet: draw nothing visible for one frame rather than flashing
    // the list and snapping to the mountain.
    if (!layout) return measuringPath;
    if (layout.failed) {
        return (
            <>
                {measuringPath}
                <MilestoneList items={items} />
            </>
        );
    }

    // The measured layout belongs to a specific item list. When the admin edits
    // that list, React renders the new items against the old geometry for one
    // frame; indexing it would throw and, with no ErrorBoundary in this app,
    // blank the entire site.
    if (layout.cards.length !== count) return measuringPath;

    // Shortest line from the marker to the card's border.
    const anchor = (card, d) => ({
        x: Math.max(card.x, Math.min(d.x, card.x + card.w)),
        y: Math.max(card.y, Math.min(d.y, card.y + card.h)),
    });

    return (
        <div className="relative">
            {measuringPath}
            {/* The road is the only copy of this content on screen at lg+, so the
                full history is repeated here for screen readers rather than
                asking them to operate a mountain. */}
            <ul className="sr-only">
                {items.map((m, i) => (
                    <li key={`${m.id || m.year || ""}-${i}`}>
                        {m.year}: {splitPoints(m.text).join(" ")}
                    </li>
                ))}
            </ul>

            <svg
                viewBox={`0 0 ${VW} ${VH}`}
                width="100%"
                role="img"
                aria-label="Our history as a road climbing a mountain, one card per year."
                className="block border border-[#E5E7EB] bg-[#F5F7FA]"
            >
                <path d="M 0 642 L 150 451 L 245 547 L 370 358 L 470 492 L 560 410 L 640 547 L 720 642 Z" fill="#DCE3ED" />
                <path d="M 600 642 L 710 470 L 790 547 L 900 342 L 1010 500 L 1090 410 L 1120 465 L 1120 642 Z" fill="#DCE3ED" />
                <path d="M -20 820 L 210 549 L 330 642 L 560 342 L 700 465 L 880 131 L 1010 342 L 1120 243 L 1120 820 Z" fill="#C7D2E0" />
                <path d="M 880 131 L 936 216 L 906 205 L 880 230 L 854 200 L 826 216 Z" fill="#EEF2F7" />
                <path d="M -20 820 L 180 642 L 420 765 L 640 642 L 860 738 L 1120 618 L 1120 820 Z" fill="#B4C2D4" />

                <path d={ROAD} fill="none" stroke={NAVY} strokeWidth="11" strokeLinecap="round" />
                <path d={ROAD} fill="none" stroke="#F5F7FA" strokeWidth="2" strokeDasharray="9 11" strokeLinecap="round" />

                {layout.cards.map((card) => {
                    const d = layout.dots[card.i];
                    const a = anchor(card, d);
                    return (
                        <line
                            key={`lead-${card.i}`}
                            x1={d.x}
                            y1={d.y}
                            x2={a.x}
                            y2={a.y}
                            stroke={NAVY}
                            strokeWidth="1"
                            opacity={hover === card.i ? 0.8 : 0.3}
                        />
                    );
                })}

                {layout.dots.map((d) => (
                    <circle
                        key={`dot-${d.i}`}
                        cx={d.x}
                        cy={d.y}
                        r={hover === d.i ? d.r + 2 : d.r}
                        fill={hover === d.i ? RED : "#FFFFFF"}
                        stroke={NAVY}
                        strokeWidth="2.5"
                    />
                ))}

                {layout.cards.map((card) => {
                    const m = items[card.i];
                    const on = hover === card.i;
                    return (
                        <g
                            key={`card-${card.i}`}
                            onMouseEnter={() => setHover(card.i)}
                            onMouseLeave={() => setHover(-1)}
                        >
                            <rect
                                x={card.x}
                                y={card.y}
                                width={card.w}
                                height={card.h}
                                fill="#FFFFFF"
                                stroke={on ? RED : "#E5E7EB"}
                                strokeWidth="1"
                            />
                            <text
                                x={card.x + PAD}
                                y={card.y + PAD + 15}
                                fontFamily="Georgia, 'Times New Roman', serif"
                                fontSize={YEAR_SIZE}
                                fill={on ? RED : NAVY}
                            >
                                {clipYear(m.year, card.w)}
                            </text>
                            <line
                                x1={card.x + PAD}
                                y1={card.y + PAD + YEAR_H - 6}
                                x2={card.x + card.w - PAD}
                                y2={card.y + PAD + YEAR_H - 6}
                                stroke="#E5E7EB"
                                strokeWidth="1"
                            />
                            {card.wrapped.map((lines, bi) => {
                                const top =
                                    card.y +
                                    PAD +
                                    YEAR_H +
                                    bi * GAP +
                                    card.wrapped.slice(0, bi).reduce((n, x) => n + x.length, 0) * LINE_H;
                                return (
                                    <g key={bi}>
                                        <rect
                                            x={card.x + PAD}
                                            y={top + LINE_H / 2 - 6}
                                            width="4"
                                            height="4"
                                            fill={AMBER}
                                        />
                                        {lines.map((ln, li) => (
                                            <text
                                                key={li}
                                                x={card.x + PAD + BULLET_GUTTER}
                                                y={top + li * LINE_H + LINE_H - 4}
                                                fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                                                fontSize={BODY_SIZE}
                                                fill={GREY}
                                            >
                                                {ln}
                                            </text>
                                        ))}
                                    </g>
                                );
                            })}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}
