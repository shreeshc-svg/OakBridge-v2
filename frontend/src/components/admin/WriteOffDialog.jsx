import React from "react";
import { X, BanknoteX, Undo2 } from "lucide-react";
import { formatINR } from "../../lib/api";

/**
 * Confirm writing a bounced order's amount off the dashboard — or putting it back.
 *
 * WHY A DIALOG AND NOT A BUTTON
 *
 * This is the only action in the admin panel that changes a revenue figure. It
 * does not delete anything and it is reversible, but the number a business is
 * run from moves the moment it is clicked, so it says the amount out loud and
 * asks for a reason before it does.
 *
 * WHY IT SPELLS OUT WHAT SURVIVES
 *
 * "Remove" reads like "delete", and the two most expensive misunderstandings
 * here would be an admin thinking the record is gone when it isn't, or avoiding
 * the button because they think it is. The list of what stays is the answer to
 * both, and it is the reason a write-off is safe to offer at all: an order is a
 * financial record, and its GST invoice number belongs to a sequential series
 * that cannot have holes in it.
 */
export default function WriteOffDialog({ order, busy, onConfirm, onCancel }) {
    const undoing = Boolean(order.written_off);
    const [note, setNote] = React.useState("");
    const firstRef = React.useRef(null);

    React.useEffect(() => {
        firstRef.current?.focus();
    }, []);

    React.useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape" && !busy) onCancel();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, onCancel]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#002B5C]/40 px-4"
            onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={undoing ? "Restore amount" : "Write off amount"}
                data-testid="write-off-dialog"
                className="w-full max-w-lg bg-white border border-[#E5E7EB] shadow-lg"
            >
                <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#E5E7EB]">
                    <div>
                        <div className="overline !text-[10px]">
                            {undoing ? "Put the amount back" : "Write off the amount"}
                        </div>
                        <h2 className="font-serif text-2xl mt-1.5 text-[#002B5C]">
                            {order.order_number}
                        </h2>
                        <div className="text-xs text-[#4B5563] mt-1">
                            {order.full_name}
                            {order.email ? ` · ${order.email}` : ""}
                        </div>
                    </div>
                    <button
                        onClick={onCancel}
                        disabled={busy}
                        aria-label="Close"
                        className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-50"
                    >
                        <X size={18} strokeWidth={1.5} />
                    </button>
                </div>

                <div className="px-6 py-5">
                    <div className="flex items-baseline justify-between border border-[#E5E7EB] bg-[#F5F7FA] px-4 py-3">
                        <span className="overline !text-[10px]">
                            {undoing ? "Returns to Not collected" : "Leaves Not collected"}
                        </span>
                        <span className="font-serif text-2xl text-[#002B5C]">
                            {formatINR(order.total)}
                        </span>
                    </div>

                    <p className="text-sm text-[#4B5563] mt-4 leading-relaxed">
                        {undoing ? (
                            <>
                                This amount goes back into the Not collected total and the order
                                starts being chased again.
                            </>
                        ) : (
                            <>
                                The dashboard stops counting this as money you are still waiting
                                for. <strong className="text-[#002B5C]">Nothing is deleted.</strong>{" "}
                                The order keeps its row here, its invoice number and its place in
                                the CSV export, the customer still sees it in their account, and
                                you can put the amount back at any time.
                            </>
                        )}
                    </p>

                    {!undoing && (
                        <p className="text-xs text-[#4B5563] mt-3 leading-relaxed">
                            If this customer does pay later, the write-off clears itself and the
                            money lands in revenue — so this is not a door that closes.
                        </p>
                    )}

                    <label className="block mt-5">
                        <span className="overline !text-[10px]">
                            Reason {undoing ? "(optional)" : "— for the audit log"}
                        </span>
                        <textarea
                            ref={firstRef}
                            rows={2}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            data-testid="write-off-note"
                            placeholder={
                                undoing
                                    ? "Customer got back in touch"
                                    : "Chased twice, no response since 12 Aug"
                            }
                            className="mt-2 w-full border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                        />
                    </label>

                    <p className="mt-3 text-xs text-[#4B5563]">
                        Recorded in Audit Logs against your account, and on this order's own
                        history. The customer is not emailed.
                    </p>
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E5E7EB] bg-[#F5F7FA]">
                    <button
                        onClick={onCancel}
                        disabled={busy}
                        className="px-4 py-2 text-sm text-[#4B5563] hover:text-[#002B5C] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm({ written_off: !undoing, note: note.trim() })}
                        disabled={busy}
                        data-testid="write-off-confirm"
                        className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                    >
                        {undoing ? (
                            <Undo2 size={14} strokeWidth={1.75} />
                        ) : (
                            <BanknoteX size={14} strokeWidth={1.75} />
                        )}
                        {busy
                            ? "Saving…"
                            : undoing
                              ? "Put it back"
                              : `Write off ${formatINR(order.total)}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
