import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { track } from "../lib/analytics";

/**
 * "Torch in your hand" — the homepage hero photograph sits in the dark and a
 * warm reading-lamp beam lights the shelf wherever the visitor points.
 *
 * Why it is built this way:
 *
 * - The beam is a hole in a dark layer three times the panel's size, moved
 *   with transform: translate3d. Moving a transform is compositor-only; the
 *   obvious alternative (changing the gradient's centre every frame) repaints
 *   a 720px-tall layer 60 times a second on the most important screen of the
 *   site.
 * - The photo underneath is the page's LCP and is untouched: same <img>, same
 *   priority. This only adds a layer over it, so the photo still paints as
 *   early as before.
 * - Mouse: the beam follows the pointer. Touch: a tap or drag moves it there
 *   (touch-action stays pan-y, so the page still scrolls — the browser takes
 *   the gesture and we keep the last point). With nobody steering, it drifts
 *   on its own along a slow loop, so phones and idle desktops still see it
 *   move.
 * - The drift stops while the panel is off screen or the tab is hidden — no
 *   animation frames are spent on something nobody can see.
 * - prefers-reduced-motion: no autonomous drift; the beam rests in the middle
 *   and only moves where the visitor points (their own movement, not ours).
 * - A click anywhere on the panel opens the bookstore — "I found something,
 *   take me there" is the whole point of the effect. The keyboard and screen
 *   reader route is the CTA link, a real <a> (the panel's click is a mouse
 *   convenience on top of it, not the only way in). The CTA is passed in as
 *   a child by Home.jsx, with the photo panel's other content.
 */
const PATH = [[0.3, 0.25], [0.72, 0.36], [0.32, 0.58], [0.66, 0.72], [0.5, 0.45]];

function drift(t) {
    const n = PATH.length;
    const s = ((t % n) + n) % n;
    const i = Math.floor(s);
    const f = s - i;
    const e = f * f * (3 - 2 * f); // smoothstep: eases in and out of each point
    const p = PATH[i];
    const q = PATH[(i + 1) % n];
    return [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e];
}

export default function HeroTorch({ to = "/books", children }) {
    const boxRef = useRef(null);
    const darkRef = useRef(null);
    const [steered, setSteered] = useState(false); // hides the "move to search" hint
    const navigate = useNavigate();

    useEffect(() => {
        const box = boxRef.current;
        const dark = darkRef.current;
        if (!box || !dark) return undefined;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

        let w = box.clientWidth;
        let h = box.clientHeight;
        let x = w * 0.5;
        let y = h * 0.42;
        let target = null; // last pointer position, in px
        let lastPointer = -1e9;
        let t = Math.random() * PATH.length;
        let visible = true;
        let raf = 0;
        let prev = performance.now();

        const place = () => {
            dark.style.transform = `translate3d(${x - w / 2}px, ${y - h / 2}px, 0)`;
        };
        const frame = (now) => {
            raf = 0;
            const dt = Math.min(64, now - prev);
            prev = now;
            let tx;
            let ty;
            // The pointer wins for 2.5 s after it last moved, then the lamp
            // goes back to wandering on its own.
            if (target && now - lastPointer < 2500) {
                [tx, ty] = target;
            } else if (reduce) {
                [tx, ty] = target || [w * 0.5, h * 0.42];
            } else {
                t += dt * 0.00035;
                const [fx, fy] = drift(t);
                tx = fx * w;
                ty = fy * h;
            }
            // Ease towards the target: the beam trails the hand a little,
            // which is what makes it feel like a torch and not a cursor.
            const k = 1 - Math.pow(0.0015, dt / 1000);
            x += (tx - x) * k;
            y += (ty - y) * k;
            place();
            const settled = Math.abs(tx - x) < 0.5 && Math.abs(ty - y) < 0.5;
            if (visible && !document.hidden && !(reduce && settled)) raf = requestAnimationFrame(frame);
        };
        const kick = () => {
            if (!raf && visible && !document.hidden) {
                prev = performance.now();
                raf = requestAnimationFrame(frame);
            }
        };
        const onPointer = (e) => {
            const r = box.getBoundingClientRect();
            target = [e.clientX - r.left, e.clientY - r.top];
            lastPointer = performance.now();
            setSteered(true);
            kick();
        };
        const onResize = () => {
            w = box.clientWidth;
            h = box.clientHeight;
            place();
        };

        place();
        box.addEventListener("pointermove", onPointer);
        box.addEventListener("pointerdown", onPointer);
        window.addEventListener("resize", onResize);
        document.addEventListener("visibilitychange", kick);
        let io;
        if (typeof IntersectionObserver !== "undefined") {
            io = new IntersectionObserver(([en]) => {
                visible = en.isIntersecting;
                kick();
            });
            io.observe(box);
        }
        kick();
        return () => {
            if (raf) cancelAnimationFrame(raf);
            box.removeEventListener("pointermove", onPointer);
            box.removeEventListener("pointerdown", onPointer);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("visibilitychange", kick);
            io?.disconnect();
        };
    }, []);

    return (
        <div
            ref={boxRef}
            className="ht-box absolute inset-0 z-[1] cursor-pointer"
            onClick={(e) => {
                // Links inside (the CTA) handle their own click.
                if (e.target.closest("a")) return;
                track("hero_bookstore_click", { via: "torch", where: "panel" });
                navigate(to);
            }}
        >
            <div ref={darkRef} className="ht-dark" aria-hidden="true" />
            <div className={`ht-hint ${steered ? "is-gone" : ""}`} aria-hidden="true">
                Move to search the shelf
            </div>
            {/* The panel's own content (badge, quote, CTA) sits above the
                dark layer, inside the box so the beam follows over it too. */}
            {children}
        </div>
    );
}
