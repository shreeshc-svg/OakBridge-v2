import React from "react";

/**
 * The About timeline as one continuous road.
 *
 * WHY THE LAYOUT IS COMPUTED, NOT SEARCHED
 *
 * The previous version measured an SVG path in the DOM, wrapped text, then ran
 * a packer with an occupancy grid to hunt for somewhere each card would fit. It
 * produced good pictures and three separate outages: a ref deadlock that
 * rendered nothing at all, forever and silently; a stale-index crash that could
 * blank the whole site because this app has no ErrorBoundary; and cards landing
 * on the tarmac whenever the search ran out of room.
 *
 * None of that was necessary. Position the pins first and derive the road from
 * them, and every coordinate here is arithmetic on the item count — no
 * measurement, no effect, no ref, no search, nothing to be stale against.
 *
 * THE ONE RULE THAT MAKES IT WORK
 *
 *     AMP = ROAD_W / 2 + PIN_R + ROAD_GAP
 *
 * The wave's amplitude is exactly half the road's width, plus a pin's radius,
 * plus the gap we want. Hold that and every pin lands on the pass centreline
 * with the road curving around it — cradled in the bend, tangent to the edge,
 * touching nothing. The tarmac passes above one pin and below the next, and
 * neither ever covers the other. It is true for any number of milestones
 * because it never depended on how many there were.
 *
 * WHY LABELS SIT OPPOSITE THE ROAD
 *
 * At a crest the road is above the pin, so the label goes below it; at a trough
 * the reverse. The side is read off the wave rather than chosen, which is what
 * stops a leader line ever crossing the tarmac.
 *
 * WHY IT DOUBLES BACK
 *
 * Eight milestones will not fit across 1120px with readable text. Two passes
 * joined by a hairpin keeps it one unbroken ribbon rather than two stacked
 * roads. The cost is that the lower pass runs right to left, so the story
 * starts on the right — hence the marker there. The alternative, turning on the
 * right instead, reads left-to-right but finishes top-LEFT, which throws away
 * the climb the graphic exists to show.
 */

/**
 * One milestone's text into discrete points.
 *
 * Single source of truth, imported by the list and the road. Three copies of
 * this had drifted apart — the now-deleted spine's copy did not strip a leading
 * bullet character, so a year where the editor typed their own dashes counted
 * as one point in the spine and three in the list.
 */
function splitPoints(text) {
    return String(text || "")
        .split("\n")
        // Tolerate an author who types their own bullet character or dash.
        .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
        .filter(Boolean);
}

/**
 * The plain vertical timeline. Used below lg, and as the road's own fallback
 * when the frame cannot hold the content — same markup either way, so the two
 * can never drift.
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

/* ------------------------------------------------------------- dimensions */

const VW = 1120;

const NAVY = "#002B5C";
const RED = "#CC0033";
const GREY = "#4B5563";
// The section behind this is #F5F7FA. The centre line is painted in the page
// colour rather than white so it reads as gaps worn into the tarmac.
const PAPER = "#F5F7FA";

const PIN_R = 26;
const ROAD_W = 14;
const ROAD_GAP = 4;
/** See the header. This single line is why nothing overlaps. */
const AMP = ROAD_W / 2 + PIN_R + ROAD_GAP;

const LEADER = 16;
const LINE_H = 17;
const POINT_GAP = 7;
const BODY = 12.5;
// Mean glyph width for the body face at BODY px. Only used to decide where to
// wrap, and it errs narrow, so a wrong guess costs a short line rather than an
// overflowing one.
const CHAR_W = 6.3;

const TURN_X = 90; // where the road turns; the hairpin bulges left of it
const RIGHT_LIMIT = 1040; // leaves room for the onward arrow
const MAX_SPACING = 200;
const MIN_SPACING = 115;
const LABEL_MAX_W = 300;
const TOP_PAD = 30;
const BOTTOM_PAD = 34;
const PASS_GAP = 44; // clear air between the two passes' label zones

/** Beyond this the wave is too tight to read, and the list serves better. */
const ROAD_MAX_YEARS = 14;
/** At or under this, one pass holds everything and no hairpin is needed. */
const SINGLE_PASS_MAX = 5;

/* ------------------------------------------------------------------ text */

function wrap(text, maxChars) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (next.length <= maxChars) {
            line = next;
            continue;
        }
        if (line) lines.push(line);
        // A single word longer than the line — a URL, an unbroken title. Hard
        // split it; the alternative is one line running into its neighbour's
        // label, which is the failure this component exists to rule out.
        let rest = w;
        while (rest.length > maxChars) {
            lines.push(`${rest.slice(0, maxChars - 1)}-`);
            rest = rest.slice(maxChars - 1);
        }
        line = rest;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
}

