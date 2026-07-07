import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, CornerUpLeft } from "lucide-react";
import { adminListMessages, adminDeleteMessage, formatApiError } from "../../lib/api";

export default function AdminMessages() {
    const [msgs, setMsgs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);

    const load = () => {
        setLoading(true);
        adminListMessages()
            .then(setMsgs)
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const onDelete = async (id) => {
        setBusy(id);
        try {
            await adminDeleteMessage(id);
            setMsgs((prev) => prev.filter((m) => m.id !== id));
            toast.success("Message deleted.");
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(null);
        }
    };

    const replyHref = (m) =>
        `mailto:${m.email}?subject=${encodeURIComponent("Re: " + (m.subject || "Your enquiry"))}`;

    return (
        <div data-testid="admin-messages-page">
            <div className="overline">Inbox</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">
                Messages ({msgs.length})
            </h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Enquiries submitted through the Contact form. You also get an email alert for each
                (reply-to is the sender), so you can respond straight from your inbox.
            </p>

            {loading && <p className="mt-8 font-mono text-xs text-[#4B5563]">Loading…</p>}
            {!loading && msgs.length === 0 && (
                <div className="mt-8 border border-dashed border-[#E5E7EB] p-12 text-center text-[#4B5563]">
                    No messages yet.
                </div>
            )}

            <div className="mt-8 space-y-4 max-w-4xl">
                {msgs.map((m) => (
                    <div
                        key={m.id}
                        data-testid={`admin-message-${m.id}`}
                        className="border border-[#E5E7EB] bg-white p-6"
                    >
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div>
                                <div className="font-serif text-lg text-[#002B5C]">
                                    {m.subject || "General Inquiry"}
                                </div>
                                <div className="text-sm text-[#4B5563] mt-1">
                                    <span className="text-[#002B5C] font-medium">{m.name}</span>{" "}
                                    · <a href={`mailto:${m.email}`} className="hover:text-[#CC0033]">{m.email}</a>
                                </div>
                            </div>
                            <div className="font-mono text-xs text-[#4B5563] whitespace-nowrap">
                                {m.created_at ? new Date(m.created_at).toLocaleString("en-IN") : ""}
                            </div>
                        </div>
                        <p className="mt-4 text-sm text-[#002B5C] leading-relaxed whitespace-pre-line border-t border-[#E5E7EB] pt-4">
                            {m.message}
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                            <a
                                href={replyHref(m)}
                                data-testid={`message-reply-${m.id}`}
                                className="inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-3 py-1.5 text-xs font-medium hover:bg-[#F5F7FA]"
                            >
                                <CornerUpLeft size={12} strokeWidth={1.5} /> Reply
                            </a>
                            <button
                                onClick={() => onDelete(m.id)}
                                disabled={busy === m.id}
                                data-testid={`message-delete-${m.id}`}
                                className="inline-flex items-center gap-1.5 border border-[#E5E7EB] text-[#CC0033] px-3 py-1.5 text-xs font-medium hover:border-[#CC0033] disabled:opacity-50"
                            >
                                <Trash2 size={12} strokeWidth={1.5} /> {busy === m.id ? "…" : "Delete"}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
