import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { X, Send, ArrowRight } from "lucide-react";
import { sendChat } from "../lib/api";
import { isPrerender } from "../lib/runtime";

const GREETING =
    "Hi! I'm Asterisk, the Oakbridge AI assistant. Ask me about ordering, shipping, returns, finding books — or say \"take me to the bookstore\" and I'll get you there.";
const SUGGESTIONS = [
    "Take me to the bookstore",
    "What are your shipping charges?",
    "What's your return policy?",
];

// Only these destinations may be auto-navigated to.
const ROUTES = {
    "/": "Home",
    "/books": "Bookstore",
    "/events": "Events",
    "/academy": "Academy",
    "/digital-solutions": "Digital Solutions",
    "/authors": "Authors",
    "/about": "About",
    "/contact": "Contact",
    "/submissions": "Submissions",
    "/cart": "Cart",
    "/terms": "Terms",
    "/privacy": "Privacy",
    "/shipping-policy": "Shipping Policy",
    "/what-we-do": "What We Do",
};

function parseGo(reply) {
    const m = (reply || "").match(/\[\[go:(\/[^\]\s]*)\]\]/i);
    if (!m) return { text: reply, go: null };
    const text = reply.replace(m[0], "").trim();
    let path = m[1];
    // allow /books?... variants; otherwise must be an exact known route
    const base = path.split("?")[0];
    const ok = base === "/books" || Object.prototype.hasOwnProperty.call(ROUTES, base);
    return { text, go: ok ? path : null };
}

const labelFor = (path) => ROUTES[path.split("?")[0]] || "the page";

/*
 * SMART NUDGE (Oct 2026, replaces the homepage-only greeting).
 *
 * Plenty of people never notice a floating chat button, so Asterisk speaks up
 * ONCE per visit with a card that fits the page they are on — a book page
 * gets "Which edition is this?", the cart gets "Need help checking out?" —
 * and 2–3 questions they can tap instead of typing. Rules:
 *   - at most once per visit (sessionStorage), and never again once the
 *     visitor closes a card or opens the chat (localStorage "done");
 *   - not before the page has settled (NUDGE_DELAY), never in the prerender;
 *   - never on top of a buy button: it waits while Add to Cart / Buy Now /
 *     checkout is in the corner it would cover, and hides if one scrolls there.
 * Nothing here is a cookie or tracks anyone: two flags on this device.
 */
const NUDGE_KEY = "oakbridge_oaky_nudges";
const NUDGE_SESSION = "oakbridge_asterisk_nudged";
const NUDGE_DELAY = { book: 12000, cart: 6000, default: 8000 };

const pageTitle = () => (document.title || "").split(" · ")[0].split(" | ")[0].trim().slice(0, 90);

function nudgeFor(pathname) {
    if (/^\/books\/[^/]+$/.test(pathname)) {
        const t = pageTitle();
        const about = t ? `About “${t}”: ` : "";
        return { kind: "book", title: "Questions about this book?", short: "Questions about this book?",
            chips: [["Which edition is this?", `${about}which edition is this, and what's new in it?`],
                ["When will it reach me?", "How long does delivery take, and what does shipping cost?"],
                ["Bulk / institutional order", `${about}I'd like to order several copies for an institution.`]] };
    }
    if (pathname === "/cart" || pathname === "/checkout") {
        return { kind: "cart", title: "Need help before you check out?", short: "Help with checkout?",
            chips: [["Shipping charges", "What are your shipping charges?"], ["Delivery time", "How long does delivery take?"],
                ["Payment options", "Which payment methods can I use?"]] };
    }
    if (pathname === "/books" || pathname === "/ebooks") {
        return { kind: "browse", title: "Can't find the right book?", short: "Can't find a book?",
            chips: [["Help me find a book", "Help me find a book"], ["New releases", "Show me your new releases"],
                ["Books for UPSC", "Which books do you have for UPSC preparation?"]] };
    }
    if (pathname === "/") {
        return { kind: "home", title: "Hi, I'm Asterisk — how can I help?", short: "Hi, I'm Asterisk",
            chips: [["Take me to the bookstore", "Take me to the bookstore"], ["Shipping charges", "What are your shipping charges?"],
                ["Return policy", "What's your return policy?"]] };
    }
    return null;
}

