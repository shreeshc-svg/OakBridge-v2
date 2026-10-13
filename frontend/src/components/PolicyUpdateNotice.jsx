import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { authPolicyConsent, formatApiError } from "../lib/api";

/**
 * One-time notice for signed-in customers whose last agreement predates the
 * current Privacy Notice (accounts made before consent was recorded at sign-up,
 * or before an update). The server decides (user.policy_update_due) and records
 * the tick (POST /auth/policy-consent) with the policy version, so it is never
 * shown again for that version.
 *
 * Not a wall: "Later" hides it for this visit, and nothing on the site is
 * blocked — checkout asks for its own consent on every order anyway.
 */
export default function PolicyUpdateNotice() {
    const { user, refresh } = useAuth();
    const [agreed, setAgreed] = useState(false);
    const [later, setLater] = useState(false);
    const [busy, setBusy] = useState(false);

    if (!user || !user.policy_update_due || later) return null;

    const save = async () => {
        if (!agreed) return;
        setBusy(true);
        try {
            await authPolicyConsent();
            toast.success("Thank you — saved.");
            await refresh();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-labelledby="policy-update-title"
            data-testid="policy-update-notice"
            className="fixed z-[60] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md bg-white border border-[#002B5C] shadow-lg p-5"
        >
            <div id="policy-update-title" className="font-serif text-lg text-[#002B5C]">
                We've updated our Privacy Policy
            </div>
            <p className="text-xs text-[#4B5563] mt-2 leading-relaxed">
                It now explains in more detail what we collect, why, how long we keep it, and how to withdraw consent,
                in line with India's Digital Personal Data Protection Act. Please take a look and confirm.
            </p>
            <label className="mt-3 flex items-start gap-3 text-xs text-[#1F2937] cursor-pointer leading-relaxed">
                <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    data-testid="policy-update-agree"
                    className="mt-0.5 accent-[#002B5C] w-4 h-4 flex-shrink-0"
                />
                <span>
                    I have read the updated{" "}
                    <Link to="/privacy" target="_blank" rel="noopener" className="text-[#002B5C] underline">Privacy Policy</Link>{" "}
                    and{" "}
                    <Link to="/terms" target="_blank" rel="noopener" className="text-[#002B5C] underline">Terms</Link>, and I
                    consent to Oakbridge using my account details as they describe.
                </span>
            </label>
            <div className="mt-4 flex gap-2">
                <button
                    type="button"
                    onClick={save}
                    disabled={!agreed || busy}
                    data-testid="policy-update-save"
                    className="flex-1 bg-[#002B5C] text-white py-2.5 text-sm font-medium disabled:opacity-50"
                >
                    {busy ? "Saving…" : "Agree"}
                </button>
                <button
                    type="button"
                    onClick={() => setLater(true)}
                    className="px-4 py-2.5 text-sm border border-[#E5E7EB] text-[#4B5563]"
                >
                    Later
                </button>
            </div>
        </div>
    );
}
