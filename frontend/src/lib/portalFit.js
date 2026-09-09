/**
 * How big the eBooks artwork is, and how far the portal has to sit outside it.
 *
 * WHY THIS IS ARITHMETIC AND NOT TWO TAILWIND CLASSES
 *
 * The portal is an absolutely positioned layer held OUTSIDE the artwork by
 * negative insets. Those used to be fixed — `-inset-x-72 -inset-y-36`, chosen
 * for one artwork width. The moment the width becomes an admin setting those
 * numbers are wrong in both directions: shrink the artwork and a fixed 288px
 * inset leaves an enormous ring around a small drawing; grow it and the ring
 * cuts through the corners, which is the defect this whole area already shipped
 * with twice.
 *
 * So the insets are derived from the width instead. Everything the page lays
 * out below the artwork — the gap, the cloud, its caption — is a known ratio or
 * a known constant, so the stack's height follows from its width, and the
 * enclosing circle follows from the stack's diagonal.
 *
 * WHY THE HEIGHT IS NOT PROPORTIONAL TO THE WIDTH
 *
 * The caption under the cloud is a fixed number of lines. It does not shrink
 * with the drawings, so the stack gets RELATIVELY taller as it narrows — which
 * is why insets scaled as a flat percentage of the width fail at small sizes.
 * At 400px wide, proportional insets leave the corners 6% outside the rim.
 */

/** The two drawings' own aspect ratios — height per unit width. */
export const ART_RATIO = 420 / 660;
export const CLOUD_RATIO = 262 / 560;

/** Layout constants from Ebooks.jsx: the gap above the cloud, and its caption. */
export const GAP = 48;
export const CAPTION = 150;

/** OrbitField's outer rim, as a fraction of its square canvas. */
export const RIM_FRACTION = 525 / 1100;

/**
 * Headroom over the bare minimum. At 1.0 the rim would pass exactly through the
 * artwork's corners, which reads as touching rather than enclosing.
 */
export const MARGIN = 1.09;

/* An artwork narrower than this is smaller than the caption beneath it; wider
   than this overflows the page's own container at common desktop widths. */
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 1000;
export const DEFAULT_WIDTH = 672;

/**
 * Given an admin-chosen artwork width in px, return the width to apply and the
 * insets the portal needs to clear it.
 *
 * Anything unparseable falls back to the design width rather than to zero — a
 * zero here would collapse the artwork, not merely mis-size the ring.
 */
export function portalFit(rawWidth) {
    const asked = Number(String(rawWidth ?? "").trim());
    const width = Number.isFinite(asked) && asked > 0
        ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, asked))
        : DEFAULT_WIDTH;

    const height = width * ART_RATIO + GAP + width * CLOUD_RATIO + CAPTION;
    const halfDiagonal = Math.hypot(width, height) / 2;
    /* The portal's canvas is square and scales with `meet`, so the circle it can
       draw is bounded by the SHORTER side of the layer. Solve for a layer big
       enough that the rim clears the stack's half-diagonal. */
    const side = (halfDiagonal / RIM_FRACTION) * MARGIN;

    return {
        width: Math.round(width),
        height: Math.round(height),
        insetX: Math.max(0, Math.round((side - width) / 2)),
        insetY: Math.max(0, Math.round((side - height) / 2)),
    };
}
