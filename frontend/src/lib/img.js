/**
 * Ask for an image the size of the screen that is going to show it.
 *
 * The heroes are requested at 1600–2000px wide and displayed on 390px phones,
 * which is the largest single download on a first visit and lands squarely on
 * the LCP. There is no image service in front of our own uploads, so this can
 * only help where the source URL already takes a width — in practice the
 * Unsplash defaults, which is what an unconfigured install ships with and what
 * several pages still hardcode.
 *
 * Deliberately narrow: it rewrites a `w=` parameter on a known host and does
 * nothing at all otherwise. A helper that guessed at arbitrary URLs would
 * produce 404s in a srcset, and a broken srcset entry is worse than none —
 * the browser picks it, fails, and shows nothing.
 */

const RESIZABLE_HOSTS = ["images.unsplash.com"];

// Roughly: phone, phone at 2x / small tablet, tablet, laptop, desktop.
const WIDTHS = [480, 800, 1200, 1600, 2000];

const canResize = (url) => {
    if (typeof url !== "string" || !url.includes("w=")) return false;
    return RESIZABLE_HOSTS.some((h) => url.includes(h));
};

/**
 * Props to spread onto an <img>.
 *
 * @param url      the image source
 * @param sizes    a CSS `sizes` value describing the box it fills
 * @param priority true for the one image above the fold that decides LCP
 */
export const responsiveImage = (url, sizes = "100vw", priority = false) => {
    const loading = priority
        ? { loading: "eager", fetchpriority: "high" }
        : { loading: "lazy", decoding: "async" };

    if (!canResize(url)) return { src: url, ...loading };

    // Never offer a width above what was originally asked for: upscaling costs
    // bytes to deliver a blurrier picture.
    const asked = Number((url.match(/[?&]w=(\d+)/) || [])[1]) || WIDTHS[WIDTHS.length - 1];
    const widths = WIDTHS.filter((w) => w <= asked);
    if (widths.length < 2) return { src: url, ...loading };

    /*
     * Small candidates are also served at lower quality.
     *
     * These are decorative photographs sitting under a navy gradient that runs
     * from 95% to 35% opacity — detail in them is not what anyone is looking
     * at, and JPEG quality is the cheapest axis there is: q=85 to q=60 is
     * roughly half the bytes for a difference nobody can see through a
     * gradient. Applied only to the phone-sized candidates, so the desktop
     * image is exactly what it was.
     */
    const at = (w) => {
        const sized = url.replace(/([?&]w=)\d+/, `$1${w}`);
        return w <= 800 ? sized.replace(/([?&]q=)\d+/, "$160") : sized;
    };
    return {
        src: url,
        srcSet: widths.map((w) => `${at(w)} ${w}w`).join(", "),
        sizes,
        ...loading,
    };
};
