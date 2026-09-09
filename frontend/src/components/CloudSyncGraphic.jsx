import React from "react";

/**
 * The library in the cloud, reaching three devices.
 *
 * WHY THIS SITS UNDER THE FORMAT SPLIT
 *
 * The comparison graphic answers "what is an eBook". It left a tall gap below
 * it on desktop, because two long bullet columns are taller than one wide
 * drawing. This fills that gap with the part of the argument the columns only
 * assert in words — "your notes stay with the book, on every device" and "the
 * whole shelf, carried". A picture of one cloud feeding a phone, a tablet and a
 * laptop is that sentence.
 *
 * Same rules as FormatSplitGraphic and TimelineRoad: flat brand fills, no
 * gradients, no shadows, geometry from arithmetic, a fixed viewBox so the
 * browser knows the aspect ratio before anything loads. Amber is used only for
 * the things that move — what is stored, and the links carrying it down.
 */

const INK = "#002B5C";
const GOLD = "#F59E0B";
const PAPER_MUTED = "#F5F7FA";

// Where each device sits. `cx` is also where its connector lands, so the two
// can never drift apart.
const DEVICES = [
    { key: "phone", cx: 172, top: 168 },
    { key: "tablet", cx: 282, top: 160 },
    { key: "laptop", cx: 393, top: 166 },
];

export default function CloudSyncGraphic({ className = "", animate = true }) {
    /* Classes are added rather than the keyframes being switched off, so that
       with animation disabled the markup carries no animated class at all —
       nothing to compute, and nothing for a future stylesheet to reanimate by
       accident. */
    const cls = (name) => (animate ? name : undefined);
    return (
        <svg
            viewBox="0 0 560 262"
            className={`w-full h-auto ${className}`}
            role="img"
            aria-label="An Oakbridge library held in the cloud, syncing down to a phone, a tablet and a laptop"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* The links first, so the cloud and the devices paint over their
                ends and no dash pokes out from under an edge. */}
            {/* Light travelling down each link, one device after another, so it
                reads as delivery rather than as three things blinking. */}
            <g stroke={GOLD} strokeWidth="2" fill="none" strokeDasharray="4 5" strokeLinecap="round">
                {[
                    "M248 108 C 220 138, 200 144, 172 168",
                    "M282 112 L 282 160",
                    "M318 108 C 346 138, 366 144, 393 166",
                ].map((d, i) => (
                    <path
                        key={`link-${i}`}
                        d={d}
                        className={cls("fg-flow")}
                        style={animate ? { animationDelay: `${(i * 0.22).toFixed(2)}s` } : undefined}
                    />
                ))}
            </g>
            {DEVICES.map((d, i) => (
                <circle
                    key={`node-${d.key}`}
                    cx={d.cx}
                    cy={d.top}
                    r="3.5"
                    fill={GOLD}
                    className={cls("fg-ping")}
                    /* Fires as the light down its own link arrives. */
                    style={animate ? { animationDelay: `${(i * 0.22 + 0.5).toFixed(2)}s` } : undefined}
                />
            ))}

            {/* ---------------- the cloud ---------------- */}
            {/* Four overlapping shapes in one flat fill. A single path would be
                fewer nodes but impossible to nudge later without redrawing it. */}
            {/* Cloud AND its contents in one floating group. With the bars
                outside it they stayed put while the cloud drifted off them. */}
            <g className={cls("fg-cloud")}>
                <g fill={INK}>
                    <circle cx="232" cy="76" r="30" />
                    <circle cx="282" cy="58" r="42" />
                    <circle cx="332" cy="76" r="32" />
                    <rect x="202" y="76" width="162" height="34" rx="17" />
                </g>

            {/* What is being held up there: lines of a book. The top one is
                amber because it is the only thing in the drawing a reader has
                actually made — a highlight, carried up. */}
                <rect x="258" y="48" width="48" height="5" rx="2.5" fill={GOLD} />
                <rect x="258" y="60" width="38" height="5" rx="2.5" fill="#FFFFFF" opacity="0.55" />
                <rect x="258" y="72" width="44" height="5" rx="2.5" fill="#FFFFFF" opacity="0.35" />
            </g>

            {/* ---------------- the devices ---------------- */}

            {/* Phone */}
            <rect x="150" y="170" width="44" height="76" rx="5" fill="#FFFFFF" stroke={INK} strokeWidth="2" />
            <rect x="157" y="178" width="30" height="58" fill={PAPER_MUTED} />

            {/* Tablet */}
            <rect x="248" y="162" width="68" height="90" rx="6" fill="#FFFFFF" stroke={INK} strokeWidth="2" />
            <rect x="256" y="171" width="52" height="70" fill={PAPER_MUTED} />

            {/* Laptop — lid, then the base it stands on. */}
            <rect x="346" y="168" width="94" height="62" rx="4" fill="#FFFFFF" stroke={INK} strokeWidth="2" />
            <rect x="353" y="175" width="80" height="48" fill={PAPER_MUTED} />
            <rect x="336" y="232" width="114" height="7" rx="3.5" fill={INK} />

            {/* A line of text on each screen, so they read as reading devices
                rather than as three empty rectangles. Widths scale with the
                screen so none of them looks cramped. */}
            <g fill={INK} opacity="0.45">
                <rect x="162" y="186" width="20" height="3" rx="1.5" />
                <rect x="162" y="194" width="14" height="3" rx="1.5" />
                <rect x="262" y="180" width="40" height="3" rx="1.5" />
                <rect x="262" y="188" width="31" height="3" rx="1.5" />
                <rect x="360" y="184" width="66" height="3" rx="1.5" />
                <rect x="360" y="192" width="52" height="3" rx="1.5" />
            </g>
        </svg>
    );
}
