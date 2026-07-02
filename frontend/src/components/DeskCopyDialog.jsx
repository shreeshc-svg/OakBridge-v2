import React, { useState } from "react";
import { X } from "lucide-react";
import { requestDeskCopy, formatApiError } from "../lib/api";
import { toast } from "sonner";

const ROLES = [
    { v: "teacher", l: "Teacher (K-12)" },
    { v: "professor", l: "Professor / Lecturer" },
    { v: "librarian", l: "Librarian" },
    { v: "admin", l: "Administrator" },
];

export default function DeskCopyDialog({ book, open, onClose }) {
    const [form, setForm] = useState({
        name: "",
        email: "",
        institution: "",
        role: "teacher",
        course: "",
        enrolment: "",
        message: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    if (!open || !book) return null;

    const onChange = (e) =>
        setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

    const onSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await requestDeskCopy({
                book_id: book.id,
                ...form,
                enrolment: Number(form.enrolment || 0),
            });
            setDone(true);
            toast.success("Request received. Our team will be in touch.");
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const close = () => {
        setDone(false);
        setForm({
            name: "",
            email: "",
            institution: "",
            role: "teacher",
            course: "",
            enrolment: "",
            message: "",
        });
        onClose();
    };

    return (
        <div
            data-testid="desk-copy-dialog"
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
            onClick={close}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="bg-[#FFFFFF] border border-[#002B5C] w-full max-w-xl my-10"
            >
                <div className="flex items-start justify-between p-6 border-b border-[#E5E7EB]">
                    <div>
                        <div className="overline">Educator Programme</div>
                        <h2 className="font-serif text-3xl mt-1 text-[#002B5C] leading-tight">
                            Request a Desk Copy
                        </h2>
                        <p className="text-xs text-[#4B5563] mt-2 font-mono">
                            {book.title}
                        </p>
                    </div>
                    <button
                        onClick={close}
                        data-testid="desk-copy-close"
                        className="p-1 hover:bg-[#F5F7FA]"
                    >
                        <X size={18} strokeWidth={1.5} />
                    </button>
                </div>

                {done ? (
                    <div className="p-8 text-center">
                        <div className="overline">Thank you</div>
                        <h3 className="font-serif text-3xl mt-3 text-[#002B5C]">
                            Request received.
                        </h3>
                        <p className="text-sm text-[#4B5563] mt-3 max-w-sm mx-auto">
                            Our educator relations team will reach out within
                            two working days with next steps.
                        </p>
                        <button
                            onClick={close}
                            data-testid="desk-copy-done-close"
                            className="mt-8 bg-[#002B5C] text-[#FFFFFF] px-6 py-3 text-sm"
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="overline !text-[10px] block mb-2">
                                    Your Name
                                </label>
                                <input
                                    type="text"
                                    name="name"
                                    required
                                    value={form.name}
                                    onChange={onChange}
                                    data-testid="desk-copy-name"
                                    className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                />
                            </div>
                            <div>
                                <label className="overline !text-[10px] block mb-2">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    name="email"
                                    required
                                    value={form.email}
                                    onChange={onChange}
                                    data-testid="desk-copy-email"
                                    className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Institution
                            </label>
                            <input
                                type="text"
                                name="institution"
                                required
                                value={form.institution}
                                onChange={onChange}
                                data-testid="desk-copy-institution"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="overline !text-[10px] block mb-2">
                                    Your Role
                                </label>
                                <select
                                    name="role"
                                    value={form.role}
                                    onChange={onChange}
                                    data-testid="desk-copy-role"
                                    className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                >
                                    {ROLES.map((r) => (
                                        <option key={r.v} value={r.v}>
                                            {r.l}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="overline !text-[10px] block mb-2">
                                    Enrolment (optional)
                                </label>
                                <input
                                    type="number"
                                    name="enrolment"
                                    min={0}
                                    value={form.enrolment}
                                    onChange={onChange}
                                    data-testid="desk-copy-enrolment"
                                    className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Course Name (optional)
                            </label>
                            <input
                                type="text"
                                name="course"
                                value={form.course}
                                onChange={onChange}
                                data-testid="desk-copy-course"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                            />
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Message (optional)
                            </label>
                            <textarea
                                name="message"
                                rows={3}
                                value={form.message}
                                onChange={onChange}
                                data-testid="desk-copy-message"
                                className="w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C] resize-none"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={submitting}
                            data-testid="desk-copy-submit"
                            className="w-full bg-[#002B5C] text-[#FFFFFF] py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60"
                        >
                            {submitting ? "Submitting…" : "Request Desk Copy"}
                        </button>
                        <p className="text-xs text-[#4B5563] text-center">
                            Desk copies are provided free of charge to
                            educators actively evaluating titles for adoption.
                        </p>
                    </form>
                )}
            </div>
        </div>
    );
}