// Buttons the launcher and the card must never sit on top of.
const BUY_BUTTONS = [
    '[data-testid="add-to-cart-main-button"]', '[data-testid="buy-now-button"]', '[data-testid="preorder-button"]',
    '[data-testid="cart-checkout-button"]', '[data-testid="cart-page-checkout-button"]', '[data-testid="place-order-button"]',
    '[data-testid^="add-to-cart-"]', '[data-testid^="preorder-"]',
].join(",");
const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const boxCoversBuyButton = (box) => {
    for (const b of document.querySelectorAll(BUY_BUTTONS)) {
        if (overlaps(box, b.getBoundingClientRect())) return true;
    }
    return false;
};
const coversBuyButton = (el, pad = 8) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return boxCoversBuyButton({ left: r.left - pad, right: r.right + pad, top: r.top - pad, bottom: r.bottom + pad });
};
// Where the card WILL sit: to the left of the launcher (so it never covers
// the back-to-top button stacked above it), up to 18rem wide, ~10rem tall.
const nudgeZoneCoversBuy = (launcher) => {
    if (!launcher) return false;
    const r = launcher.getBoundingClientRect();
    return boxCoversBuyButton({ left: r.left - 300, right: r.right + 8, top: r.bottom - 170, bottom: r.bottom + 8 });
};

/*
 * "Aster" — the assistant's face: the asterisk itself with a small face in the
 * middle, navy on the amber launcher. Blinks and turns a sixth now and then
 * (index.css .aster-*); still for reduced-motion users.
 */
function Aster({ size = 34 }) {
    return (
        <svg className="aster-char" width={size} height={size} viewBox="0 0 46 46" aria-hidden="true" focusable="false">
            <g className="aster-arms" fill="#002B5C">
                <rect x="20" y="2" width="6" height="42" rx="3" />
                <rect x="20" y="2" width="6" height="42" rx="3" transform="rotate(60 23 23)" />
                <rect x="20" y="2" width="6" height="42" rx="3" transform="rotate(-60 23 23)" />
            </g>
            <circle cx="23" cy="23" r="11" fill="#FBF8F1" />
            <g className="aster-eyes" fill="#002B5C">
                <ellipse cx="19.3" cy="22" rx="1.9" ry="2.6" />
                <ellipse cx="26.7" cy="22" rx="1.9" ry="2.6" />
            </g>
            <path d="M19.5 26.6q3.5 2.6 7 0" stroke="#CC0033" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
    );
}

const readNudges = () => {
    try {
        const v = JSON.parse(localStorage.getItem(NUDGE_KEY) || "{}");
        let session = false;
        try { session = sessionStorage.getItem(NUDGE_SESSION) === "1"; } catch { /* private mode */ }
        return { count: Number(v.count) || 0, done: Boolean(v.done), session };
    } catch {
        return { count: 0, done: false, session: false };
    }
};
const markShownThisVisit = () => {
    try { sessionStorage.setItem(NUDGE_SESSION, "1"); } catch { /* private mode */ }
};
const writeNudges = (v) => {
    try {
        localStorage.setItem(NUDGE_KEY, JSON.stringify({ count: v.count || 0, done: Boolean(v.done) }));
    } catch {
        /* private mode — the nudge simply shows again next time */
    }
};

