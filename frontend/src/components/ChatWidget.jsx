import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessageCircle, X, Send, ArrowRight } from "lucide-react";
import { sendChat } from "../lib/api";

const GREETING =
    "Hi! I'm Oaky, the Oakbridge assistant. Ask me about ordering, shipping, returns, finding books — or say \"take me to the bookstore\" and I'll get you there.";
const SUGGESTIONS = [
    "Take me to the bookstore",
    "What are your shipping charges?",
    "What's your return policy?",
    "How do I request a desk copy?",
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
 * First-visit nudge. Plenty of people never notice a floating chat button, so on
 * the first few homepage landings Oaky introduces itself in a small bubble beside
 * the launcher. Capped at NUDGE_LIMIT views and dismissed for good once the
 * visitor closes it or opens the chat — a greeting that keeps reappearing stops
 * being a welcome and starts being an irritation.
 */
const NUDGE_KEY = "oakbridge_oaky_nudges";
const NUDGE_LIMIT = 5;
const NUDGE_TEXT =
    "Hi, I'm Oaky, your personal AI assistant. Let me know how I can help you today?";

const readNudges = () => {
    try {
        const v = JSON.parse(localStorage.getItem(NUDGE_KEY) || "{}");
        return { count: Number(v.count) || 0, done: Boolean(v.done) };
    } catch {
        return { count: 0, done: false };
    }
};
const writeNudges = (v) => {
    try {
        localStorage.setItem(NUDGE_KEY, JSON.stringify(v));
    } catch {
        /* private mode — the nudge simply shows again next time */
    }
};

export default function ChatWidget() {
    const nav = useNavigate();
    const loc = useLocation();
    const [open, setOpen] = useState(false);
    const [nudge, setNudge] = useState(false);
    const [msgs, setMsgs] = useState([{ role: "assistant", content: GREETING }]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const endRef = useRef(null);
    const inputRef = useRef(null);
    const panelRef = useRef(null);
    const launcherRef = useRef(null);

    // Count homepage landings and show the greeting for the first few.
    useEffect(() => {
        if (loc.pathname !== "/") {
            setNudge(false);
            return;
        }
        const v = readNudges();
        if (v.done || v.count >= NUDGE_LIMIT) return;
        writeNudges({ ...v, count: v.count + 1 });
        const t = setTimeout(() => setNudge(true), 1200); // let the hero settle first
        return () => clearTimeout(t);
    }, [loc.pathname]);

    // Opening the chat means the nudge did its job — never show it again.
    useEffect(() => {
        if (open && nudge) {
            setNudge(false);
            writeNudges({ ...readNudges(), done: true });
        }
    }, [open, nudge]);

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
            {/* First-visit greeting */}
            {nudge && !open && (
                <div
                    data-testid="oaky-nudge"
                    role="status"
                    className="fixed z-50 bottom-above-tray-2 right-5 md:bottom-[5.5rem] max-w-[16rem] bg-white border border-[#E5E7EB] shadow-lg p-4 fade-up"
                >
                    <button
                        onClick={() => {
                            setNudge(false);
                            writeNudges({ ...readNudges(), done: true });
                        }}
                        aria-label="Dismiss"
                        className="absolute top-2 right-2 text-[#4B5563] hover:text-[#CC0033]"
                    >
                        <X size={14} strokeWidth={1.75} />
                    </button>
                    <div className="overline !text-[9px] !text-[#CC0033]">Oaky</div>
                    <p className="text-sm text-[#002B5C] mt-1.5 leading-snug pr-3">{NUDGE_TEXT}</p>
                    <button
                        onClick={() => setOpen(true)}
                        className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]"
                    >
                        Start chatting
                    </button>
                    {/* little pointer toward the launcher */}
                    <span className="absolute -bottom-[7px] right-7 w-3 h-3 bg-white border-r border-b border-[#E5E7EB] rotate-45" />
                </div>
            )}

            {/* Launcher */}
            <button
                ref={launcherRef}
                onClick={() => setOpen((o) => !o)}
                data-testid="chat-launcher"
                aria-label={open ? "Close chat" : "Open chat"}
                className="fixed z-50 bottom-above-tray right-5 md:bottom-5 fixed-stable w-14 h-14 rounded-full bg-[#F59E0B] text-[#002B5C] shadow-lg flex items-center justify-center hover:bg-[#E08E00] transition-colors"
            >
                {open ? <X size={22} strokeWidth={1.75} /> : <MessageCircle size={24} strokeWidth={1.75} />}
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
                            className="flex-1 border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#F59E0B]"
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
