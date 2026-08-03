import React from "react";

/**
 * The About timeline as a road climbing a mountain.
 *
 * WHY THIS SHAPE
 *
 * The vertical list tells the history accurately but you cannot see it: nine
 * years of milestones run past the fold, so "how far has this company come"
 * costs a scroll and a memory. A climb answers that in one look — the founding
 * is at the bottom of the frame, today is at the summit, and the distance
 * between them is the point of the graphic.
 *
 * THE COMPROMISE, STATED PLAINLY
 *
 * Twenty-two milestones cannot all be legible at once beside a mountain. So
 * every YEAR is always visible as a marker on the road — the whole climb reads
 * at a glance — and the detail for one year appears in the panel. Choosing the
 * opposite (all text permanently on screen) is a scrolling layout, which is
 * the thing this replaces.
 *
 * WHY POSITIONS ARE MEASURED, NOT CALCULATED
 *
 * Markers are placed with getPointAtLength on the real path, not by hand. Hand
 * placement would be correct for exactly one milestone count, and the count is
 * not fixed: page_about_milestones is admin-editable and the database currently
 * holds five entries while the code defaults hold ten. An editor adding a year
 * must get a marker on the road, not a marker beside it.
 *
 * Labels are pushed along the curve's OUTWARD normal — away from the centre of
 * curvature — so a label never lands on the road no matter which way that
 * switchback bends. Same reason the spine measures its rows instead of spacing
 * them evenly: the geometry is the only reliable source of the geometry.
 *
 * ACCESSIBILITY
 *
 * At this breakpoint the road replaces the list, so unlike TimelineSpine it is
 * NOT aria-hidden — it is the only copy of the content on screen. A visually
 * hidden list carries every year and every point in full, so a screen reader
 * gets the history as prose rather than being asked to operate a mountain.
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

// Fixed drawing space; the SVG scales to its container.
const VW = 1120;
const VH = 600;

// The climb. Seven switchbacks from the foot (78,578) to the summit (858,128).
const ROAD =
    "M 78 578 C 240 574 332 546 374 502 C 416 458 374 420 288 404 " +
    "C 202 388 198 346 290 326 C 382 306 520 308 586 288 " +
    "C 652 268 626 232 546 218 C 466 204 476 172 566 160 " +
    "C 656 148 790 160 858 128";

const NAVY = "#002B5C";
const RED = "#CC0033";
const AMBER = "#F59E0B";
const GREY = "#4B5563";

/**
 * A year needs at least this many milestones to earn a permanently open
 * flyout. Three is deliberately strict: on the current history it selects 2019
 * and 2026 and leaves the other eight years as markers. Lowering it to two
 * would open six flyouts and turn the mountain back into a list.
 *
 * The point of the always-open cards is that the graphic says something before
 * anyone touches it — a visitor who never hovers still learns that 2019 and
 * 2026 were the heavy years, and what happened in them.
 */
const FLYOUT_MIN_POINTS = 3;

/**
 * Flyouts are kept clear of the detail panel in the top-left.
 *
 * The panel is a fixed 300px box while the SVG scales with its container, so
 * the two live in different coordinate systems and the overlap has to be
 * bounded rather than computed. Worst case is the NARROWEST lg width: a 1024px
 * viewport with lg:px-16 leaves a 896px frame, 480px tall, where the panel
 * reaches x=324px and y=228px — 405 and 285 in viewBox units. Every wider
 * container makes the panel a smaller fraction, so these bounds only loosen.
 *
 * The first version guarded on the left HALF (x < 504) and pushed to y >= 250,
 * which was inside the panel's own 285 reach — it moved cards into the thing it
 * was avoiding. The guard is now two-dimensional: only cards actually within
 * the panel's horizontal span move, and they clear its full depth.
 */
const PANEL_SAFE_X = 420;
const PANEL_SAFE_Y = 300;