export default function ChatWidget() {
    const nav = useNavigate();
    const loc = useLocation();
    const [open, setOpen] = useState(false);
    const [nudge, setNudge] = useState(null);      // the smart-nudge card for this page, or null
    const [yieldBtn, setYieldBtn] = useState(false); // launcher steps aside from a buy button
    const [msgs, setMsgs] = useState([{ role: "assistant", content: GREETING }]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const endRef = useRef(null);
    const inputRef = useRef(null);
    const panelRef = useRef(null);
    const launcherRef = useRef(null);
    const nudgeRef = useRef(null);

    // The page-aware nudge: once per visit, after the page has settled.
    useEffect(() => {
        setNudge(null);
        const cfg = nudgeFor(loc.pathname);
        if (!cfg) return;
        // Never during the build: the prerender waits long enough for the
        // timer, which baked the bubble into index.html while every real
        // visitor's first render has no bubble — a hydration mismatch (#418)
        // that made React rebuild the whole homepage. See lib/boot.js.
        if (isPrerender()) return;
        const v = readNudges();
        if (v.done || v.session) return;
        let t;
        const tryShow = () => {
            // Wait while a buy button is in the launcher's corner; try again shortly.
            if (nudgeZoneCoversBuy(launcherRef.current)) {
                t = setTimeout(tryShow, 4000);
                return;
            }
            markShownThisVisit();
            writeNudges({ ...v, count: v.count + 1 });
            setNudge(cfg);
        };
        t = setTimeout(tryShow, NUDGE_DELAY[cfg.kind] || NUDGE_DELAY.default);
        return () => clearTimeout(t);
    }, [loc.pathname]);

    // Opening the chat means the nudge did its job — never show it again.
    useEffect(() => {
        if (open && nudge) {
            setNudge(null);
            writeNudges({ ...readNudges(), done: true });
        }
    }, [open, nudge]);

    // Never cover a buy button: while one passes under the launcher (or the
    // card) as the page scrolls, the launcher fades out of the way and the
    // card closes for this visit. Checked once per frame at most.
    useEffect(() => {
        if (isPrerender()) return undefined;
        let raf = 0;
        const check = () => {
            raf = 0;
            setYieldBtn(!open && coversBuyButton(launcherRef.current));
            if (nudgeRef.current && coversBuyButton(nudgeRef.current)) setNudge(null);
        };
        const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        const t = setTimeout(check, 600);
        return () => {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            if (raf) cancelAnimationFrame(raf);
            clearTimeout(t);
        };
    }, [open, loc.pathname]);

    const closeNudge = () => {
        setNudge(null);
        writeNudges({ ...readNudges(), done: true });
    };
    const askFromNudge = (question) => {
        closeNudge();
        setOpen(true);
        send(question);
    };

    // Close the flyout when the user clicks / taps outside it (but not on the launcher).
    useEffect(() => {
        if (!open) return;
        const onOutside = (e) => {
            if (
                panelRef.current &&
                !panelRef.current.contains(e.target) &&
                launcherRef.current &&
                !launcherRef.current.contains(e.target)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onOutside);
        return () => document.removeEventListener("pointerdown", onOutside);
    }, [open]);

    useEffect(() => {
        if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [msgs, open, busy]);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    const send = async (text) => {
        const message = (text ?? input).trim();
        if (!message || busy) return;
        setInput("");
        const nextMsgs = [...msgs, { role: "user", content: message }];
        setMsgs(nextMsgs);
        setBusy(true);
        try {
            const history = nextMsgs
                .slice(1, -1)
                .map((m) => ({ role: m.role, content: m.content }));
            const res = await sendChat(message, history);
            const { text: clean, go } = parseGo(res.reply);
            setMsgs((cur) => [
                ...cur,
                { role: "assistant", content: clean || (go ? `Taking you to ${labelFor(go)}…` : ""), go },
            ]);
            if (go) setTimeout(() => nav(go), 600); // widget lives in Layout, so chat stays open
        } catch (err) {
            const detail = err?.response?.data?.detail;
            setMsgs((cur) => [
                ...cur,
                {
                    role: "assistant",
                    content:
                        detail ||
                        "Sorry, I'm having trouble right now. Please email info@oakbridge.in and we'll help.",
                },
            ]);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {/* Smart nudge: page-aware, once per visit (see nudgeFor above) */}
            {nudge && !open && (
                <div
                    ref={nudgeRef}
                    data-testid="oaky-nudge"
                    role="status"
                    // Beside the launcher, not above it: the back-to-top button
                    // lives in the column above. Narrower on phones (iPhone SE: 320 px).
                    className="asterisk-nudge fixed z-50 bottom-above-tray right-[4.75rem] md:right-[5.5rem] md:bottom-5 w-[min(16rem,calc(100vw-6rem))] md:w-[17rem] bg-white border border-[#E5E7EB] shadow-lg p-3 md:p-4 fade-up rounded-xl"
                >
                    <button
                        onClick={closeNudge}
                        aria-label="Dismiss"
                        className="absolute top-1 right-1 w-9 h-9 flex items-center justify-center text-[#4B5563] hover:text-[#CC0033]"
                    >
                        <X size={14} strokeWidth={1.75} />
                    </button>
                    <div className="overline !text-[9px] !text-[#CC0033]">Asterisk</div>
                    <p className="text-sm text-[#002B5C] mt-1 leading-snug pr-6 font-medium">
                        <span className="md:hidden">{nudge.short}</span>
                        <span className="hidden md:inline">{nudge.title}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {nudge.chips.map(([label, q], i) => (
                            <button
                                key={label}
                                type="button"
                                onClick={() => askFromNudge(q)}
                                className={`text-xs text-[#002B5C] border border-[#F59E0B]/60 bg-[#FFF8EB] rounded-full px-2.5 py-1.5 min-h-[32px] hover:bg-[#F59E0B] ${i === 2 ? "hidden md:inline-flex" : "inline-flex"} items-center`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {/* little pointer toward the launcher (to the right) */}
                    <span className="absolute bottom-5 -right-[7px] w-3 h-3 bg-white border-r border-t border-[#E5E7EB] rotate-45" />
                </div>
            )}

            {/* Launcher */}
            <button
                ref={launcherRef}
                onClick={() => setOpen((o) => !o)}
                data-testid="chat-launcher"
                aria-label={open ? "Close chat" : "Open chat"}
                className={`asterisk-launcher ${open ? "is-open" : ""} ${yieldBtn ? "is-yielding" : ""} fixed z-50 bottom-above-tray right-5 md:bottom-5 fixed-stable w-14 h-14 rounded-full bg-[#F59E0B] text-[#002B5C] shadow-lg flex items-center justify-center hover:bg-[#E08E00] transition-[background-color,opacity] duration-300`}
            >
                {/* .asterisk-launcher (index.css): breathing amber rings; Aster blinks and turns. */}
                <span className="asterisk-face flex items-center justify-center">
                    {open ? <X size={22} strokeWidth={1.75} /> : <Aster />}
                </span>
            </button>

            {/* Panel */}
            {open && (
                <div
                    ref={panelRef}
                    data-testid="chat-panel"
                    className="fixed z-50 bottom-above-tray-2 right-5 md:bottom-24 w-[92vw] max-w-[380px] h-[70vh] max-h-[560px] bg-white border border-[#E5E7EB] shadow-2xl flex flex-col overflow-hidden"
                >
                    <div className="bg-[#F59E0B] text-[#002B5C] px-5 py-4">
                        <div className="font-serif text-lg leading-tight">Oakbridge Assistant</div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-[#002B5C]/70 mt-1">
                            FAQs &amp; help
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#F5F7FA]">
                        {msgs.map((m, i) => (
                            <div
                                key={i}
                                className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                            >
                                <div
                                    className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                                        m.role === "user"
                                            ? "bg-[#002B5C] text-white"
                                            : "bg-white border border-[#E5E7EB] text-[#002B5C]"
                                    }`}
                                >
                                    {m.content}
                                </div>
                                {m.go && (
                                    <button
                                        onClick={() => nav(m.go)}
                                        data-testid="chat-go"
                                        className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium bg-[#F59E0B] text-[#002B5C] px-3 py-1.5 hover:bg-[#E08E00]"
                                    >
                                        Go to {labelFor(m.go)} <ArrowRight size={12} strokeWidth={2} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {busy && (
                            <div className="flex justify-start">
                                <div className="bg-white border border-[#E5E7EB] text-[#4B5563] px-3.5 py-2.5 text-sm">
                                    <span className="inline-flex gap-1">
                                        <span className="w-1.5 h-1.5 bg-[#4B5563] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                        <span className="w-1.5 h-1.5 bg-[#4B5563] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                        <span className="w-1.5 h-1.5 bg-[#4B5563] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                    </span>
                                </div>
                            </div>
                        )}
                        {msgs.length === 1 && !busy && (
                            <div className="pt-2 space-y-2">
                                {SUGGESTIONS.map((q) => (
                                    <button
                                        key={q}
                                        onClick={() => send(q)}
                                        className="block w-full text-left text-xs text-[#002B5C] border border-[#E5E7EB] bg-white px-3 py-2 hover:border-[#F59E0B]"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div ref={endRef} />
                    </div>

                    <div className="border-t border-[#E5E7EB] p-3 flex items-center gap-2 bg-white">
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    send();
                                }
                            }}
                            placeholder="Ask a question…"
                            data-testid="chat-input"
                            className="flex-1 border border-[#E5E7EB] px-3 py-2 text-base md:text-sm outline-none focus:border-[#F59E0B]"
                        />
                        <button
                            onClick={() => send()}
                            disabled={busy || !input.trim()}
                            data-testid="chat-send"
                            aria-label="Send"
                            className="bg-[#F59E0B] text-[#002B5C] p-2.5 hover:bg-[#E08E00] disabled:opacity-50"
                        >
                            <Send size={16} strokeWidth={1.75} />
                        </button>
                    </div>
                    <div className="px-4 pb-2 text-[10px] text-[#4B5563] bg-white">
                        AI assistant — may be imperfect. For orders, email info@oakbridge.in.
                    </div>
                </div>
            )}
        </>
    );
}
