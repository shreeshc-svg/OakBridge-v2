import React, { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { CheckCircle2, Briefcase, MapPin, Upload, FileText } from "lucide-react";
import { fetchJobs, applyForJob, formatApiError } from "../lib/api";
import { toast } from "sonner";

export default function Careers() {
    const [jobs, setJobs] = useState([]);
    const [form, setForm] = useState({ name: "", phone: "", email: "", role: "" });
    const [cv, setCv] = useState(null);
    const [done, setDone] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [dragCv, setDragCv] = useState(false);
    const fileRef = useRef(null);
    const formRef = useRef(null);

    useEffect(() => {
        fetchJobs().then((d) => setJobs((d?.items || []).filter((j) => j && j.enabled !== false))).catch(() => {});
    }, []);

    const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

    const pickCv = (file) => {
        if (!file) return;
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
            toast.error("Your CV must be a PDF file.");
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            toast.error("CV is too large (max 8 MB).");
            return;
        }
        setCv(file);
    };

    const applyTo = (title) => {
        setForm((f) => ({ ...f, role: title }));
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!cv) {
            toast.error("Please attach your CV (PDF).");
            return;
        }
        setSubmitting(true);
        try {
            await applyForJob({ ...form, cv });
            setDone(true);
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div data-testid="careers-page">
            <Breadcrumbs items={[{ label: "Careers" }]} />
            <Seo
                title="Careers"
                description="Join Oakbridge Publishing — open roles across editorial, sales and technology, plus how to apply."
                path="/careers"
            />

            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-14 border-b border-[#E5E7EB]">
                <div className="overline">Careers</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-3xl">
                    Build the house that publishes India.
                </h1>
                <p className="mt-6 max-w-2xl text-[#4B5563] leading-relaxed">
                    We hire editors, salespeople, designers and technologists who believe publishing
                    is a craft of public service. See our open roles, or send us a general
                    application — we're always glad to meet good people.
                </p>
            </section>

            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12">
                {/* Open roles */}
                <div className="lg:col-span-6">
                    <div className="overline">Open roles</div>
                    <h2 className="font-serif text-3xl mt-2 text-[#002B5C]">
                        {jobs.length ? `${jobs.length} position${jobs.length === 1 ? "" : "s"} open` : "No open roles right now"}
                    </h2>
                    <div className="mt-8 space-y-4">
                        {jobs.map((j) => (
                            <div
                                key={j.id || j.title}
                                data-testid={`job-${j.id || j.title}`}
                                className="border border-[#E5E7EB] p-5 hover:border-[#002B5C] transition-colors"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="font-serif text-xl text-[#002B5C]">{j.title}</h3>
                                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono uppercase tracking-widest text-[#4B5563]">
                                            {j.department && <span className="inline-flex items-center gap-1"><Briefcase size={12} strokeWidth={1.5} /> {j.department}</span>}
                                            {j.location && <span className="inline-flex items-center gap-1"><MapPin size={12} strokeWidth={1.5} /> {j.location}</span>}
                                            {j.type && <span>{j.type}</span>}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => applyTo(j.title)}
                                        className="flex-shrink-0 text-xs font-mono uppercase tracking-widest text-[#CC0033] border-b border-[#CC0033] pb-0.5 hover:text-[#002B5C] hover:border-[#002B5C]"
                                    >
                                        Apply →
                                    </button>
                                </div>
                                {j.description && (
                                    <p className="mt-3 text-sm text-[#4B5563] leading-relaxed">{j.description}</p>
                                )}
                            </div>
                        ))}
                        {jobs.length === 0 && (
                            <p className="text-sm text-[#4B5563] border border-dashed border-[#E5E7EB] p-6">
                                We don't have specific openings posted at the moment — but we still welcome
                                general applications. Use the form and tell us where you'd fit.
                            </p>
                        )}
                    </div>
                </div>

                {/* Application form */}
                <div className="lg:col-span-6" ref={formRef}>
                    {done ? (
                        <div data-testid="careers-done" className="border border-[#002B5C] p-8 text-center">
                            <CheckCircle2 size={40} strokeWidth={1.5} className="mx-auto text-[#002B5C]" />
                            <h2 className="font-serif text-2xl mt-4 text-[#002B5C]">Application received.</h2>
                            <p className="mt-3 text-sm text-[#4B5563]">
                                Thank you for your interest in Oakbridge. Our team will review your CV and
                                be in touch if there's a fit.
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={onSubmit} className="border border-[#E5E7EB] p-6 md:p-8">
                            <div className="overline">Apply now</div>
                            <h2 className="font-serif text-2xl mt-2 text-[#002B5C]">Send us your details.</h2>

                            <div className="mt-6 space-y-4">
                                <div>
                                    <label className="overline !text-[10px] block mb-1.5">Full name *</label>
                                    <input name="name" required value={form.name} onChange={onChange} className="w-full border border-[#E5E7EB] px-4 py-3 text-sm outline-none focus:border-[#002B5C]" />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="overline !text-[10px] block mb-1.5">Phone *</label>
                                        <input name="phone" required value={form.phone} onChange={onChange} className="w-full border border-[#E5E7EB] px-4 py-3 text-sm outline-none focus:border-[#002B5C]" />
                                    </div>
                                    <div>
                                        <label className="overline !text-[10px] block mb-1.5">Email *</label>
                                        <input name="email" type="email" required value={form.email} onChange={onChange} className="w-full border border-[#E5E7EB] px-4 py-3 text-sm outline-none focus:border-[#002B5C]" />
                                    </div>
                                </div>
                                <div>
                                    <label className="overline !text-[10px] block mb-1.5">Role</label>
                                    <select name="role" value={form.role} onChange={onChange} className="w-full border border-[#E5E7EB] px-4 py-3 text-sm outline-none focus:border-[#002B5C] bg-white">
                                        <option value="">General application</option>
                                        {jobs.map((j) => (
                                            <option key={j.id || j.title} value={j.title}>{j.title}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* CV upload (required) */}
                                <div>
                                    <label className="overline !text-[10px] block mb-1.5">CV / résumé (PDF) *</label>
                                    <div
                                        onClick={() => fileRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); setDragCv(true); }}
                                        onDragLeave={() => setDragCv(false)}
                                        onDrop={(e) => { e.preventDefault(); setDragCv(false); pickCv(e.dataTransfer.files?.[0]); }}
                                        className={`flex items-center gap-3 border ${dragCv ? "border-[#002B5C] border-dashed bg-[#F5F7FA]" : "border-[#E5E7EB]"} px-4 py-4 cursor-pointer`}
                                    >
                                        {cv ? <FileText size={18} strokeWidth={1.5} className="text-[#002B5C]" /> : <Upload size={18} strokeWidth={1.5} className="text-[#4B5563]" />}
                                        <span className="text-sm text-[#4B5563] truncate">
                                            {cv ? cv.name : "Click or drop your CV here — PDF, max 8 MB"}
                                        </span>
                                        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pickCv(e.target.files?.[0])} />
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={submitting}
                                data-testid="careers-submit"
                                className="mt-6 w-full bg-[#002B5C] text-white py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-60"
                            >
                                {submitting ? "Submitting…" : "Submit application"}
                            </button>
                            <p className="text-xs text-[#4B5563] mt-3">
                                By applying you consent to us storing your details for recruitment. We'll only
                                use them to consider your application.
                            </p>
                        </form>
                    )}
                </div>
            </section>
        </div>
    );
}
