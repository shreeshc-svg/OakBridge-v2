import React, { useState } from "react";
import { Mail, Send, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
// mediaUrl, not the raw path: covers come back as "/api/files/…", and on
// www.oakbridge.in Vercel rewrites that to the SPA shell, so a bare src renders
// HTML as an image — a broken thumbnail in the very dialog meant to prove the
// covers work.
import { adminSendPurchaseNudge, formatApiError, mediaUrl } from "../../lib/api";

/**
 * Preview-then-send for the first-order nudge.
 *
 * The dry run is not a formality. This is the only screen in Admin that mails
 * real customers, and it is unsendable: once the mail is out there is no
 * recall. So nothing goes anywhere until you have seen the actual recipient
 * list and pressed a second, differently-worded button.
 *
 * "Skipped" is shown with the reason rather than hidden, because a skip is
 * usually the interesting number — it is how you notice that everyone is being
 * excluded by a cooldown you forgot about.
 */
export default function PurchaseNudgeDialog({ onClose }) {
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [coupon, setCoupon] = useState("");
    const [testTo, setTestTo] = useState("");
    const [done, setDone] = useState(null);

    const run = async (body, label) => {
        setBusy(true);
        try {
            return await adminSendPurchaseNudge(body);
        } catch (err) {
            toast.error(`${label}: ${formatApiError(err)}`);
            return null;
        } finally {
            setBusy(false);
        }
    };

    const doPreview = async () => {
        const res = await run({ coupon_code: coupon }, "Preview failed");
        if (res) setPreview(res);
    };

    const doTest = async () => {
        if (!testTo.trim()) return toast.error("Enter an address to send the test to.");
        const res = await run({ coupon_code: coupon, test_to: testTo.trim() }, "Test failed");
        if (res) {
            res.sent
                ? toast.success(`Test sent to ${res.to} — check the covers render.`)
                : toast.error(`Could not send to ${res.to}.`);
        }
    };

    const doSend = async () => {
        const res = await run({ coupon_code: coupon, confirm: true }, "Send failed");
        if (res) {
            setDone(res);
            setPreview(null);
            toast.success(`Sent to ${res.sent} ${res.sent === 1 ? "person" : "people"}.`);
        }
    };

    const n = preview?.would_send ?? 0;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
            <div
                data-testid="nudge-dialog"
                className="bg-white border border-[#E5E7EB] w-full max-w-2xl my-8"
            >
                <div className="flex items-start justify-between gap-4 bg-[#002B5C] text-white px-6 py-4">
                    <div>
                        <div className="overline !text-[10px] !text-white/60">Product email</div>
                        <h2 className="font-serif text-xl mt-1">Nudge customers who haven't ordered</h2>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white">
                        <X size={18} strokeWidth={1.5} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {!done && (
                        <>
                            <p className="text-sm text-[#4B5563] leading-relaxed">
                                Goes to people who made an account but never ordered. Anyone with a
                                live cart is left out — the cart reminder already emails them — and
                                so is anyone who unsubscribed or was nudged in the last 30 days.
                            </p>

                            <div className="grid sm:grid-cols-2 gap-4">
                                <label className="block">
                                    <span className="overline !text-[10px]">Coupon code (optional)</span>
                                    <input
                                        value={coupon}
                                        onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                                        placeholder="e.g. FIRSTREAD10"
                                        data-testid="nudge-coupon"
                                        className="mt-1 w-full border border-[#E5E7EB] px-3 py-2 text-sm font-mono"
                                    />
                                </label>
                                <label className="block">
                                    <span className="overline !text-[10px]">Send one test to</span>
                                    <div className="mt-1 flex gap-2">
                                        <input
                                            value={testTo}
                                            onChange={(e) => setTestTo(e.target.value)}
                                            placeholder="you@oakbridge.in"
                                            data-testid="nudge-test-to"
                                            className="w-full border border-[#E5E7EB] px-3 py-2 text-sm"
                                        />
                                        <button
                                            onClick={doTest}
                                            disabled={busy}
                                            data-testid="nudge-test"
                                            className="shrink-0 border border-[#002B5C] text-[#002B5C] px-3 py-2 text-sm hover:bg-[#F5F7FA] disabled:opacity-50"
                                        >
                                            Test
                                        </button>
                                    </div>
                                </label>
                            </div>

                            {!preview && (
                                <button
                                    onClick={doPreview}
                                    disabled={busy}
                                    data-testid="nudge-preview"
                                    className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42] disabled:opacity-50"
                                >
                                    <Mail size={15} strokeWidth={1.5} />
                                    {busy ? "Checking…" : "Preview recipients"}
                                </button>
                            )}
                        </>
                    )}

                    {preview && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="border border-[#002B5C] p-4">
                                    <div className="overline !text-[10px]">Will email</div>
                                    <div
                                        data-testid="nudge-count-send"
                                        className="font-serif text-3xl text-[#002B5C] mt-1"
                                    >
                                        {n}
                                    </div>
                                </div>
                                <div className="border border-[#E5E7EB] p-4">
                                    <div className="overline !text-[10px]">Skipped</div>
                                    <div
                                        data-testid="nudge-count-skip"
                                        className="font-serif text-3xl text-[#4B5563] mt-1"
                                    >
                                        {preview.skipped}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <div className="overline !text-[10px] mb-2">Titles featured</div>
                                <div className="flex gap-3">
                                    {preview.books.map((b) => (
                                        <div key={b.title} className="text-xs text-[#4B5563] max-w-[9rem]">
                                            {b.cover_image ? (
                                                <img
                                                    src={mediaUrl(b.cover_image)}
                                                    alt={b.title}
                                                    className="w-14 border border-[#E5E7EB] mb-1"
                                                />
                                            ) : (
                                                <div className="w-14 h-20 bg-[#F5F7FA] border border-[#E5E7EB] mb-1" />
                                            )}
                                            {b.title}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {n > 0 && (
                                <div>
                                    <div className="overline !text-[10px] mb-2">Recipients</div>
                                    <ul
                                        data-testid="nudge-recipients"
                                        className="max-h-40 overflow-y-auto border border-[#E5E7EB] divide-y divide-[#E5E7EB] text-sm"
                                    >
                                        {preview.recipients.map((r) => (
                                            <li key={r.id} className="px-3 py-1.5 flex justify-between gap-3">
                                                <span className="text-[#002B5C]">{r.name || "—"}</span>
                                                <span className="text-[#4B5563] font-mono text-xs">{r.email}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {preview.skips.length > 0 && (
                                <details>
                                    <summary className="overline !text-[10px] cursor-pointer">
                                        Why {preview.skipped} were skipped
                                    </summary>
                                    <ul className="mt-2 max-h-40 overflow-y-auto border border-[#E5E7EB] divide-y divide-[#E5E7EB] text-xs">
                                        {preview.skips.map((r) => (
                                            <li key={r.id} className="px-3 py-1.5 flex justify-between gap-3">
                                                <span className="font-mono text-[#4B5563]">{r.email}</span>
                                                <span className="text-[#4B5563]">{r.why}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}

                            {n === 0 ? (
                                <p className="text-sm text-[#4B5563] flex items-start gap-2">
                                    <AlertTriangle size={15} className="text-[#F59E0B] shrink-0 mt-0.5" strokeWidth={1.5} />
                                    Nobody is eligible right now. Open the skip list above to see why.
                                </p>
                            ) : (
                                <div className="flex items-center gap-3 pt-1">
                                    <button
                                        onClick={doSend}
                                        disabled={busy}
                                        data-testid="nudge-send"
                                        className="inline-flex items-center gap-2 bg-[#CC0033] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#A80029] disabled:opacity-50"
                                    >
                                        <Send size={15} strokeWidth={1.5} />
                                        {busy ? "Sending…" : `Send to ${n} ${n === 1 ? "person" : "people"}`}
                                    </button>
                                    <button
                                        onClick={() => setPreview(null)}
                                        className="text-sm text-[#4B5563] hover:text-[#002B5C]"
                                    >
                                        Back
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {done && (
                        <div data-testid="nudge-done" className="space-y-3">
                            <p className="text-sm text-[#002B5C]">
                                Sent to <strong>{done.sent}</strong>{" "}
                                {done.sent === 1 ? "person" : "people"}. They will not be nudged again
                                for 30 days.
                            </p>
                            {done.failed?.length > 0 && (
                                <div className="border border-[#CC0033] p-3">
                                    <div className="overline !text-[10px] !text-[#CC0033]">
                                        {done.failed.length} could not be delivered
                                    </div>
                                    <ul className="mt-1 text-xs font-mono text-[#4B5563]">
                                        {done.failed.map((e) => (
                                            <li key={e}>{e}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <button
                                onClick={onClose}
                                className="bg-[#002B5C] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#001F42]"
                            >
                                Done
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
