import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Trash2, Plus, Download } from "lucide-react";
import { fetchCollection, adminSaveCollection, adminListJobApplications, mediaUrl } from "../../lib/api";

const slug = (s) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `job-${Date.now()}`;

export default function AdminCareers() {
    const [jobs, setJobs] = useState(null);
    const [apps, setApps] = useState([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchCollection("careers_jobs").then((d) => setJobs(d?.items || [])).catch(() => setJobs([]));
        adminListJobApplications().then(setApps).catch(() => {});
    }, []);

    if (!jobs) return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;

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
                            <textarea value={j.description ?? ""} onChange={(e) => upd(i, "description", e.target.value)} placeholder="Short description" rows={2} className={`${box} w-full mt-2 resize-y`} />
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
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
