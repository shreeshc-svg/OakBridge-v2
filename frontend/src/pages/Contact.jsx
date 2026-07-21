import React, { useEffect, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Mail, MapPin, Phone } from "lucide-react";
import { submitContact, fetchSettings } from "../lib/api";
import { toast } from "sonner";

export default function Contact() {
    const [form, setForm] = useState({
        name: "",
        email: "",
        subject: "General Inquiry",
        message: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [settings, setSettings] = useState(null);
    useEffect(() => {
        fetchSettings().then(setSettings).catch(() => {});
    }, []);
    const DEFAULT_LINES = [
        { label: "Institutional Sales", email: "schools@oakbridge.in" },
        { label: "Submissions", email: "editorial@oakbridge.in" },
        { label: "Press", email: "press@oakbridge.in" },
        { label: "Careers", email: "careers@oakbridge.in" },
    ];
    const directLines =
        Array.isArray(settings?.contact_direct_lines) && settings.contact_direct_lines.length
            ? settings.contact_direct_lines
            : DEFAULT_LINES;

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
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-16 border-b border-[#E5E7EB]">
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

            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 grid grid-cols-1 lg:grid-cols-12 gap-12">
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
                                <a
                                    href="https://www.google.com/search?sca_esv=f08852b8ef6a6dca&sxsrf=APpeQnvRob4d_1aw52Yoz8qkOS9PKHpbHA:1783412885850&q=oakbridge+publishing+pvt.+ltd.+address&ludocid=6251122592004087756"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:text-[#CC0033]"
                                >
                                    B3 Tower, Spaze iTech Park
                                    <br />
                                    934, Sohna–Gurgaon Rd, Block S, Sector 49
                                    <br />
                                    Gurugram, Haryana 122018, India
                                </a>
                            </address>
                        </div>
                        <div className="mt-5 flex gap-4">
                            <Mail
                                size={18}
                                strokeWidth={1.5}
                                className="text-[#CC0033] mt-0.5"
                            />
                            <a
                                href="mailto:info@oakbridge.in"
                                className="text-sm text-[#002B5C] hover:text-[#CC0033]"
                            >
                                info@oakbridge.in
                            </a>
                        </div>
                        <div className="mt-4 flex gap-4">
                            <Phone
                                size={18}
                                strokeWidth={1.5}
                                className="text-[#CC0033] mt-0.5"
                            />
                            <a
                                href="tel:+918800337299"
                                className="text-sm text-[#002B5C] hover:text-[#CC0033]"
                            >
                                +91 88003 37299
                            </a>
                        </div>
                    </div>

                    <div className="border border-[#E5E7EB] p-8 bg-white">
                        <div className="overline">Direct Lines</div>
                        <dl className="mt-4 space-y-3 text-sm">
                            {directLines.map((l, i) => (
                                <div
                                    key={i}
                                    className={`flex justify-between ${i < directLines.length - 1 ? "border-b border-[#E5E7EB] pb-3" : ""}`}
                                >
                                    <dt className="text-[#4B5563]">{l.label}</dt>
                                    <dd className="font-mono text-[#002B5C]">
                                        <a href={`mailto:${l.email}`} className="hover:underline">
                                            {l.email}
                                        </a>
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </aside>
            </section>
        </div>
    );
}
