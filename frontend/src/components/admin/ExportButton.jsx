import React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { api, downloadBlob } from "../../lib/api";

/**
 * Download an admin CSV.
 *
 * WHY NOT JUST AN <a href>
 *
 * These endpoints sit behind the admin bearer token, which cannot be attached
 * to a plain link. So the file is fetched with the header, turned into a blob
 * and handed to a synthetic anchor.
 *
 * WHY THE SHARED `api` CLIENT AND NOT `fetch`
 *
 * This component used to call fetch() and build the Authorization header
 * itself, reading localStorage.getItem("token") -- but the app stores the token
 * under "oakbridge_token". It therefore sent `Bearer null` and every export on
 * every screen returned 401. Nothing looked broken until someone pressed one.
 *
 * The axios instance already carries the token, via one interceptor that knows
 * the key. Going through it means there is exactly one place in the codebase
 * that knows how auth works, and this cannot happen again.
 *
 * WHY NOT BUILD THE CSV IN THE BROWSER
 *
 * A page shows what it has loaded — filtered, paginated, sorted. An export
 * built from that is an export of the current view, which is not what anyone
 * means by "download the orders". The server sends the whole collection, and
 * the escaping rules live in one place rather than being re-derived per page.
 */
export default function ExportButton({ path, label = "Export CSV", count, className = "" }) {
    const [busy, setBusy] = React.useState(false);

    const download = async () => {
        setBusy(true);
        try {
            const res = await api.get(path, { responseType: "blob" });
            downloadBlob(res, "oakbridge-export.csv");
        } catch (e) {
            toast.error(
                e?.response?.status === 401
                    ? "Your session has expired. Sign in again and retry."
                    : "Could not download the export.",
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            onClick={download}
            disabled={busy}
            data-testid={`export-${path.replace(/\W+/g, "-")}`}
            className={`inline-flex items-center gap-2 border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm font-medium hover:bg-[#F5F7FA] transition-colors disabled:opacity-50 ${className}`}
        >
            <Download size={14} strokeWidth={1.5} />
            {busy ? "Preparing…" : count === undefined ? label : `${label} (${count})`}
        </button>
    );
}