/**
 * A smooth path through every point given, as cubic segments.
 *
 * Used for the turn. Catmull-Rom rather than hand-placed handles because the
 * curve is required to PASS THROUGH its points — the shape is described by
 * where the road goes, not by control points that only influence it, so the
 * bulge and waist stay where they are put when the drop between passes
 * changes with the content.
 */
function catmullRom(pts, tension = 0.5) {
    const f = (v) => v.toFixed(1);
    let d = `M ${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i > 0 ? i - 1 : 0];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1];
        const c1 = [
            p1[0] + ((p2[0] - p0[0]) * tension) / 3,
            p1[1] + ((p2[1] - p0[1]) * tension) / 3,
        ];
        const c2 = [
            p2[0] - ((p3[0] - p1[0]) * tension) / 3,
            p2[1] - ((p3[1] - p1[1]) * tension) / 3,
        ];
        d += ` C ${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
    }
    return d;
}

/* ---------------------------------------------------------------- layout */

/**
 * Every coordinate the road needs, from the item list alone.
 *
 * Exported because it is the whole of the geometry and it is pure — it can be
 * checked for "no pin touches the tarmac" over any item count without a browser.
 * Returns null when the road cannot hold the content; the caller shows the list.
 */
function buildLayout(items) {
    const n = items.length;
    if (!n || n > ROAD_MAX_YEARS) return null;

    // The earlier half rides the lower pass, so the story climbs.
    const split = Math.ceil(n / 2);
    const groups =
        n <= SINGLE_PASS_MAX ? [items] : [items.slice(0, split), items.slice(split)];
    const twoPass = groups.length === 2;

    const widest = Math.max(...groups.map((g) => g.length));
    // (widest + 1) because the road runs half a wavelength past the last pin at
    // each end, which is what puts the hairpin on a horizontal tangent.
    const s = Math.min(MAX_SPACING, (RIGHT_LIMIT - TURN_X) / (widest + 1));
    if (s < MIN_SPACING) return null;

    const XL = TURN_X + s;
    const stopX = (j) => XL + j * s;
    const yAt = (c, x) => c - AMP * Math.cos((Math.PI * (x - XL)) / s);

    // Same-side labels sit two stops apart, so a label may be nearly 2s wide.
    const labelW = Math.min(2 * s - 28, LABEL_MAX_W);
    const chars = Math.max(18, Math.floor(labelW / CHAR_W));

    /*
     * How far a label sits from its pin — measured against the ROAD, not the pin.
     *
     * Clearing the pin is not enough. A label is nearly two stops wide, and the
     * wave keeps descending across that width: by the time you reach the outer
     * corner of a label the tarmac has dropped most of an amplitude, and at
     * five stops per pass it arrived 0.6px inside the text block. Invisible in
     * the sample I looked at, a line of type sitting on the road in the one
     * that mattered.
     *
     * So take the road's height at the label's own edge and clear that. It
     * tightens automatically when the wave is shallow and backs off when the
     * stops crowd together.
     */
    const roadAtLabelEdge =
        -AMP * Math.cos((Math.PI * Math.min(labelW / 2, s)) / s);
    const labelOffset = Math.max(
        PIN_R + LEADER,
        roadAtLabelEdge + ROAD_W / 2 + 8,
    );

    const prepared = items.map((it) => {
        const blocks = splitPoints(it.text).map((p) => wrap(p, chars));
        const h =
            blocks.reduce((acc, b) => acc + b.length * LINE_H, 0) +
            Math.max(0, blocks.length - 1) * POINT_GAP;
        return { item: it, blocks, h };
    });

    // j even -> crest, the road is above the pin, so the label goes below.
    const isAbove = (j) => j % 2 === 1;

    // Which stop lands where, worked out before any vertical position is known,
    // because the zone heights below depend on it.
    const lowerMembers = twoPass
        ? groups[0].map((_, k) => ({ gi: k, j: groups[0].length - 1 - k }))
        : null;
    const upperMembers = twoPass
        ? groups[1].map((_, k) => ({ gi: groups[0].length + k, j: k }))
        : items.map((_, k) => ({ gi: k, j: k }));

    /*
     * Clearance is measured per pass AND per side. Four numbers, not one.
     *
     * It used to be a single number — the tallest label anywhere on the
     * timeline — applied to all four zones. So one six-line year reserved six
     * lines of room above and below both passes, including on the side where
     * the only label reads "Moved into general books under the CURSIVE
     * imprint." The two roads sat 374px apart with a band of nothing between
     * them, and the graphic was 106px taller than it had any reason to be.
     *
     * Each zone now answers for the labels that actually land in it.
     */
    const reach = (members, above) => {
        const hs = members
            .filter((mem) => isAbove(mem.j) === above)
            .map((mem) => prepared[mem.gi].h);
        return labelOffset + (hs.length ? Math.max(...hs) : 0);
    };

    const upperAbove = reach(upperMembers, true);
    const upperBelow = reach(upperMembers, false);
    const centreUpper = TOP_PAD + upperAbove;

    let centreLower = centreUpper;
    let lowerBelow = upperBelow;
    if (twoPass) {
        lowerBelow = reach(lowerMembers, false);
        // The floor matters when both facing zones are short: labels would let
        // the passes come close enough for the two road bands to crowd, and the
        // wave reaches AMP + ROAD_W / 2 beyond each centreline whatever the
        // text says.
        centreLower =
            centreUpper +
            Math.max(
                upperBelow + PASS_GAP + reach(lowerMembers, true),
                2 * (AMP + ROAD_W / 2) + 16,
            );
    }
    const height = centreLower + lowerBelow + BOTTOM_PAD;

    const road = (c, xEnd) => {
        const pts = [];
        for (let x = TURN_X; x < xEnd; x += 4) pts.push(`${x},${yAt(c, x).toFixed(1)}`);
        pts.push(`${xEnd},${yAt(c, xEnd).toFixed(1)}`);
        return `M ${pts.join(" L ")}`;
    };

    const passes = [];
    const push = (centre, members) => {
        const xEnd = stopX(members.length - 1) + s;
        passes.push({
            centre,
            xEnd,
            d: road(centre, xEnd),
            stops: members.map(({ gi, j }) => {
                const x = stopX(j);
                const above = isAbove(j);
                return {
                    gi,
                    x,
                    y: centre,
                    roadY: yAt(centre, x),
                    above,
                    labelX: Math.min(
                        Math.max(x, labelW / 2 + 8),
                        VW - labelW / 2 - 8,
                    ),
                };
            }),
        });
    };

    if (twoPass) {
        // The lower pass is reversed along x: the earliest milestone sits at the
        // right-hand end, where the road begins, and the reader travels leftward
        // into the bend.
        push(centreLower, lowerMembers);
    }
    push(centreUpper, upperMembers);

    const [lowerPass, upperPass] = twoPass ? passes : [null, passes[0]];

    /*
     * The turn, through six points rather than two.
     *
     * A single cubic with both handles pulled straight left gave a U with
     * parallel sides — and the further apart the passes were, the more it read
     * as a bracket than a bend. Tracing it through a waist that tucks back in
     * gives the flowing, slightly wandering line a real switchback has.
     *
     * TURN_X is a wave extreme, so the tangent there is horizontal; the first
     * and last points repeat that direction, which is what lets the turn meet
     * both straights without a kink. The bulge is capped against the frame so
     * the outer edge of a 14px stroke stays on the canvas.
     */
    let hairpin = null;
    if (twoPass) {
        const yL = yAt(centreLower, TURN_X);
        const yU = yAt(centreUpper, TURN_X);
        const drop = yL - yU;
        const bulge = Math.min(0.46 * drop, TURN_X - 20);
        const waist = bulge * 0.8;
        hairpin = catmullRom([
            [TURN_X, yL],
            [TURN_X - bulge * 0.58, yL - drop * 0.05],
            [TURN_X - bulge, yL - drop * 0.28],
            [TURN_X - waist, (yL + yU) / 2],
            [TURN_X - bulge, yU + drop * 0.28],
            [TURN_X - bulge * 0.58, yU + drop * 0.05],
            [TURN_X, yU],
        ]);
    }

    const endY = yAt(upperPass.centre, upperPass.xEnd);
    return {
        width: VW,
        height,
        labelW,
        labelOffset,
        passes,
        hairpin,
        onward: {
            x1: upperPass.xEnd,
            y1: endY,
            x2: upperPass.xEnd + 62,
            y2: Math.max(6, endY - 46),
        },
        start: lowerPass
            ? { x: lowerPass.xEnd, y: yAt(lowerPass.centre, lowerPass.xEnd) }
            : null,
        prepared,
        lastIndex: n - 1,
    };
}

