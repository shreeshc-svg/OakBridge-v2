import React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { API } from "../../lib/api";

/**
 * Download an admin CSV.
 *
 * WHY NOT JUST AN <a href>
 *
 * These endpoints sit behind the admin bearer token, which lives in
 * localStorage and cannot be attached to a plain link. So the file is fetched
 * with the header, turned into a blob and handed to a synthetic anchor.
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
            const res = await fetch(`${API}${path}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
            });
            if (!res.ok) throw new Error(`Export failed (${res.status})`);

            // Honour the filename the server chose — it carries the date, so
            // two downloads a week apart do not overwrite each other.
            const disp = res.headers.get("content-disposition") || "";
            const match = disp.match(/filename="?([^"]+)"?/);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = match ? match[1] : "oakbridge-export.csv";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(e.message || "Could not download the export.");
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
