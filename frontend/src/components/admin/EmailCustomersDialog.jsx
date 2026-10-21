import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { mkListFromUsers, formatApiError } from "../../lib/api";

/**
 * Admin → Users → "Email selected (N)" / "Email all customers".
 *
 * Makes a Marketing list of those people and a DRAFT campaign aimed at it,
 * then opens the campaign (subject, preview, test, Send all happen there, with
 * the usual checks). Nothing is sent from here.
 *
 * Consent is never overridden: the campaign only reaches people who agreed to
 * marketing. People who never decided can be sent ONE permission email
 * instead — the lawful route under the DPDP Act and our own Privacy Notice.
 */
export default function EmailCustomersDialog({ userIds, all, onClose }) {
    const nav = useNavigate();
    const [tmpl, setTmpl] = useState("for-you");
    const [ask, setAsk] = useState(true);
    const [busy, setBusy] = useState(false);
    const [res, setRes] = useState(null);

    const go = async () => {
        setBusy(true);
        try {
            setRes(await mkListFromUsers({ user_ids: all ? null : userIds, all_customers: !!all, template: tmpl, ask_permission: ask }));
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusy(false);
        }
    };
    const open = (id) => nav(`/admin/marketing?campaign=${encodeURIComponent(id)}`);
    const c = res?.counts;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="bg-white w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()} data-testid="email-customers-dialog">
                <div className="flex items-start justify-between gap-3">
                    <h2 className="font-serif text-2xl text-[#002B5C]">{all ? "Email all customers" : `Email ${userIds.length} selected`}</h2>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1 border border-[#E5E7EB]"><X size={16} /></button>
                </div>
                {!res ? (
                    <>
                        <p className="text-sm text-[#4B5563] mt-2">
                            {all ? "Everyone with a customer account and every guest who ordered" : "The ticked people"} go into a new
                            Marketing list, and a draft campaign is made for it. You review and send it in Marketing.
                        </p>
                        <div className="mt-4 space-y-2 text-sm">
                            <label className="flex gap-2 items-start cursor-pointer">
                                <input type="radio" name="tmpl" checked={tmpl === "for-you"} onChange={() => setTmpl("for-you")} className="mt-1" />
                                <span><b>Latest releases, picked for each person</b><span className="block text-xs text-[#6B7280]">New books matched to what each reader bought, carted or asked about — newest releases for everyone else.</span></span>
                            </label>
                            <label className="flex gap-2 items-start cursor-pointer">
                                <input type="radio" name="tmpl" checked={tmpl === "blank"} onChange={() => setTmpl("blank")} className="mt-1" />
                                <span><b>Write my own email</b><span className="block text-xs text-[#6B7280]">A blank campaign aimed at this list.</span></span>
                            </label>
                            <label className="flex gap-2 items-start cursor-pointer">
                                <input type="radio" name="tmpl" checked={tmpl === ""} onChange={() => setTmpl("")} className="mt-1" />
                                <span><b>Just make the list</b><span className="block text-xs text-[#6B7280]">Use it later in any campaign.</span></span>
                            </label>
                        </div>
                        <label className="mt-4 flex gap-2 items-start text-sm cursor-pointer border-t border-[#E5E7EB] pt-3">
                            <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} className="mt-1" />
                            <span>Also prepare a one-time <b>permission email</b> for those who never said yes or no to marketing
                                <span className="block text-xs text-[#6B7280]">Marketing email needs consent (DPDP Act, and our Privacy Notice). People who click “yes” join future campaigns; the rest are never mailed marketing.</span></span>
                        </label>
                        <div className="mt-5 flex justify-end gap-2">
                            <button type="button" onClick={onClose} className="border border-[#E5E7EB] px-4 py-2 text-sm">Cancel</button>
                            <button type="button" onClick={go} disabled={busy} data-testid="email-customers-go" className="bg-[#002B5C] text-white px-4 py-2 text-sm disabled:opacity-40">
                                {busy ? "Preparing…" : "Prepare"}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <ul className="mt-3 text-sm space-y-1" data-testid="email-customers-result">
                            <li><b>{c.added}</b> in the list “{res.list.name}”</li>
                            <li className="text-[#15803D]"><b>{c.subscribed}</b> agreed to marketing — the campaign reaches them</li>
                            <li><b>{c.no_decision}</b> never decided{c.asked_permission ? ` — ${c.asked_permission} get the permission email` : " — not mailed marketing"}</li>
                            {c.opted_out > 0 && <li className="text-[#6B7280]"><b>{c.opted_out}</b> unsubscribed or bounced — never mailed</li>}
                            {c.blocked > 0 && <li className="text-[#6B7280]"><b>{c.blocked}</b> erased at their request — not added</li>}
                        </ul>
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                            {res.campaigns.map((k) => (
                                <button key={k.id} type="button" onClick={() => open(k.id)} className="bg-[#002B5C] text-white px-4 py-2 text-sm">
                                    Open {k.kind === "reconfirm" ? "permission email" : "campaign"} →
                                </button>
                            ))}
                            <button type="button" onClick={onClose} className="border border-[#E5E7EB] px-4 py-2 text-sm">Done</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
