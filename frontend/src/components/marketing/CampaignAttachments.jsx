import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, FileSpreadsheet, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { mkAddAttachment, mkRemoveAttachment, formatApiError } from "../../lib/api";

/**
 * Admin → Marketing → email campaign → Attachments (backend/marketing_attachments.py).
 *
 * Real files on every email of the campaign. The server decides what is
 * accepted by the file's CONTENT (marketing_attach_core.classify) — the
 * checks here only save a pointless upload. Zip and video are refused on
 * purpose (mailboxes block them in bulk mail): the message says to share a
 * Drive / YouTube link in a Button block instead.
 */
const MAX_TOTAL = 10 * 1024 * 1024;
const MAX_FILES = 10;
const ACCEPT = ".pdf,.xlsx,.xls,.docx,.doc,.csv,.jpg,.jpeg,.png,.gif,.webp";
const OK_EXT = /\.(pdf|xlsx|xls|docx|doc|csv|jpe?g|png|gif|webp)$/i;
const LINK_INSTEAD = /\.(zip|rar|7z|mp4|mov|m4v|avi|mkv|webm|wmv)$/i;
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const icon = (ext) => (["xlsx", "xls", "csv"].includes(ext) ? FileSpreadsheet : ["jpg", "png", "gif", "webp"].includes(ext) ? ImageIcon : FileText);

export default function CampaignAttachments({ c, onChange }) {
    const [busy, setBusy] = useState("");
    const [over, setOver] = useState(false);
    const pick = useRef(null);
    const atts = c.attachments || [];
    const used = atts.reduce((n, a) => n + (a.size || 0), 0);
    const editable = ["draft", "scheduled"].includes(c.status);

    const add = async (files) => {
        for (const file of Array.from(files || [])) {
            if (LINK_INSTEAD.test(file.name)) { toast.error(`${file.name}: zip and video files are blocked by mailboxes — share a Google Drive / YouTube link in a Button block instead.`); continue; }
            if (!OK_EXT.test(file.name)) { toast.error(`${file.name}: attach PDF, Excel, Word, CSV or an image.`); continue; }
            setBusy(file.name);
            try { onChange(await mkAddAttachment(c.id, file)); toast.success(`Attached ${file.name}`); }
            catch (e) { toast.error(`${file.name}: ${formatApiError(e)}`); }
            finally { setBusy(""); }
        }
    };
    const remove = async (a) => {
        setBusy(a.id);
        try { onChange(await mkRemoveAttachment(c.id, a.id)); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
    };

    return (
        <div className="space-y-3 text-sm" data-testid="mk-attachments">
            {atts.length > 0 && (
                <ul className="divide-y divide-[#F3F4F6] border border-[#E5E7EB]">
                    {atts.map((a) => {
                        const I = icon(a.ext);
                        return (
                            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                                <I size={16} className="text-[#002B5C] shrink-0" aria-hidden />
                                <span className="flex-1 min-w-0 truncate" title={a.name}>{a.name}</span>
                                <span className="text-xs text-[#6B7280] font-mono">{size(a.size || 0)}</span>
                                {editable && (
                                    <button type="button" aria-label={`Remove ${a.name}`} disabled={!!busy} onClick={() => remove(a)}
                                        className="p-1 text-[#6B7280] hover:text-[#CC0033] disabled:opacity-50"><X size={14} /></button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {editable ? (
                <div role="button" tabIndex={0}
                    onClick={() => pick.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                    onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
                    className={`border border-dashed px-4 py-5 text-center text-xs cursor-pointer ${over ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#D1D5DB]"} ${atts.length >= MAX_FILES ? "opacity-50 pointer-events-none" : ""}`}
                    data-testid="mk-attach-drop">
                    <Paperclip size={16} className="mx-auto mb-1 text-[#002B5C]" aria-hidden />
                    {busy && !atts.some((a) => a.id === busy) ? `Uploading ${busy}…` : "Drag & drop files here, or click to choose — PDF, Excel, Word, CSV, images"}
                    <input ref={pick} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
                </div>
            ) : (
                <p className="text-xs text-[#6B7280]">Attachments are locked once the campaign starts sending.</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6B7280]">
                <span className={used > MAX_TOTAL * 0.8 ? "text-[#B45309]" : ""}>{size(used)} of 10 MB · {atts.length}/{MAX_FILES} files</span>
                <span>Every email carries these files — larger emails are more likely to land in spam, so keep them small. For videos, zips or big files use a Google Drive / YouTube link in a Button block.</span>
            </div>
        </div>
    );
}
