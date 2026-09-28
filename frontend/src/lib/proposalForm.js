import { toast } from "sonner";
import { adminSendProposalForm, formatApiError } from "./api";

/**
 * "Send proposal form" for Admin → Messages and Admin → Submissions.
 *
 * The server refuses a second send with 409 and says when it went and who sent
 * it; only an explicit confirmation re-sends. Returns the server's
 * { proposal_sent_at, proposal_sent_by } on success, or null.
 */
export async function sendProposalForm(kind, id) {
    try {
        const r = await adminSendProposalForm(kind, id, false);
        toast.success("Proposal form sent.");
        return r;
    } catch (e) {
        if (e?.response?.status === 409) {
            if (!window.confirm(formatApiError(e))) return null;
            try {
                const r = await adminSendProposalForm(kind, id, true);
                toast.success("Proposal form sent again.");
                return r;
            } catch (e2) {
                toast.error(formatApiError(e2));
                return null;
            }
        }
        toast.error(formatApiError(e));
        return null;
    }
}

/** "Form sent · 28 Sep 2026 · auto" — shown on the row once it has gone. */
export function proposalSentLabel(rec) {
    if (!rec?.proposal_sent_at) return "";
    const d = new Date(rec.proposal_sent_at);
    const when = Number.isNaN(d.getTime()) ? rec.proposal_sent_at.slice(0, 10) : d.toLocaleDateString("en-IN");
    const by = rec.proposal_sent_by === "auto" ? "automatically" : rec.proposal_sent_by || "";
    return `Form sent · ${when}${by ? ` · ${by}` : ""}`;
}
