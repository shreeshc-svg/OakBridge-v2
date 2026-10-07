import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { mediaUrl } from "../lib/api";
import SmartLink from "./SmartLink";
import { isPrerender } from "../lib/runtime";

/**
 * Full-screen homepage hero: the company's latest highlights, posted in
 * Admin → Pages → Homepage → Hero banners (collection `home_hero_slides`).
 * Styles live in index.css under `.hx-` (keyframes and media queries that
 * Tailwind classes cannot express cleanly).
 *
 * TWO KINDS OF SLIDE
 *
 *   Live text  (slide has a `title`): the uploaded image is only the
 *              background; headline, subtitle, chips and buttons are real
 *              text. That is what lets one slide fill a 390×844 phone and a
 *              3840×2160 monitor without cutting anything: the photo crops
 *              around its focal point, the text re-flows.
 *   Artwork    (no `title` — every banner uploaded before this existed): a
 *              finished design with the words baked in. It is shown WHOLE
 *              over a blurred copy of itself, never cropped, so the old
 *              banners keep working until headlines are typed in.
 *
 * HYDRATION (React #418) — `/` is prerendered by puppeteer and hydrated
 *
 *   The first render must be identical on the server and in the browser, so
 *   nothing here reads time, randomness, window or matchMedia during render:
 *   - the slide index starts at 0; timers start in effects only;
 *   - the countdown renders "––" and is filled in by an effect;
 *   - start/end dates are applied where the slides are FETCHED (Home.jsx),
 *     not here, so the boot snapshot and the first client render agree;
 *   - particles, tilt and reduced-motion checks all live in effects;
 *   - and effects that CHANGE markup (autoplay, countdown) do nothing during
 *     the prerender itself (isPrerender), because puppeteer captures the HTML
 *     after effects have run — a slide advanced or a countdown ticking at
 *     capture time would be baked in and then disagree with the browser.
 *
 * HEIGHT — the screen below the 80px header (svh, so a phone's address bar
 * never hides the book button), minus the bottom tray on phones; see
 * `.hx-hero` in index.css.
 */

const DUR = 7000;
const DEFAULT_ACCENT = "#38bdf8";
const HEX = /^#[0-9a-f]{6}$/i;
const FOCUS = /^\d{1,3}% \d{1,3}%$/;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/* Dates typed in Admin are Indian time. "2026-11-28" or "2026-11-28 09:30"
   become an explicit +05:30 timestamp: Safari returns Invalid Date for the
   space form, and a bare date would otherwise be read in the visitor's zone.
   endOfDay makes a date-only "until" cover the whole day. NaN if unreadable. */
export function parseIst(v, endOfDay = false) {
    const s = String(v || "").trim();
    if (!s) return NaN;
    const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
    if (m) {
        const time = m[2] ? `${m[2]}:${m[3]}:00` : endOfDay ? "23:59:59" : "00:00:00";
        return new Date(`${m[1]}T${time}+05:30`).getTime();
    }
    return new Date(s).getTime();
}

// Admins paste full https://www.oakbridge.in/... links; those are our own
// pages and must navigate in place, not open a new tab like an external site.
export const localise = (link) => {
    const s = String(link || "").trim();
    const m = s.match(/^https?:\/\/(?:www\.)?oakbridge\.in(\/[^\s]*)?$/i);
    return m ? m[1] || "/" : s;
};

// "*word*" -> highlighted. Split per word so each can animate in.
function Headline({ text }) {
    let i = 0;
    const parts = String(text || "").split(/(\*[^*]+\*)/g).filter(Boolean);
    return (
        <h2 className="hx-h1">
            {parts.map((p, k) => {
                const em = p.startsWith("*") && p.endsWith("*");
                const words = (em ? p.slice(1, -1) : p).split(/(\s+)/).filter((w) => w.length);
                return words.map((w, j) =>
                    /^\s+$/.test(w) ? (
                        " "
                    ) : (
                        <span key={`${k}-${j}`} className="hx-w" style={{ "--i": i++ }}>
                            {em ? <em>{w}</em> : w}
                        </span>
                    ),
                );
            })}
        </h2>
    );
}

