import React from "react";
import { X, Mail, MailX } from "lucide-react";

/**
 * Confirms a status change before it reaches the customer.
 *
 * WHY THIS EXISTS
 *
 * Changing the dropdown wrote the status AND emailed the customer immediately,
 * with nothing in between. A mis-click told someone their order had shipped,
 * and there was no way to correct it except to tell them again. Nothing on the
 * screen even said an email had gone.
 *
 * So the change now waits for a confirmation, and the person making it can see
 * what the customer is about to be told, choose not to tell them, and add the
 * one thing a dispatch email actually needs.
 *
 * WHY THE NOTE MATTERS
 *
 * "Your books are on their way" without a tracking number is a sentence, not
 * information. The note is appended to the email, so shipped can carry a
 * consignment number, delayed can carry a reason, and cancelled can carry an
 * explanation — which the cancellation path already did and the other four
 * never could.
 *
 * Notifying stays ON by default. Every status change has emailed the customer
 * since launch; making silence the default would quietly stop messages people
 * are used to receiving.
 */

// Offered as suggestions, not a fixed list — a courier we have never used is
// still a courier. Order matches how often Indian trade publishing uses them.
const COURIERS = ["Bluedart", "Delhivery", "DTDC", "India Post", "Xpressbees", "Ekart", "Shiprocket"];

const COPY = {
    confirmed: {
        title: "Order confirmed",
        line: "Your order is confirmed and will be prepared for dispatch shortly.",
        hint: "",
    },
    processing: {
        title: "Your order is being prepared",
        line: "We're packing your books — they'll be on their way soon.",
        hint: "",
    },
    shipped: {
        title: "Your order has shipped",
        line: "Your books are on their way. You'll receive them shortly.",
        hint: "Tracking number and courier — e.g. Bluedart 1234567890",
    },
    delivered: {
        title: "Delivered",
        line: "Your order has been delivered. We hope you enjoy your reading.",
        hint: "",
    },
    // Cancellation is the one status with its own template rather than the
    // shared one, so this copy is taken from render_order_cancelled_html —
    // including that it labels the note "Reason:" and adds a refund paragraph.
    cancelled: {
        title: "Your order has been cancelled",
        line: "your order has been cancelled.",
        after:
            "If you were charged, any eligible refund is processed to your original payment method, typically within 5–7 business days.",
        notePrefix: "Reason: ",
        hint: "Why it was cancelled — the customer will see this",
    },
};

