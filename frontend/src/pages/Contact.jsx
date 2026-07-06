import React, { useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Mail, MapPin, Phone } from "lucide-react";
import { submitContact } from "../lib/api";
import { toast } from "sonner";

export default function Contact() {
    const [form, setForm] = useState({
        name: "",
        email: "",
        subject: "General Inquiry",
        message: "",
    });
    const [submitting, setSubmitting] = useState(false);

    const onChange = (e) =>
        setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

    const onSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await submitContact(form);
            toast.success(
                "Thank you — our team will respond within two working days.",
            );
            setForm({
                name: "",
                email: "",
                subject: "General Inquiry",
                message: "",
            });
        } catch (err) {
            toast.error("Could not send message. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div data-testid="contact-page">
            <Breadcrumbs items={[{ label: "Contact" }]} />
            <Seo
                title="Contact"
                description="Get in touch with Oakbridge Publishing about orders, manuscript submissions, rights, adoptions and partnerships."
                path="/contact"
            />
            <section className="px-6 md:px-12 lg:px-16 pt-20 pb-16 border-b border-[#E5E7EB]">
                <div className="overline">Get in Touch</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-6 text-[#002B5C] leading-[0.95] max-w-3xl">
                    We read every letter.
                </h1>
                <p className="mt-6 max-w-xl text-[#4B5563] leading-relaxed">
                    Questions about our books, bulk orders for your school,
                    press inquiries, or manuscripts — reach us through the
                    form below or at the addresses to the right.
                </p>
            </section>

            <section className="px-6 md:px-12 lg:px-16 py-20 grid grid-cols-1 lg:grid-cols-12 gap-12">
                <div className="lg:col-span-7">
                    <form
                        onSubmit={onSubmit}
                        className="space-y-6"
                        data-testid="contact-form"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="overline !text-[10px] block mb-2">
                                    Name
                                </label>
                                <input
                                    type="text"
                                    name="name"
                                    required
                                    value={form.name}
                                    onChange={onChange}
                                    data-testid="contact-name"
                                    className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
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
                                    data-testid="contact-email"
                                    className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Subject
                            </label>
                            <select
                                name="subject"
                                value={form.subject}
                                onChange={onChange}
                                data-testid="contact-subject"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C]"
                            >
                                <option>General Inquiry</option>
                                <option>School / Institutional Sales</option>
                                <option>Manuscript Submission</option>
                                <option>Press & Media</option>
                                <option>Support</option>
                            </select>
                        </div>
                        <div>
                            <label className="overline !text-[10px] block mb-2">
                                Message
                            </label>
                            <textarea
                                name="message"
                                required
                                rows={6}
                                value={form.message}
                                onChange={onChange}
                                data-testid="contact-message"
                                className="w-full border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none focus:border-[#002B5C] resize-none"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={submitting}
                            data-testid="contact-submit"
                            className="bg-[#002B5C] text-[#FFFFFF] px-8 py-4 text-sm font-medium hover:bg-[#001F42] transition-colors disabled:opacity-60"
                        >
                            {submitting ? "Sending…" : "Send Message"}
                        </button>
                    </form>
                </div>

                <aside className="lg:col-span-5 space-y-8">
                    <div className="border border-[#E5E7EB] p-8 bg-white">
                        <div className="overline">Head Office</div>
                        <div className="mt-4 flex gap-4">
                            <MapPin
                                size={18}
                                strokeWidth={1.5}
                                className="text-[#CC0033] mt-0.5"
                            />
                            <address className="not-italic text-sm text-[#002B5C] leading-relaxed">
                                Oakbridge Publishing Pvt. Ltd.
                                <br />
                                14 Hauz Khas Village
                                <br />
                                New Delhi 110016, India
                            </address>
                        </div>
                        <div className="mt-5 flex gap-4">
                            <Mail
                                size={18}
                                strokeWidth={1.5}
                                className="text-[#CC0033] mt-0.5"
                            />
                            <a
                                href="mailto:hello@oakbridge.in"
                                className="text-sm text-[#002B5C] hover:text-[#CC0033]"
                            >
                                hello@oakbridge.in
                            </a>
                        </div>
                        <div className="mt-4 flex gap-4">
                            <Phone
                                size={18}
                                strokeWidth={1.5}
                                className="text-[#CC0033] mt-0.5"
                            />
                            <a
                                href="tel:+911140000000"
                                className="text-sm text-[#002B5C] hover:text-[#CC0033]"
                            >
                                +91 11 4000 0000
                            </a>
                        </div>
                    </div>

                    <div className="border border-[#E5E7EB] p-8 bg-white">
                        <div className="overline">Direct Lines</div>
                        <dl className="mt-4 space-y-3 text-sm">
                            <div className="flex justify-between border-b border-[#E5E7EB] pb-3">
                                <dt className="text-[#4B5563]">
                                    Institutional Sales
                                </dt>
                                <dd className="font-mono text-[#002B5C]">
                                    schools@oakbridge.in
                                </dd>
                            </div>
                            <div className="flex justify-between border-b border-[#E5E7EB] pb-3">
                                <dt className="text-[#4B5563]">Submissions</dt>
                                <dd className="font-mono text-[#002B5C]">
                                    editorial@oakbridge.in
                                </dd>
                            </div>
                            <div className="flex justify-between border-b border-[#E5E7EB] pb-3">
                                <dt className="text-[#4B5563]">Press</dt>
                                <dd className="font-mono text-[#002B5C]">
                                    press@oakbridge.in
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-[#4B5563]">Careers</dt>
                                <dd className="font-mono text-[#002B5C]">
                                    careers@oakbridge.in
                                </dd>
                            </div>
                        </dl>
                    </div>
                </aside>
            </section>
        </div>
    );
}
