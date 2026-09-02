import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2, Plus, Download, Bold, List, Heading, Minus as Rule } from "lucide-react";
import { fetchCollection, adminSaveCollection, adminListJobApplications,
         adminDeleteJobApplication, formatApiError, mediaUrl } from "../../lib/api";
import { canDelete } from "../../lib/rbac";
import { useAuth } from "../../context/AuthContext";
import RichText from "../../components/RichText";

const slug = (s) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `job-${Date.now()}`;

/**
 * Formatting toolbar for a job description.
 *
 * The field was a two-row box with no hint that formatting existed, so a full
 * job spec was pasted in as Markdown and the site printed it literally — a wall
 * of "## Key Responsibilities * Identify and connect…". The site now renders
 * that syntax properly, but nothing here told anyone the syntax was available,
 * or let them check the result before it went live.
 *
 * Wraps or prefixes the current selection, then restores focus and puts the
 * caret back where the writer expects it — a toolbar that loses your place is
 * more annoying than typing the characters by hand.
 */
function FormatBar({ textareaRef, value, onChange }) {
    const apply = (kind) => {
        const el = textareaRef.current;
        if (!el) return;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const sel = value.slice(start, end);
        let insert;
        let caret;

        if (kind === "bold") {
            insert = `**${sel || "bold text"}**`;
            caret = start + (sel ? insert.length : 2 + "bold text".length);
        } else if (kind === "heading") {
            const lineStart = value.lastIndexOf("\n", start - 1) + 1;
            const next = value.slice(0, lineStart) + "## " + value.slice(lineStart);
            onChange(next);
            requestAnimationFrame(() => {
                el.focus();
                el.setSelectionRange(start + 3, end + 3);
            });
            return;
        } else if (kind === "list") {
            const lines = (sel || "First item\nSecond item").split("\n");
            insert = lines.map((l) => (l.trim() ? `- ${l.replace(/^\s*[-*]\s*/, "")}` : l)).join("\n");
            caret = start + insert.length;
        } else {
            insert = `${start > 0 && value[start - 1] !== "\n" ? "\n" : ""}---\n`;
            caret = start + insert.length;
        }

        onChange(value.slice(0, start) + insert + value.slice(end));
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(caret, caret);
        });
    };

    const btn = "inline-flex items-center gap-1 border border-[#E5E7EB] px-2 py-1 text-[11px] text-[#002B5C] hover:bg-[#F5F7FA]";
    return (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <button type="button" onClick={() => apply("heading")} className={btn} title="Section heading (##)">
                <Heading size={12} strokeWidth={1.75} /> Heading
            </button>
            <button type="button" onClick={() => apply("bold")} className={btn} title="Bold (**text**)">
                <Bold size={12} strokeWidth={1.75} /> Bold
            </button>
            <button type="button" onClick={() => apply("list")} className={btn} title="Bullet list (- item)">
                <List size={12} strokeWidth={1.75} /> Bullets
            </button>
            <button type="button" onClick={() => apply("rule")} className={btn} title="Divider (---)">
                <Rule size={12} strokeWidth={1.75} /> Divider
            </button>
            <span className="text-[10px] text-[#4B5563] ml-1">
                Blank line = new paragraph
            </span>
        </div>
    );
}

/**
 * Description editor: toolbar, a box big enough for a real job spec, and a
 * preview that uses the SAME component the careers page renders with — so
 * "looks right here" and "looks right live" cannot diverge.
 */
function JobDescription({ value, onChange }) {
    const ref = React.useRef(null);
    const [preview, setPreview] = React.useState(false);
    const box = "border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#002B5C]";

    return (
        <div className="mt-3">
            <div className="flex items-center justify-between gap-3">
                <label className="text-[11px] font-medium text-[#002B5C]">Description</label>
                <button
                    type="button"
                    onClick={() => setPreview((p) => !p)}
                    data-testid="job-description-preview-toggle"
                    className="text-[11px] border-b border-[#002B5C] text-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033]"
                >
                    {preview ? "Back to editing" : "Preview"}
                </button>
            </div>

            {preview ? (
                <div className="mt-2 border border-[#E5E7EB] bg-white p-4 min-h-[9rem]">
                    {value.trim() ? (
                        <RichText text={value} />
                    ) : (
                        <p className="text-sm text-[#4B5563] italic">Nothing to preview yet.</p>
                    )}
                </div>
            ) : (
                <>
                    <textarea
                        ref={ref}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={"## Job Summary\nWhat the role is, in a sentence or two.\n\n## Key Responsibilities\n- First responsibility\n- Second responsibility"}
                        rows={10}
                        className={`${box} w-full mt-2 resize-y font-mono text-[13px] leading-relaxed`}
                    />
                    <FormatBar textareaRef={ref} value={value} onChange={onChange} />
                </>
            )}
        </div>
    );
}

