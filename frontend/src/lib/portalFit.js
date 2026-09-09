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
/*
 * How wide the two format lists may spread beneath the artwork.
 *
 * They are pinned to the outer edges of that grid, so its width IS how far
 * right the eBook column sits. It cannot simply be the page container: the
 * columns have to stay inside the portal's rim, or the dashes cross the
 * headings — and since the artwork width is now an admin setting, the rim moves
 * with it. Measured: at a 560px artwork the circle shrinks to 1079px, and a
 * fixed full-width grid would put the headings 101px outside it.
 *
 * So the grid tracks the circle, clamped at both ends: never wider than the
 * page container, never narrower than two readable columns and the gap between
 * them.
 */
export const LIST_CLEARANCE = 12;
export const LIST_MIN = 720;
export const LIST_MAX = 1280;

/*
 * Two 320px columns with the 384px caption between them. Below this the raised
 * layout cannot exist — there is nowhere for the lists to go that is not on top
 * of the caption, which is exactly the overlap that shipped once. So a small
 * artwork drops the pull-up entirely and the lists sit under it, which is
 * plainer but never broken.
 */
/*
 * FLANKING: the two lists sitting either side of the orbit rather than under it.
 *
 * They must clear the CIRCLE, not merely the rim — a column that starts inside
 * the ring has dashes and glow behind it however faint. So the space each side
 * is (container - circle) / 2, and the column is what is left after a gap of
 * real air.
 *
 * Below FLANK_MIN_COLUMN the sub-lines under each bullet stop fitting on two
 * lines and the column reads as a broken list rather than a narrow one, so the
 * layout stops flanking and stacks instead. That threshold is why this returns
 * `fits` rather than just a width: a small container and a large artwork leave
 * nowhere to put them, and the honest answer is to put them underneath.
 */
export const FLANK_GAP = 40;
export const FLANK_MIN_COLUMN = 200;
export const FLANK_CONTAINER = 1280;

export function flankFit(circle, artWidth, container = FLANK_CONTAINER) {
    const free = (container - circle) / 2;
    const column = Math.floor(free - FLANK_GAP);

    /*
     * THE GAP IS NOT THE AIR.
     *
     * The grid lays the columns out beside the ARTWORK, but the circle is drawn
     * around the artwork and overhangs it — at a 280px artwork the circle is
     * 631px, so it sticks out about 176px on each side. Sizing the columns to
     * clear a circle centred in the container and then spacing them 40px from
     * the artwork put the ring 151px into the Printed book column, measured on
     * the live page at 2400px wide.
     *
     * So the grid gap has to clear the overhang FIRST and leave the air on top
     * of it. The three tracks plus these two gaps then come to exactly the
     * container width, which is the arithmetic saying there is nothing spare.
     */
    const overhang = Math.max(0, (circle - artWidth) / 2);
    return {
        fits: column >= FLANK_MIN_COLUMN,
        column: Math.max(0, column),
        gap: Math.round(overhang + FLANK_GAP),
        air: FLANK_GAP,
        overhang: Math.round(overhang),
    };
}

export const LIST_COLUMN = 320;
export const CAPTION_WIDTH = 384;
export const LIST_RAISED_MIN = LIST_COLUMN * 2 + CAPTION_WIDTH;

/*
 * 280 because that is what the site is set to. It used to be 320, which meant a
 * smaller entry was silently raised and the admin's number did not mean what it
 * said — the worst kind of clamp, because nothing tells you it happened.
 */
export const MIN_WIDTH = 280;
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

    const insetX = Math.max(0, Math.round((side - width) / 2));
    const insetY = Math.max(0, Math.round((side - height) / 2));

    /* The rendered circle, from the layer the portal actually gets: its canvas
       is square and scales with `meet`, so the shorter side of the layer wins. */
    const circle = 2 * RIM_FRACTION * Math.min(width + 2 * insetX, height + 2 * insetY);
    const listWidth = Math.round(
        Math.min(LIST_MAX, Math.max(LIST_MIN, circle - 2 * LIST_CLEARANCE)),
    );

    return {
        width: Math.round(width),
        height: Math.round(height),
        insetX,
        insetY,
        circle: Math.round(circle),
        listWidth,
        raised: listWidth >= LIST_RAISED_MIN,
        flank: flankFit(Math.round(circle), Math.round(width)),
    };
}
