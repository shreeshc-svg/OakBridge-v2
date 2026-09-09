import React from "react";

/**
 * A portal around the eBooks column: rings of travelling light, with letters
 * and pixels orbiting inside them.
 *
 * WHY A SEPARATE LAYER
 *
 * The two drawings on that column — the book becoming an e-reader, and the
 * cloud reaching three devices — are separate SVGs with their own coordinate
 * systems, with a block of text between them. Anything meant to surround BOTH
 * has to live outside both, so this is an absolutely positioned layer spanning
 * the column, painted before its siblings and therefore behind them.
 *
 * WHAT MAKES IT READ AS A PORTAL RATHER THAN AS FLOATING DEBRIS
 *
 * Three things, and it needs all three. A rim: concentric dashed ellipses with
 * light running round them in opposite directions, which is what says
 * "aperture" rather than "circle". A glow ON that rim, not in the middle — a
 * donut gradient, transparent until 80% of the radius, so the centre stays
 * clear for the artwork. And orbiting bodies at several radii, turning both
 * ways, so it has depth instead of looking like one spinning wheel.
 *
 * The rim glow reuses the same heartbeat as the halos inside the drawing, so
 * the whole column pulses together rather than to two different clocks.
 *
 * WHY IT IS DESKTOP ONLY
 *
 * On a phone the column is the full width of the screen and the copy runs
 * through the middle of it; particles behind live text are noise at best and a
 * legibility problem at worst. It is also two dozen more animated nodes on the
 * device least able to afford them. Hidden below lg, where the layout stacks
 * and there is no room for a portal anyway.
 *
 * HOW BIG, AND HOW LOUD
 *
 * The rims sit near the edge of the layer on purpose: at the original radii
 * they cut straight through the book and the e-reader, which reads as a stray
 * arc rather than as something enclosing them. They now clear both drawings and
 * the tagline, and stop just inside the canvas — an ellipse that runs past the
 * viewBox is sliced flat, which is the same defect the washes inside the
 * artwork already had once.
 *
 * Opacity was raised to make it read at all. The reason that is safe is the
 * donut: the glow lives on the rim and the centre is genuinely empty, so the
 * copy sitting over the middle has nothing behind it. Turning up the CENTRE
 * would not be safe, which is why there is nothing there to turn up.
 *
 * Decorative only: aria-hidden and pointer-events-none.
 */

const GOLD = "#F59E0B";
const BLUE = "#2F6FB5";
const FACE = "Public Sans, ui-sans-serif, system-ui, sans-serif";

const CX = 350;
const CY = 495;

/* Concentric rims. Dash lengths differ per ring so the travelling light never
   lines up into a single moving spoke. */
const RINGS = [
    { i: 0, rx: 300, ry: 420, dash: "3 13", colour: GOLD, opacity: 0.55, duration: 9, reverse: false },
    { i: 1, rx: 325, ry: 455, dash: "2 17", colour: GOLD, opacity: 0.42, duration: 14, reverse: true },
    { i: 2, rx: 345, ry: 482, dash: "4 21", colour: BLUE, opacity: 0.48, duration: 19, reverse: false },
];

/* Two rings of bodies turning opposite ways. One ring reads as a carousel; two
   reads as something in orbit. */
const PARTICLES = ["§", "a", "¶", "e", "t", "§", "i", "m", "▪", "▪", "▪", "▪"].map((ch, i) => {
    const outer = i % 2 === 0;
    const isPixel = ch === "▪";
    return {
        i,
        ch,
        isPixel,
        radius: outer ? 300 + ((i * 13) % 26) : 232 + ((i * 17) % 30),
        size: isPixel ? 7 + (i % 3) : 15 + ((i * 5) % 8),
        /* Spread around the ring by index, nudged so the two rings do not line
           up into spokes. */
        start: Math.round((i * 360) / 12 + (outer ? 0 : 17)),
        duration: outer ? 68 + (i % 4) * 6 : 48 + (i % 3) * 5,
        reverse: !outer,
        opacity: outer ? 0.46 : 0.52,
    };
});

export default function OrbitField({ className = "" }) {
    return (
        <svg
            viewBox="0 0 700 990"
            aria-hidden="true"
            focusable="false"
            className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                {/* Transparent until 80% of the radius: the light belongs on the
                    rim, and a glow in the middle would sit under the artwork and
                    grey it. */}
                <radialGradient id="fg-portal-warm">
                    <stop offset="0%" stopColor={GOLD} stopOpacity="0" />
                    <stop offset="78%" stopColor={GOLD} stopOpacity="0" />
                    <stop offset="91%" stopColor={GOLD} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
                </radialGradient>
                <radialGradient id="fg-portal-cool">
                    <stop offset="0%" stopColor={BLUE} stopOpacity="0" />
                    <stop offset="82%" stopColor={BLUE} stopOpacity="0" />
                    <stop offset="94%" stopColor={BLUE} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
                </radialGradient>
            </defs>

            {/* The rim glow, on the same heartbeat as the halos inside the
                artwork, so the column pulses to one clock. */}
            <ellipse cx={CX} cy={CY} rx="338" ry="472" fill="url(#fg-portal-warm)" className="fg-halo" />
            <ellipse
                cx={CX}
                cy={CY}
                rx="348"
                ry="486"
                fill="url(#fg-portal-cool)"
                className="fg-halo"
                style={{ animationDelay: "0.85s" }}
            />

            {/* The aperture: light running round each rim. */}
            {RINGS.map((r) => (
                <ellipse
                    key={`ring-${r.i}`}
                    cx={CX}
                    cy={CY}
                    rx={r.rx}
                    ry={r.ry}
                    fill="none"
                    stroke={r.colour}
                    strokeWidth="2"
                    strokeDasharray={r.dash}
                    strokeLinecap="round"
                    opacity={r.opacity}
                    className="fg-rim"
                    style={{
                        animationDuration: `${r.duration}s`,
                        animationDirection: r.reverse ? "reverse" : "normal",
                    }}
                />
            ))}

            {/* Bodies in orbit. */}
            {PARTICLES.map((p) => (
                <g
                    key={`orb-${p.i}`}
                    className="fg-orbit"
                    style={{
                        transformOrigin: `${CX}px ${CY}px`,
                        animationDuration: `${p.duration}s`,
                        animationDirection: p.reverse ? "reverse" : "normal",
                        /* Negative, so the ring is already distributed on the
                           first frame instead of every body starting at three
                           o'clock together. */
                        animationDelay: `${-((p.start / 360) * p.duration).toFixed(1)}s`,
                    }}
                >
                    {p.isPixel ? (
                        <rect
                            x={CX + p.radius}
                            y={CY - p.size / 2}
                            width={p.size}
                            height={p.size}
                            fill={BLUE}
                            opacity={p.opacity}
                        />
                    ) : (
                        <text
                            x={CX + p.radius}
                            y={CY}
                            fontFamily={FACE}
                            fontSize={p.size}
                            fontWeight="700"
                            fill={GOLD}
                            opacity={p.opacity}
                            textAnchor="middle"
                        >
                            {p.ch}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    );
}