function Countdown({ at }) {
    const [left, setLeft] = useState(null); // null on the server and first client render
    useEffect(() => {
        const t0 = parseIst(at);
        if (!Number.isFinite(t0) || isPrerender()) return undefined;
        const tick = () => setLeft(Math.max(0, Math.floor((t0 - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [at]);
    if (left === 0) return null; // the event has started: no "00 00 00 00"
    const v = left == null ? null : [Math.floor(left / 86400), Math.floor((left % 86400) / 3600), Math.floor((left % 3600) / 60), left % 60];
    return (
        <div className="hx-count hx-reveal" style={{ "--d": "1s" }} aria-label="Time until the event">
            {["days", "hrs", "min", "sec"].map((u, k) => (
                <div key={u}>
                    <b>{v ? String(v[k]).padStart(2, "0") : "––"}</b>
                    <span>{u}</span>
                </div>
            ))}
        </div>
    );
}

// The cover to glow from, when the slide asks for it (or has no photo at all).
const coverGlow = (slide) => {
    const c = slide.cover ? mediaUrl(slide.cover) || slide.cover : null;
    return c && (slide.bg === "cover" || !slide.image) ? c : null;
};

function Background({ slide, eager, priority, artwork }) {
    const src = mediaUrl(slide.image) || slide.image;
    const mobile = slide.image_mobile ? mediaUrl(slide.image_mobile) || slide.image_mobile : null;
    const focus = FOCUS.test(slide.focus || "") ? slide.focus : "50% 50%";
    const img = (cls, decorative) => (
        <img
            src={src}
            // Live-text slides: the photo is decoration, the heading says it.
            alt={decorative || !artwork ? "" : slide.alt || ""}
            {...(decorative ? { "aria-hidden": true } : {})}
            decoding="async"
            {...(eager && priority && !decorative ? { fetchPriority: "high" } : {})}
            className={cls}
            style={{ objectPosition: focus }}
        />
    );
    const pic = (cls, decorative) =>
        mobile ? (
            <picture>
                <source media="(max-width: 767px)" srcSet={mobile} />
                {img(cls, decorative)}
            </picture>
        ) : (
            img(cls, decorative)
        );
    if (artwork) {
        return (
            <div className="hx-bg">
                {pic("hx-bg-blur", true)}
                {pic("hx-bg-art")}
            </div>
        );
    }
    /* "Glow from the book cover": no photo needed. The cover itself, hugely
       blurred, saturated and darkened, becomes a backdrop in the book's own
       colours — so a highlight can go live with nothing but its cover. */
    const cover = coverGlow(slide);
    if (cover) {
        return (
            <div className="hx-bg hx-kb">
                <img
                    src={cover}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    {...(eager && priority ? { fetchPriority: "high" } : {})}
                    className="hx-bg-photo hx-bg-cover"
                />
            </div>
        );
    }
    return <div className="hx-bg hx-kb">{pic("hx-bg-photo")}</div>;
}

function Visual({ slide, warm }) {
    const cover = slide.cover ? mediaUrl(slide.cover) || slide.cover : null;
    if (cover) {
        return (
            <div className="hx-visual hx-reveal" style={{ "--d": ".4s" }} aria-hidden="true">
                <div className="hx-ring" />
                <div className="hx-glow" />
                <div className="hx-book" data-tilt>
                    {warm && <img className="hx-book-front" src={cover} alt="" decoding="async" />}
                    <div className="hx-book-spine" />
                    <div className="hx-book-pages" />
                </div>
            </div>
        );
    }
    const when = parseIst(slide.event_date);
    // Day and month worked out by hand in IST (UTC+5:30), not with
    // toLocaleDateString: the prerender's Chrome and a visitor's Safari can
    // word a locale date differently, and any difference is a #418.
    if (Number.isFinite(when)) {
        const ist = new Date(when + 330 * 60000);
        const day = String(ist.getUTCDate()).padStart(2, "0");
        const mon = `${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
        return (
            <div className="hx-visual hx-visual-date hx-reveal" style={{ "--d": ".4s" }} aria-hidden="true">
                <div className="hx-ring" />
                <div className="hx-glow" />
                <div className="hx-date" data-tilt>
                    <div className="hx-date-glass" />
                    <div className="hx-date-text">
                        <b>{day}</b>
                        <span>{mon}</span>
                    </div>
                </div>
            </div>
        );
    }
    return null;
}

function Slide({ slide, index, active, priority, warm }) {
    const artwork = !String(slide.title || "").trim();
    const accent = HEX.test(slide.accent || "") ? slide.accent : DEFAULT_ACCENT;
    const link = localise(slide.link);
    const chips = String(slide.chips || "")
        .split(/[|\n]/)
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 4);
    const body = (
        <>
            {warm && <Background slide={slide} eager={index === 0} priority={priority} artwork={artwork} />}
            {!artwork && <div className="hx-scrim" />}
            {!artwork && (
                <div className={`hx-content ${slide.cover || slide.event_date ? "" : "hx-solo"}`}>
                    <div className="hx-text">
                        {slide.eyebrow && (
                            <span className="hx-eyebrow hx-reveal" style={{ "--d": ".1s" }}>
                                <i />
                                {slide.eyebrow}
                            </span>
                        )}
                        <Headline text={slide.title} />
                        {slide.subtitle && (
                            <p className="hx-sub hx-reveal" style={{ "--d": ".75s" }}>
                                {slide.subtitle}
                            </p>
                        )}
                        {chips.length > 0 && (
                            <div className="hx-chips hx-reveal" style={{ "--d": ".9s" }}>
                                {chips.map((c) => (
                                    <span key={c}>{c}</span>
                                ))}
                            </div>
                        )}
                        {Number.isFinite(parseIst(slide.event_date)) && <Countdown at={slide.event_date} />}
                        {(link || slide.cta2_link) && (
                            <div className="hx-ctas hx-reveal" style={{ "--d": "1.05s" }}>
                                <SmartLink to={link} className="hx-btn hx-btn-primary" tabIndex={active ? 0 : -1}>
                                    {slide.cta_label || "Learn more"} <span aria-hidden="true">→</span>
                                </SmartLink>
                                <SmartLink to={localise(slide.cta2_link)} className="hx-btn hx-btn-ghost" tabIndex={active ? 0 : -1}>
                                    {slide.cta2_label || "More"}
                                </SmartLink>
                            </div>
                        )}
                    </div>
                    <Visual slide={slide} warm={warm} />
                </div>
            )}
        </>
    );
    return (
        <article
            className={`hx-slide ${active ? "is-on" : ""}`}
            style={{ "--accent": accent }}
            aria-roledescription="slide"
            aria-hidden={!active}
            aria-label={slide.alt || String(slide.title || "").replace(/\*/g, "") || `Highlight ${index + 1}`}
        >
            {/* A finished artwork banner is one picture, so the whole of it is
                the link — as before. Live slides link through their buttons. */}
            {artwork && link ? (
                <SmartLink to={link} className="hx-art-link" tabIndex={active ? 0 : -1}>
                    {body}
                </SmartLink>
            ) : (
                body
            )}
        </article>
    );
}

/* The animated book: scrolls to the next homepage section. */
function BookButton({ onClick }) {
    return (
        <button type="button" className="hx-bookbtn" onClick={onClick} aria-label="Scroll to the next section" data-testid="hero-scroll-book">
            <span className="hx-orb">
                <svg viewBox="0 0 48 36" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                    <path d="M24 6 C18 2 10 2 3 4 V32 C10 30 18 30 24 34 C30 30 38 30 45 32 V4 C38 2 30 2 24 6 Z" fill="rgba(255,255,255,.08)" />
                    <path d="M24 6 V34" />
                    <path className="hx-leaf" d="M24 7 C28 4 34 4 40 5 V29 C34 28 28 29 24 32 Z" fill="rgba(245,158,11,.35)" stroke="#F59E0B" />
                    <path className="hx-leaf hx-l2" d="M24 7 C28 4 34 4 40 5 V29 C34 28 28 29 24 32 Z" fill="rgba(255,255,255,.15)" />
                    <path className="hx-leaf hx-l3" d="M24 7 C28 4 34 4 40 5 V29 C34 28 28 29 24 32 Z" fill="rgba(56,189,248,.25)" stroke="#38bdf8" />
                </svg>
            </span>
            <span className="hx-booklabel">Explore</span>
            <span className="hx-chev" aria-hidden="true" />
        </button>
    );
}

/* Light particle network. Effect-only (never in the prerender), capped by
   area, stopped while the hero is off-screen or the tab is hidden, and not
   started at all for reduced motion or Data Saver. */
function useParticles(heroRef, canvasRef) {
    useEffect(() => {
        const hero = heroRef.current;
        const cv = canvasRef.current;
        if (!hero || !cv || typeof window === "undefined") return undefined;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const saveData = navigator.connection?.saveData;
        if (reduce || saveData || isPrerender()) return undefined;
        const ctx = cv.getContext("2d");
        if (!ctx) return undefined;
        let W = 0, H = 0, P = [], raf = 0, visible = true;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const size = () => {
            W = hero.clientWidth;
            H = hero.clientHeight;
            cv.width = W * dpr;
            cv.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const n = Math.min(80, Math.round((W * H) / 24000));
            P = Array.from({ length: n }, () => ({
                x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.3,
                vx: (Math.random() - 0.5) * 0.25, vy: -Math.random() * 0.35 - 0.05, a: Math.random() * 0.6 + 0.2,
            }));
        };
        const tick = () => {
            raf = 0;
            if (!visible || document.hidden) return;
            ctx.clearRect(0, 0, W, H);
            for (const p of P) {
                p.x += p.vx;
                p.y += p.vy;
                if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, 6.283);
                ctx.fillStyle = `rgba(180,225,255,${p.a})`;
                ctx.fill();
            }
            for (let i = 0; i < P.length; i++) {
                for (let j = i + 1; j < P.length; j++) {
                    const a = P[i], b = P[j];
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (d < 110) {
                        ctx.strokeStyle = `rgba(120,200,255,${0.12 * (1 - d / 110)})`;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }
            }
            raf = requestAnimationFrame(tick);
        };
        const start = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick); };
        const ro = new ResizeObserver(size);
        ro.observe(hero);
        size();
        const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); });
        io.observe(hero);
        const onVis = () => start();
        document.addEventListener("visibilitychange", onVis);
        start();
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [heroRef, canvasRef]);
}

export default function HeroFullscreen({ slides = [], priority = false, testId = "home-hero-fullscreen" }) {
    const n = slides.length;
    const [i, setI] = useState(0);
    const [paused, setPaused] = useState(false);
    const [cycle, setCycle] = useState(0); // restarts the progress bar animation
    /* Which slides may load their images: the one showing and the next one.
       NOT loading="lazy" — browsers do not reliably lazy-load images inside a
       visibility:hidden slide, so a cover could stay blank after its slide
       appeared (seen in testing). Instead a slide gets its <img> only when it
       is current or next, eagerly; covers are full-size uploads (up to
       ~1.6 MB), so nothing further ahead is fetched. Starts as {0, 1} in both
       the prerender and the first browser render. */
    const [warm, setWarm] = useState(() => new Set([0, 1]));
    const heroRef = useRef(null);
    const canvasRef = useRef(null);
    const touch = useRef(null);
    const idx = n ? i % n : 0;

    useParticles(heroRef, canvasRef);

    const go = useCallback((k) => {
        if (!n) return;
        setI(((k % n) + n) % n);
        setCycle((c) => c + 1);
    }, [n]);
    useEffect(() => {
        if (!n) return;
        setWarm((w) => (w.has(idx) && w.has((idx + 1) % n) ? w : new Set([...w, idx, (idx + 1) % n])));
    }, [idx, n]);

    // Autoplay — effect only. Held for reduced motion, hover/focus, hidden tab.
    useEffect(() => {
        if (n <= 1 || paused || isPrerender()) return undefined;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
        const t = setTimeout(() => go(idx + 1), DUR);
        return () => clearTimeout(t);
    }, [n, idx, paused, cycle, go]);
    useEffect(() => {
        const onVis = () => { setPaused(document.hidden); if (!document.hidden) setCycle((c) => c + 1); };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, []);

    // 3D tilt + background parallax following a mouse (never on touch).
    useEffect(() => {
        const hero = heroRef.current;
        if (!hero || !window.matchMedia?.("(pointer: fine)").matches) return undefined;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
        let raf = 0, x = 0, y = 0;
        const apply = () => {
            raf = 0;
            hero.style.setProperty("--tx", x.toFixed(3));
            hero.style.setProperty("--ty", y.toFixed(3));
        };
        const onMove = (e) => {
            const r = hero.getBoundingClientRect();
            x = (e.clientX - r.left) / r.width - 0.5;
            y = (e.clientY - r.top) / r.height - 0.5;
            if (!raf) raf = requestAnimationFrame(apply);
        };
        hero.addEventListener("pointermove", onMove);
        return () => { hero.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
    }, []);

    /* The next section in what the visitor SEES: Home lays sections out with
       CSS `order`, so DOM order is not screen order — the first block whose
       top is at or below the hero's bottom is the one. Lands just under the
       sticky header. */
    const scrollNext = () => {
        const hero = heroRef.current;
        if (!hero) return;
        const header = document.querySelector('[data-testid="site-header"]');
        const hh = header ? header.getBoundingClientRect().height : 0;
        const bottom = hero.getBoundingClientRect().bottom + window.scrollY;
        const host = hero.closest('[data-testid="home-page"]');
        const tops = host
            ? [...host.children]
                .filter((el) => !el.contains(hero) && el.offsetHeight > 0)
                .map((el) => el.getBoundingClientRect().top + window.scrollY)
                .filter((t) => t >= bottom - 2)
            : [];
        const target = tops.length ? Math.min(...tops) : bottom;
        const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: Math.max(0, target - hh), behavior: smooth ? "smooth" : "auto" });
    };

    return (
        <section
            ref={heroRef}
            data-testid={testId}
            className={`hx-hero ${paused ? "is-paused" : ""} ${n && !String(slides[idx]?.title || "").trim() ? "is-art" : ""}`}
            aria-roledescription="carousel"
            aria-label="Latest from Oakbridge"
            // Resuming restarts the bar with the timer, so the two never disagree.
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => { setPaused(false); setCycle((c) => c + 1); }}
            onFocus={() => setPaused(true)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setPaused(false); setCycle((c) => c + 1); } }}
            onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
                if (touch.current == null || n <= 1) return;
                const dx = e.changedTouches[0].clientX - touch.current;
                if (Math.abs(dx) > 45) go(idx + (dx < 0 ? 1 : -1));
                touch.current = null;
            }}
        >
            <div className="hx-aurora" aria-hidden="true" style={{ "--accent": HEX.test(slides[idx]?.accent || "") ? slides[idx].accent : DEFAULT_ACCENT }} />
            <div className="hx-grid" aria-hidden="true" />
            <canvas ref={canvasRef} className="hx-particles" aria-hidden="true" />

            {slides.map((s, k) => (
                <Slide key={s.id || k} slide={s} index={k} active={k === idx} priority={priority} warm={warm.has(k)} />
            ))}

            <div className="hx-dock">
                <div className="hx-progress" role="tablist" aria-label="Highlights">
                    {n > 1 &&
                        slides.map((s, k) => (
                            <button
                                key={s.id || k}
                                type="button"
                                role="tab"
                                aria-selected={k === idx}
                                aria-label={`Highlight ${k + 1}: ${String(s.title || s.alt || "").replace(/\*/g, "")}`}
                                className={`${k === idx ? "is-on" : ""} ${k < idx ? "is-done" : ""}`}
                                onClick={() => go(k)}
                            >
                                <i key={k === idx ? cycle : "x"} style={{ "--dur": `${DUR}ms` }} />
                                <span>{String(s.eyebrow || s.title || s.alt || "").replace(/\*/g, "")}</span>
                            </button>
                        ))}
                </div>
                <BookButton onClick={scrollNext} />
                <div className="hx-counter">
                    {n > 1 && (
                        <>
                            <span>
                                <b>{String(idx + 1).padStart(2, "0")}</b> / {String(n).padStart(2, "0")}
                            </span>
                            <button type="button" onClick={() => go(idx - 1)} aria-label="Previous highlight">
                                <ChevronLeft size={18} strokeWidth={1.5} />
                            </button>
                            <button type="button" onClick={() => go(idx + 1)} aria-label="Next highlight">
                                <ChevronRight size={18} strokeWidth={1.5} />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}