export default function AdminCareers() {
    const [jobs, setJobs] = useState(null);
    const [apps, setApps] = useState([]);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState("");
    // Deletion is superadmin-only across this admin; the endpoint enforces it too.
    const { user: me } = useAuth();
    const mayDelete = canDelete(me);

    useEffect(() => {
        fetchCollection("careers_jobs").then((d) => setJobs(d?.items || [])).catch(() => setJobs([]));
        adminListJobApplications().then(setApps).catch(() => {});
    }, []);

    if (!jobs) return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;

    /*
     * Deleting an application deletes the CV from the object store too, and
     * there is no undo -- so the confirmation names the person and says what
     * else goes. A dialog that only says "are you sure?" is one someone clicks
     * through; one that says whose CV is about to be destroyed is not.
     */
    const removeApp = async (a) => {
        if (!window.confirm(
            `Delete ${a.name}'s application?\n\n` +
            `This also permanently deletes their CV file. It cannot be undone.`
        )) return;
        setBusyId(a.id);
        try {
            await adminDeleteJobApplication(a.id);
            setApps((cur) => cur.filter((x) => x.id !== a.id));
            toast.success("Application and CV deleted.");
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setBusyId("");
        }
    };

    const upd = (i, k, v) => setJobs((cur) => cur.map((j, idx) => (idx === i ? { ...j, [k]: v } : j)));
    const add = () => setJobs((cur) => [...cur, { id: `job-${Date.now()}`, title: "", location: "", type: "Full-time", department: "", description: "", enabled: true }]);
    const remove = (i) => setJobs((cur) => cur.filter((_, idx) => idx !== i));

    const save = async () => {
        setSaving(true);
        try {
            const clean = jobs
                .map((j) => ({ ...j, id: j.id || slug(j.title), title: (j.title || "").trim() }))
                .filter((j) => j.title);
            await adminSaveCollection("careers_jobs", clean);
            toast.success("Job listings saved — live on /careers.");
        } catch {
            toast.error("Could not save jobs.");
        } finally {
            setSaving(false);
        }
    };

    const box = "border border-[#E5E7EB] px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]";

    return (
        <div data-testid="admin-careers-page">
            <div className="overline">Page editor</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Careers</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Manage open roles shown on the Careers page, and review applications (with CVs)
                submitted through the site.
            </p>

            {/* Jobs */}
            <section className="mt-8 max-w-3xl">
                <div className="flex items-center justify-between">
                    <h2 className="font-serif text-xl text-[#002B5C]">Open roles</h2>
                    <button onClick={add} className="inline-flex items-center gap-1.5 text-sm text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]">
                        <Plus size={14} strokeWidth={1.5} /> Add role
                    </button>
                </div>
                <div className="mt-4 space-y-3">
                    {jobs.map((j, i) => (
                        <div key={j.id || i} className={`border border-[#E5E7EB] p-3 ${j.enabled === false ? "opacity-60 bg-[#F5F7FA]" : "bg-white"}`}>
                            <div className="flex items-center gap-2">
                                <input value={j.title ?? ""} onChange={(e) => upd(i, "title", e.target.value)} placeholder="Role title" className={`${box} flex-1 font-medium`} />
                                <button onClick={() => upd(i, "enabled", j.enabled === false)} aria-label="Toggle visibility" className="p-1.5 text-[#4B5563] hover:text-[#002B5C]">
                                    {j.enabled === false ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
                                </button>
                                <button onClick={() => remove(i)} aria-label="Remove" className="p-1.5 text-[#4B5563] hover:text-[#CC0033]">
                                    <Trash2 size={15} strokeWidth={1.5} />
                                </button>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2">
                                <input value={j.department ?? ""} onChange={(e) => upd(i, "department", e.target.value)} placeholder="Department" className={box} />
                                <input value={j.location ?? ""} onChange={(e) => upd(i, "location", e.target.value)} placeholder="Location" className={box} />
                                <input value={j.type ?? ""} onChange={(e) => upd(i, "type", e.target.value)} placeholder="Type (e.g. Full-time)" className={box} />
                            </div>
                            <JobDescription
                                value={j.description ?? ""}
                                onChange={(v) => upd(i, "description", v)}
                            />
                        </div>
                    ))}
                    {jobs.length === 0 && <p className="text-sm text-[#4B5563]">No roles yet — add one.</p>}
                </div>
                <button onClick={save} disabled={saving} className="mt-4 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60">
                    {saving ? "Saving…" : "Save roles"}
                </button>
            </section>

            {/* Applications */}
            <section className="mt-12 max-w-4xl">
                <h2 className="font-serif text-xl text-[#002B5C]">Applications ({apps.length})</h2>
                {apps.length === 0 ? (
                    <p className="text-sm text-[#4B5563] mt-3 border border-dashed border-[#E5E7EB] p-6">No applications yet.</p>
                ) : (
                    <div className="mt-4 border border-[#E5E7EB]">
                        {apps.map((a) => (
                            <div key={a.id} className="flex items-center gap-4 px-4 py-3 border-b border-[#E5E7EB] last:border-b-0 text-sm">
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-[#002B5C] truncate">{a.name} <span className="text-[#4B5563] font-normal">· {a.role}</span></div>
                                    <div className="text-xs text-[#4B5563] truncate">{a.email} · {a.phone}</div>
                                </div>
                                <a href={mediaUrl(a.cv_url) || a.cv_url} target="_blank" rel="noreferrer" className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]">
                                    <Download size={13} strokeWidth={1.5} /> CV
                                </a>
                                {mayDelete && (
                                    <button
                                        type="button"
                                        onClick={() => removeApp(a)}
                                        disabled={busyId === a.id}
                                        data-testid={`delete-application-${a.id}`}
                                        title="Delete this application and its CV file"
                                        className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[#CC0033] border-b border-[#CC0033] pb-0.5 hover:text-[#002B5C] hover:border-[#002B5C] disabled:opacity-40"
                                    >
                                        <Trash2 size={13} strokeWidth={1.5} />
                                        {busyId === a.id ? "Deleting…" : "Delete"}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
