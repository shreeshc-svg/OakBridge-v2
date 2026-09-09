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
 * Decorative only: aria-hidden, pointer-events-none, and low enough in opacity
 * that it can never compete with the tagline sitting on top of it.
 */

const GOLD = "#F59E0B";
const BLUE = "#2F6FB5";
const FACE = "Public Sans, ui-sans-serif, system-ui, sans-serif";

const CX = 300;
const CY = 410;

/* Concentric rims. Dash lengths differ per ring so the travelling light never
   lines up into a single moving spoke. */
const RINGS = [
    { i: 0, rx: 250, ry: 340, dash: "3 13", colour: GOLD, opacity: 0.34, duration: 9, reverse: false },
    { i: 1, rx: 272, ry: 370, dash: "2 17", colour: GOLD, opacity: 0.24, duration: 14, reverse: true },
    { i: 2, rx: 291, ry: 396, dash: "4 21", colour: BLUE, opacity: 0.28, duration: 19, reverse: false },
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
        radius: outer ? 262 + ((i * 13) % 26) : 196 + ((i * 17) % 30),
        size: isPixel ? 6 + (i % 3) : 13 + ((i * 5) % 7),
        /* Spread around the ring by index, nudged so the two rings do not line
           up into spokes. */
        start: Math.round((i * 360) / 12 + (outer ? 0 : 17)),
        duration: outer ? 68 + (i % 4) * 6 : 48 + (i % 3) * 5,
        reverse: !outer,
        opacity: outer ? 0.3 : 0.38,
    };
});

export default function OrbitField({ className = "" }) {
    return (
        <svg
            viewBox="0 0 600 820"
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
                    <stop offset="91%" stopColor={GOLD} stopOpacity="0.13" />
                    <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
                </radialGradient>
                <radialGradient id="fg-portal-cool">
                    <stop offset="0%" stopColor={BLUE} stopOpacity="0" />
                    <stop offset="82%" stopColor={BLUE} stopOpacity="0" />
                    <stop offset="94%" stopColor={BLUE} stopOpacity="0.12" />
                    <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
                </radialGradient>
            </defs>

            {/* The rim glow, on the same heartbeat as the halos inside the
                artwork, so the column pulses to one clock. */}
            <ellipse cx={CX} cy={CY} rx="285" ry="388" fill="url(#fg-portal-warm)" className="fg-halo" />
            <ellipse
                cx={CX}
                cy={CY}
                rx="298"
                ry="405"
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
                    strokeWidth="1.5"
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