export default function StatusChangeDialog({ order, nextStatus, busy, onConfirm, onCancel }) {
    const [notify, setNotify] = React.useState(true);
    const [note, setNote] = React.useState("");
    // Dispatch details are their own fields, not free text in the note: they
    // belong in the orders list, need correcting later without re-typing the
    // whole message, and become a tracking link in the email.
    const [courier, setCourier] = React.useState(order.courier || "");
    const [trackingId, setTrackingId] = React.useState(order.tracking_id || "");
    const shipping = nextStatus === "shipped";
    const confirmRef = React.useRef(null);

    // Focus moves into the dialog on open.
    //
    // Without it focus stayed on the <select> behind the backdrop, and an
    // arrow key there fired another change — swapping the dialog to a new
    // status while the note typed for the old one, and an un-ticked "email the
    // customer", survived into it. The caller keys this component per change
    // so the state cannot leak either way; this stops the input reaching the
    // select at all, and makes the dialog reachable by keyboard, which it was
    // not: it renders before the table, so Tab skipped straight past it.
    React.useEffect(() => {
        confirmRef.current?.focus();
    }, []);
    const copy = COPY[nextStatus] || { title: "Order update", line: "", hint: "" };

    // Escape closes, which is what anyone expects of a dialog they opened by
    // accident — and opening this by accident is the whole reason it exists.
    React.useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape" && !busy) onCancel();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, onCancel]);  // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#002B5C]/40 px-4"
            onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`Change status to ${nextStatus}`}
                data-testid="status-change-dialog"
                className="w-full max-w-lg bg-white border border-[#E5E7EB] shadow-lg"
            >
                <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#E5E7EB]">
                    <div>
                        <div className="overline !text-[10px]">
                            {order.status} &rarr; {nextStatus}
                        </div>
                        <h2 className="font-serif text-2xl mt-1.5 text-[#002B5C]">
                            {order.order_number}
                        </h2>
                        <div className="text-xs text-[#4B5563] mt-1">
                            {order.full_name} · {order.email}
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
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={notify}
                            onChange={(e) => setNotify(e.target.checked)}
                            data-testid="status-notify-toggle"
                            className="mt-1 accent-[#002B5C]"
                        />
                        <span>
                            <span className="text-sm font-medium text-[#002B5C]">
                                Email the customer
                            </span>
                            <span className="block text-xs text-[#4B5563] mt-0.5">
                                {notify
                                    ? `${order.email} will be told this order is ${nextStatus}.`
                                    : "The status changes quietly. Nobody is told."}
                            </span>
                        </span>
                    </label>

                    {notify && (
                        <>
                            {/* Exactly what they will read, so nobody has to guess. */}
                            <div className="mt-4 border border-[#E5E7EB] bg-[#F5F7FA] px-4 py-3">
                                <div className="font-serif text-base text-[#002B5C]">
                                    {copy.title}
                                </div>
                                <p className="text-[13px] leading-relaxed text-[#4B5563] mt-1">
                                    Hi {(order.full_name || "there").split(" ")[0]}, {copy.line}
                                </p>
                                {note.trim() && (
                                    <div className="mt-2 border-l-2 border-[#F59E0B] pl-3 text-[13px] text-[#002B5C] whitespace-pre-line">
                                        {copy.notePrefix || ""}
                                        {note}
                                    </div>
                                )}
                                {copy.after && (
                                    <p className="text-[13px] leading-relaxed text-[#4B5563] mt-2">
                                        {copy.after}
                                    </p>
                                )}
                            </div>

                            {shipping && (
                                <div className="mt-4 grid grid-cols-2 gap-3">
                                    <label className="block">
                                        <span className="overline !text-[10px]">Courier</span>
                                        <input
                                            value={courier}
                                            onChange={(e) => setCourier(e.target.value)}
                                            list="oak-couriers"
                                            placeholder="Bluedart"
                                            data-testid="tracking-courier"
                                            className="mt-2 w-full border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                        />
                                        <datalist id="oak-couriers">
                                            {COURIERS.map((c) => (
                                                <option key={c} value={c} />
                                            ))}
                                        </datalist>
                                    </label>
                                    <label className="block">
                                        <span className="overline !text-[10px]">Tracking number</span>
                                        <input
                                            value={trackingId}
                                            onChange={(e) => setTrackingId(e.target.value)}
                                            placeholder="1234567890"
                                            data-testid="tracking-id"
                                            className="mt-2 w-full border border-[#E5E7EB] px-3 py-2 text-sm font-mono outline-none focus:border-[#002B5C]"
                                        />
                                    </label>
                                </div>
                            )}

                            {shipping && trackingId.trim() && (
                                <p className="mt-3 text-xs text-[#4B5563] leading-relaxed">
                                    The email will lead with this number rather than the usual
                                    &ldquo;on its way&rdquo; note{courier.trim() ? `, and name ${courier.trim()} as the courier` : ""}.
                                </p>
                            )}

                            <label className="block mt-4">
                                <span className="overline !text-[10px]">
                                    Add to the email {copy.hint ? "" : "(optional)"}
                                </span>
                                <textarea
                                    rows={2}
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder={copy.hint || "Anything the customer should know"}
                                    data-testid="status-note"
                                    className="mt-2 w-full border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                />
                            </label>
                        </>
                    )}
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
                        onClick={() =>
                            onConfirm({
                                notify,
                                note: note.trim(),
                                ...(shipping
                                    ? { courier: courier.trim(), tracking_id: trackingId.trim() }
                                    : {}),
                            })
                        }
                        disabled={busy}
                        ref={confirmRef}
                        data-testid="status-confirm"
                        className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                    >
                        {notify ? <Mail size={14} strokeWidth={1.75} /> : <MailX size={14} strokeWidth={1.75} />}
                        {busy
                            ? "Saving…"
                            : notify
                              ? `Update & email`
                              : `Update quietly`}
                    </button>
                </div>
            </div>
        </div>
    );
}