/* ------------------------------------------------------------- component */

export default function TimelineRoad({ items }) {
    const layout = buildLayout(items || []);

    if (!items || !items.length) return null;
    // Too many years, or too little room per year, to read as a road.
    if (!layout) return <MilestoneList items={items} />;

    const {
        width,
        height,
        labelW,
        labelOffset,
        passes,
        hairpin,
        onward,
        start,
        prepared,
        lastIndex,
    } = layout;

    return (
        <div className="relative">
            {/* The road is the only copy of this content on screen at lg+, so the
                full history is repeated here for screen readers rather than
                asking them to operate a map. */}
            <ul className="sr-only">
                {items.map((m, i) => (
                    <li key={`${m.id || m.year || ""}-${i}`}>
                        {m.year}: {splitPoints(m.text).join(" ")}
                    </li>
                ))}
            </ul>

            <svg
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                role="img"
                aria-label="Our history as a single road, one stop per year, climbing from the earliest to the most recent."
                className="block overflow-visible"
            >
                {/* Tarmac, in three passes: a soft halo for depth, the road
                    itself, then the worn centre line. Drawn as one group so the
                    hairpin is visibly the same ribbon as the straights. */}
                <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <g stroke={NAVY} strokeWidth={ROAD_W + 13} opacity="0.06">
                        {passes.map((p, i) => (
                            <path key={`halo-${i}`} d={p.d} />
                        ))}
                        {hairpin && <path d={hairpin} />}
                    </g>
                    <g stroke={NAVY} strokeWidth={ROAD_W}>
                        {passes.map((p, i) => (
                            <path key={`road-${i}`} d={p.d} />
                        ))}
                        {hairpin && <path d={hairpin} />}
                    </g>
                    <g stroke={PAPER} strokeWidth="1.6" strokeDasharray="11 13" opacity="0.85">
                        {passes.map((p, i) => (
                            <path key={`centre-${i}`} d={p.d} />
                        ))}
                        {hairpin && <path d={hairpin} />}
                    </g>
                </g>

                {/* Where the story begins. Without it the eye lands bottom-left
                    and finds the middle of the company's history. */}
                {start && (
                    <text
                        x={start.x + 16}
                        y={start.y + 4}
                        fill={GREY}
                        fontSize="10"
                        letterSpacing="1.6"
                        opacity="0.75"
                    >
                        START
                    </text>
                )}

                {/* It does not end, it carries on. */}
                <g opacity="0.5">
                    <path
                        d={`M ${onward.x1},${onward.y1} L ${onward.x2},${onward.y2}`}
                        fill="none"
                        stroke={RED}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="7 7"
                    />
                    <path
                        d={`M ${onward.x2 - 9},${onward.y2 + 8} L ${onward.x2},${onward.y2} L ${onward.x2 - 2},${onward.y2 + 11}`}
                        fill="none"
                        stroke={RED}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </g>

                {passes.map((pass) =>
                    pass.stops.map((stop) => {
                        const { blocks } = prepared[stop.gi];
                        const { item } = prepared[stop.gi];
                        const isLast = stop.gi === lastIndex;
                        const blockH =
                            blocks.reduce((acc, b) => acc + b.length * LINE_H, 0) +
                            Math.max(0, blocks.length - 1) * POINT_GAP;
                        const top = stop.above
                            ? stop.y - labelOffset - blockH
                            : stop.y + labelOffset;

                        let cursor = top + 12;
                        const lines = [];
                        blocks.forEach((block, bi) => {
                            block.forEach((text, li) => {
                                lines.push({ key: `${bi}-${li}`, text, y: cursor });
                                cursor += LINE_H;
                            });
                            if (bi < blocks.length - 1) cursor += POINT_GAP;
                        });

                        return (
                            <g key={`stop-${stop.gi}`} className="group">
                                <line
                                    x1={stop.x}
                                    x2={stop.x}
                                    y1={stop.above ? stop.y - labelOffset + 4 : stop.y + PIN_R + 4}
                                    y2={stop.above ? stop.y - PIN_R - 4 : stop.y + labelOffset - 4}
                                    stroke={NAVY}
                                    strokeWidth="1"
                                    strokeDasharray="2 4"
                                    className="opacity-25 transition-opacity duration-200 group-hover:opacity-70"
                                />

                                <text textAnchor="middle" fontSize={BODY} fill={GREY}>
                                    {lines.map((l) => (
                                        <tspan key={l.key} x={stop.labelX} y={l.y}>
                                            {l.text}
                                        </tspan>
                                    ))}
                                </text>

                                {/* The pin sits ON the pass centreline. The road
                                    reaches exactly ROAD_GAP away and no closer —
                                    see AMP at the top of this file. */}
                                <circle
                                    cx={stop.x}
                                    cy={stop.y}
                                    r={PIN_R}
                                    fill={isLast ? RED : "#FFFFFF"}
                                    stroke={isLast ? RED : NAVY}
                                    strokeWidth="1.4"
                                    className="transition-all duration-200 group-hover:stroke-2"
                                />
                                <text
                                    x={stop.x}
                                    y={stop.y + 5}
                                    textAnchor="middle"
                                    fontSize="15"
                                    fill={isLast ? "#FFFFFF" : NAVY}
                                    className="font-serif"
                                >
                                    {item.year}
                                </text>
                            </g>
                        );
                    }),
                )}

                {/* Keeps the label width honest if anyone changes the constants:
                    an unused value here would be dropped by the bundler, so it
                    is spent on the title instead. */}
                <title>{`Timeline, ${items.length} milestones, labels ${Math.round(labelW)}px wide`}</title>
            </svg>
        </div>
    );
}