export default function TimelineRoad({ items }) {
    const roadRef = React.useRef(null);
    const [marks, setMarks] = React.useState([]);
    const [active, setActive] = React.useState(0);

    const count = items.length;

    // Measure after layout: getPointAtLength needs the path in the document.
    React.useLayoutEffect(() => {
        const path = roadRef.current;
        if (!path || !count) {
            setMarks([]);
            return;
        }
        const L = path.getTotalLength();
        const at = (t) => path.getPointAtLength(Math.max(0, Math.min(1, t)) * L);

        // Direction to push a label so it leaves the road.
        //
        // ALWAYS perpendicular to the tangent; curvature only picks the side.
        //
        // The first version returned the curvature vector itself, which is only
        // perpendicular in the middle of a bend. At the two endpoints the
        // curvature runs nearly PARALLEL to the road, so the label was pushed
        // along the tarmac rather than off it — 3.3px from the centre line at
        // the trailhead and 8.4px at the summit, i.e. sitting on the road. A
        // perpendicular can never do that, whatever the path does at its ends.
        const outward = (t) => {
            const d = 0.028;
            const a = at(t - d);
            const b = at(t);
            const c = at(t + d);

            const tn = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            let nx = -(c.y - a.y) / tn;
            let ny = (c.x - a.x) / tn;

            // Second difference points toward the centre of curvature; flip the
            // normal so the label ends up on the open side of the bend. When the
            // stretch is straight this dot is ~0 and either side is equally good.
            if ((a.x + c.x - 2 * b.x) * nx + (a.y + c.y - 2 * b.y) * ny > 0) {
                nx = -nx;
                ny = -ny;
            }
            return { x: nx, y: ny };
        };

        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        /**
         * Offset a point off the road by `dist`, on whichever side fits.
         *
         * Picking the geometrically correct side and THEN clamping to the frame
         * was the second bug: at the trailhead the open side of the bend is
         * below the road, 603 in a 600-tall box, so the clamp hauled the label
         * back to within 7px of the tarmac. Trying the other side first, and
         * only clamping when neither fits, keeps the full offset intact.
         */
        const place = (p, o, dist, mx, my) => {
            const fits = (c) => c.x >= mx && c.x <= VW - mx && c.y >= my && c.y <= VH - my;
            const front = { x: p.x + o.x * dist, y: p.y + o.y * dist };
            if (fits(front)) return front;
            const back = { x: p.x - o.x * dist, y: p.y - o.y * dist };
            if (fits(back)) return back;
            return { x: clamp(front.x, mx, VW - mx), y: clamp(front.y, my, VH - my) };
        };

        setMarks(
            items.map((m, i) => {
                // A lone milestone sits mid-climb rather than at the trailhead.
                const t = count === 1 ? 0.5 : 0.015 + (i / (count - 1)) * 0.97;
                const p = at(t);
                const o = outward(t);
                const n = splitPoints(m.text).length;

                const lbl = place(p, o, 26, 34, 24);

                // Flyout rides the same normal, just further out, so the card
                // sits on the open side of the bend rather than across the road
                // it belongs to. Wider margins because it is a 210px card, not
                // a four-character year.
                const flyout = n >= FLYOUT_MIN_POINTS;
                const f = place(p, o, 78, 118, 74);
                if (f.x < PANEL_SAFE_X) f.y = Math.max(f.y, PANEL_SAFE_Y);

                return {
                    x: p.x,
                    y: p.y,
                    lx: lbl.x,
                    ly: lbl.y,
                    r: 5 + Math.min(Math.max(n, 1), 4) * 1.6,
                    n,
                    flyout,
                    fx: f.x,
                    fy: f.y,
                };
            }),
        );
    }, [items, count]);

    // Reset when the admin changes the list out from under us.
    React.useEffect(() => {
        setActive(count ? count - 1 : 0);
    }, [count]);

    if (!count) return null;

    /**
     * Geometry is a frame behind the data, and drawing it anyway crashed the site.
     *
     * `marks` is state written from a layout effect; `items` is a prop. When the
     * list shrinks, React renders with the NEW shorter items and the OLD longer
     * marks — the effect that resizes marks cannot run until that render commits.
     * `items[i]` was then undefined and `m.year` threw during render.
     *
     * That is the ordinary load sequence here, not an edge case: the first paint
     * uses DEFAULT_MILESTONES (ten), then page_about_milestones resolves with the
     * five rows the database actually holds, and index five throws. There is no
     * ErrorBoundary in this app, so React unmounts the root and the WHOLE SITE
     * goes blank — and because prerendering drives a real browser, /about would
     * have shipped an empty shell to crawlers while the build stayed green.
     *
     * Drawing nothing for one frame is invisible; the effect repaints immediately.
     */
    const view = marks.length === count ? marks : [];

    const current = items[active] || items[0];
    const currentPoints = splitPoints(current.text);

    // Move focus, don't just move the highlight: onFocus is what sets `active`,
    // so without this the arrow keys and aria-pressed disagree about where the
    // user is, and the next Tab silently reverts the selection.
    const step = (e, delta) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(count - 1, active + delta));
        const groups = e.currentTarget.querySelectorAll('[data-mk="1"]');
        if (groups[next]) groups[next].focus();
        setActive(next);
    };

    const onKey = (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") step(e, 1);
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") step(e, -1);
    };

    return (
        <div className="relative border border-[#E5E7EB] bg-[#F5F7FA]">
            {/* The road is the only copy of this content on screen at lg+, so
                the full history is repeated here for screen readers rather than
                requiring them to drive an SVG. */}
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
                role="group"
                aria-label="Our history as a road climbing a mountain. Use arrow keys to move between years."
                onKeyDown={onKey}
            >
                {/* Distant ranges, then the massif the road actually climbs. */}
                <path d="M0 470 L150 330 L245 400 L370 262 L470 360 L560 300 L640 400 L720 470 Z" fill="#DCE3ED" />
                <path d="M600 470 L710 344 L790 400 L900 250 L1010 366 L1090 300 L1120 340 L1120 470 Z" fill="#DCE3ED" />
                <path
                    d="M-20 600 L210 402 L330 470 L560 250 L700 340 L880 96 L1010 250 L1120 178 L1120 600 Z"
                    fill="#C7D2E0"
                />
                <path d="M880 96 L936 158 L906 150 L880 168 L854 146 L826 158 Z" fill="#EEF2F7" />
                <path d="M-20 600 L180 470 L420 560 L640 470 L860 540 L1120 452 L1120 600 Z" fill="#B4C2D4" />

                <path ref={roadRef} d={ROAD} fill="none" stroke={NAVY} strokeWidth="11" strokeLinecap="round" />
                <path
                    d={ROAD}
                    fill="none"
                    stroke="#F5F7FA"
                    strokeWidth="2"
                    strokeDasharray="9 11"
                    strokeLinecap="round"
                />

                {/* Leader lines first, so they pass under the markers. */}
                {view.map((mk, i) =>
                    mk.flyout ? (
                        <line
                            key={`lead-${items[i].id || items[i].year || ""}-${i}`}
                            x1={mk.x}
                            y1={mk.y}
                            x2={mk.fx}
                            y2={mk.fy}
                            stroke={NAVY}
                            strokeWidth="1"
                            opacity="0.3"
                        />
                    ) : null,
                )}

                {view.map((mk, i) => {
                    const on = i === active;
                    const m = items[i];
                    return (
                        <g
                            key={`${m.id || m.year || ""}-${i}`}
                            data-mk="1"
                            tabIndex={i === active ? 0 : -1}
                            role="button"
                            aria-pressed={on}
                            aria-label={`${m.year}, ${mk.n} ${mk.n === 1 ? "milestone" : "milestones"}`}
                            className="cursor-pointer focus:outline-none"
                            onMouseEnter={() => setActive(i)}
                            onFocus={() => setActive(i)}
                            onClick={() => setActive(i)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setActive(i);
                                }
                            }}
                        >
                            {on && (
                                <circle cx={mk.x} cy={mk.y} r={mk.r + 7} fill="none" stroke={AMBER} strokeWidth="2" />
                            )}
                            <circle
                                cx={mk.x}
                                cy={mk.y}
                                r={on ? mk.r + 2.5 : mk.r}
                                fill={on ? RED : "#FFFFFF"}
                                stroke={NAVY}
                                strokeWidth="2.5"
                                className="transition-all duration-150 motion-reduce:transition-none"
                            />
                            <text
                                x={mk.lx}
                                y={mk.ly + 4}
                                textAnchor="middle"
                                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                                fontSize="11"
                                letterSpacing="1"
                                fontWeight={on ? 700 : 400}
                                fill={on ? NAVY : GREY}
                            >
                                {m.year}
                            </text>
                            {/* Generous invisible target: the dots are small by design. */}
                            <circle cx={mk.x} cy={mk.y} r="20" fill="transparent" />
                        </g>
                    );
                })}
            </svg>

            {/* Always-open cards for the heavy years. Positioned as a percentage
                of the frame so they track the markers as the SVG scales, which
                absolute pixels would not do. aria-hidden because the sr-only
                list above already carries every word. */}
            {view.map((mk, i) =>
                mk.flyout ? (
                    <div
                        key={`fly-${items[i].id || items[i].year || ""}-${i}`}
                        aria-hidden="true"
                        onMouseEnter={() => setActive(i)}
                        style={{
                            left: `${(mk.fx / VW) * 100}%`,
                            top: `${(mk.fy / VH) * 100}%`,
                            transform: "translate(-50%, -50%)",
                        }}
                        className={`absolute w-[210px] bg-white/95 border px-3.5 py-2.5 ${
                            i === active ? "border-[#CC0033]" : "border-[#E5E7EB]"
                        }`}
                    >
                        <div className="font-serif text-xl leading-none text-[#002B5C]">
                            {items[i].year}
                        </div>
                        <ul className="mt-2 space-y-1.5">
                            {splitPoints(items[i].text).map((p, j) => (
                                <li
                                    key={j}
                                    className="relative pl-3 text-[11px] leading-snug text-[#4B5563]"
                                >
                                    <span className="absolute left-0 top-[6px] w-[4px] h-[4px] bg-[#F59E0B]" />
                                    {p}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null,
            )}

            {/* Sits in the empty sky, top-left. min-height stops the panel from
                resizing as you move between a one-point year and a four-point
                one, which would make the whole graphic twitch. */}
            <div
                aria-live="polite"
                className="absolute left-6 top-5 w-[300px] min-h-[208px] bg-white border border-[#E5E7EB] px-5 py-4"
            >
                <div className="font-serif text-4xl leading-none text-[#002B5C]">{current.year}</div>
                <div className="overline !text-[9px] mt-2">
                    {currentPoints.length} {currentPoints.length === 1 ? "milestone" : "milestones"}
                </div>
                <ul className="mt-3 space-y-2">
                    {currentPoints.map((p, j) => (
                        <li key={j} className="relative pl-3.5 text-[12.5px] leading-snug text-[#002B5C]">
                            <span className="absolute left-0 top-[7px] w-[5px] h-[5px] bg-[#F59E0B]" />
                            {p}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="absolute right-5 bottom-4 overline !text-[9px] text-right leading-relaxed">
                Larger marker = more
                <br />
                happened that year
            </div>
        </div>
    );
}
