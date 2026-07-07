import React, { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { sendChat } from "../lib/api";

const GREETING =
    "Hi! I'm Oaky, the Oakbridge assistant. Ask me about ordering, shipping, returns, or finding books.";
const SUGGESTIONS = [
    "How do I place an order?",
    "What are your shipping charges?",
    "What's your return policy?",
    "How do I request a desk copy?",
];

export default function ChatWidget() {
    const [open, setOpen] = useState(false);
    const [msgs, setMsgs] = useState([{ role: "assistant", content: GREETING }]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const endRef = useRef(null);
    const inputRef = useRef(null);

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
            // send prior turns (exclude the greeting) as history
            const history = nextMsgs
                .slice(1, -1)
                .map((m) => ({ role: m.role, content: m.content }));
            const res = await sendChat(message, history);
            setMsgs((cur) => [...cur, { role: "assistant", content: res.reply }]);
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
            {/* Launcher */}
            <button
                onClick={() => setOpen((o) => !o)}
                data-testid="chat-launcher"
                aria-label={open ? "Close chat" : "Open chat"}
                className="fixed z-50 bottom-5 right-5 w-14 h-14 rounded-full bg-[#002B5C] text-white shadow-lg flex items-center justify-center hover:bg-[#001F42] transition-colors"
            >
                {open ? <X size={22} strokeWidth={1.75} /> : <MessageCircle size={24} strokeWidth={1.75} />}
            </button>

            {/* Panel */}
            {open && (
                <div
                    data-testid="chat-panel"
                    className="fixed z-50 bottom-24 right-5 w-[92vw] max-w-[380px] h-[70vh] max-h-[560px] bg-white border border-[#E5E7EB] shadow-2xl flex flex-col overflow-hidden"
                >
                    <div className="bg-[#002B5C] text-white px-5 py-4">
                        <div className="font-serif text-lg leading-tight">Oakbridge Assistant</div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-white/60 mt-1">
                            FAQs &amp; help
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#F5F7FA]">
                        {msgs.map((m, i) => (
                            <div
                                key={i}
                                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
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
                                        className="block w-full text-left text-xs text-[#002B5C] border border-[#E5E7EB] bg-white px-3 py-2 hover:border-[#002B5C]"
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
                            className="flex-1 border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                        />
                        <button
                            onClick={() => send()}
                            disabled={busy || !input.trim()}
                            data-testid="chat-send"
                            aria-label="Send"
                            className="bg-[#002B5C] text-white p-2.5 hover:bg-[#001F42] disabled:opacity-50"
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
