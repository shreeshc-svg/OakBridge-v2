import React from "react";
import { X, Truck } from "lucide-react";

/**
 * Add or correct a consignment number after the order has already shipped.
 *
 * WHY THIS IS SEPARATE FROM THE STATUS DIALOG
 *
 * The two events rarely coincide. A parcel is marked shipped when it leaves the
 * desk; the courier hands over the number later, sometimes the next morning.
 * Making the number part of the status change meant either holding the status
 * back until the number existed, or never recording it at all — and a "shipped"
 * email with no tracking is the one that generates the support reply.
 *
 * Re-sending is allowed on purpose. A corrected number nobody is told about is
 * worse than a second email.
 */
const COURIERS = ["Bluedart", "Delhivery", "DTDC", "India Post", "Xpressbees", "Ekart", "Shiprocket"];

export default function TrackingDialog({ order, busy, onConfirm, onCancel }) {
    const [courier, setCourier] = React.useState(order.courier || "");
    const [trackingId, setTrackingId] = React.useState(order.tracking_id || "");
    const [note, setNote] = React.useState("");
    const [notify, setNotify] = React.useState(true);
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

    const already = Boolean(order.tracking_id);
    const valid = trackingId.trim().length > 0;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#002B5C]/40 px-4"
            onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Add tracking"
                data-testid="tracking-dialog"
                className="w-full max-w-lg bg-white border border-[#E5E7EB] shadow-lg"
            >
                <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#E5E7EB]">
                    <div>
                        <div className="overline !text-[10px]">
                            {already ? "Correct tracking" : "Add tracking"}
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
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="overline !text-[10px]">Courier</span>
                            <input
                                ref={firstRef}
                                value={courier}
                                onChange={(e) => setCourier(e.target.value)}
                                list="oak-couriers-standalone"
                                placeholder="Bluedart"
                                className="mt-2 w-full border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                            <datalist id="oak-couriers-standalone">
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
                                data-testid="tracking-dialog-id"
                                className="mt-2 w-full border border-[#E5E7EB] px-3 py-2 text-sm font-mono outline-none focus:border-[#002B5C]"
                            />
                        </label>
                    </div>

                    <label className="flex items-start gap-3 mt-5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={notify}
                            onChange={(e) => setNotify(e.target.checked)}
                            className="mt-1 accent-[#002B5C]"
                        />
                        <span>
                            <span className="text-sm font-medium text-[#002B5C]">
                                Email the customer
                            </span>
                            <span className="block text-xs text-[#4B5563] mt-0.5">
                                {notify
                                    ? `${order.email} gets the consignment number${courier.trim() ? ` and is told ${courier.trim()} has it` : ""}.`
                                    : "Recorded quietly. Nobody is told."}
                            </span>
                        </span>
                    </label>

                    {notify && (
                        <label className="block mt-4">
                            <span className="overline !text-[10px]">Add to the email (optional)</span>
                            <textarea
                                rows={2}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Expected by Friday, signature required, etc."
                                className="mt-2 w-full border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </label>
                    )}

                    {already && notify && (
                        <p className="mt-3 text-xs text-[#854F0B] bg-[#FAEEDA] px-3 py-2">
                            This order already had a tracking number. Saving sends a second email
                            with the new one.
                        </p>
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
                                courier: courier.trim(),
                                tracking_id: trackingId.trim(),
                                note: note.trim(),
                                notify,
                            })
                        }
                        disabled={busy || !valid}
                        data-testid="tracking-confirm"
                        className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                    >
                        <Truck size={14} strokeWidth={1.75} />
                        {busy ? "Saving…" : notify ? "Save & email" : "Save quietly"}
                    </button>
                </div>
            </div>
        </div>
    );
}
