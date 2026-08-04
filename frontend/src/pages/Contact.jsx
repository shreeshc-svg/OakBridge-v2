import React, { useEffect, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Mail, MapPin, Phone } from "lucide-react";
import { submitContact, fetchSettings, fetchSiteContent } from "../lib/api";
import { hiddenSet, resolveSectionOrder } from "../lib/sections";
import CONTENT_DEFAULTS from "../lib/contentDefaults";

const CONTACT_DEFAULT_ORDER = ["form", "details"];
import { toast } from "sonner";
import { useFormShield, HoneypotField } from "../lib/formShield";

export default function Contact() {
    const { website, setWebsite, shield } = useFormShield();
    const [form, setForm] = useState({
        name: "",
        email: "",
        subject: "General Inquiry",
        message: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [settings, setSettings] = useState(null);
    const [site, setSite] = useState({});
    useEffect(() => {
        fetchSettings().then(setSettings).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);
    const DEFAULT_LINES = [
        { label: "Institutional Sales", email: "schools@oakbridge.in" },
        { label: "Submissions", email: "info@oakbridge.in" },
        { label: "Press", email: "press@oakbridge.in" },
        { label: "Careers", email: "careers@oakbridge.in" },
    ];
    const hidden = hiddenSet(settings);
    const contactOrder = resolveSectionOrder(CONTACT_DEFAULT_ORDER, settings?.contact_section_order);
    const contactOrd = (k) => { const i = contactOrder.indexOf(k); return i === -1 ? 99 : i; };
    const directLines =
        Array.isArray(settings?.contact_direct_lines) && settings.contact_direct_lines.length
            ? settings.contact_direct_lines
            : DEFAULT_LINES;

    /*
     * Resolved once, used in three places, so the three cannot disagree.
     *
     * `||` not `??`, matching the convention documented in contentDefaults.js:
     * an empty override falls back to the built-in text, so clearing a field in
     * the admin restores the default rather than blanking the line. An admin who
     * has learned that rule everywhere else should not meet an exception here.
     */
    const replyTime = site.contact_reply_time || CONTENT_DEFAULTS.contact_reply_time;
    const phoneHours = site.contact_phone_hours || CONTENT_DEFAULTS.contact_phone_hours;

    const onChange = (e) =>
        setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

    const onSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await submitContact({ ...form, ...shield() });
            // No turnaround stated here on purpose. It used to say "within two
            // working days", hardcoded, which now contradicts the admin-editable
            // "1–2 working days" shown three times on this page — and would drift
            // again the moment that field is edited. The timing is stated
            // directly beside the button they just pressed; the toast only needs
            // to confirm the message left.
            toast.success("Thank you — your message has been sent.");
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
                <div className="overline">{site.contact_overline || "Get in Touch"}</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-6 text-[#002B5C] leading-[0.95] max-w-3xl whitespace-pre-line">
                    {site.contact_title || "We read every letter."}
                </h1>
                <p className="mt-6 max-w-xl text-[#4B5563] leading-relaxed whitespace-pre-line">
                    {site.contact_body ||
                        "Questions about our books, bulk orders for your school, press inquiries, or manuscripts — reach us through the form below or at the addresses to the right."}
                </p>
            </section>

            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 grid grid-cols-1 lg:grid-cols-12 gap-12">
                {!hidden.has("contact.form") && (
                <div className="lg:col-span-7" style={{ order: contactOrd("form") }}>
                    <form
                        onSubmit={onSubmit}
                        className="space-y-6"
                        data-testid="contact-form"
                    >
                        <HoneypotField value={website} onChange={setWebsite} />
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
                        {/* Third and last placement: beside the button, where the
                            expectation is set BEFORE they commit. Someone who
                            knows a reply takes a day or two waits; someone who
                            doesn't sends the same message again on three
                            channels, or writes you off after an afternoon. */}
                        {replyTime && (
                            <p className="text-xs text-[#4B5563] mt-4 max-w-md leading-relaxed">
                                {replyTime}
                            </p>
                        )}
                    </form>
                </div>
                )}

                {!hidden.has("contact.details") && (
                <aside className="lg:col-span-5 space-y-8" style={{ order: contactOrd("details") }}>
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
                                    934, Tower B3,
                                    <br />
                                    Sohna–Gurgaon Rd, Sector 49, Spaze iTech Park
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
                            {/* Reply time sits with the email address, where the
                                question "how long will this take?" is actually
                                being asked — not buried at the foot of the page. */}
                            <div>
                                <a
                                    href="mailto:info@oakbridge.in"
                                    className="text-sm text-[#002B5C] hover:text-[#CC0033]"
                                >
                                    info@oakbridge.in
                                </a>
                                {replyTime && (
                                    <p className="text-xs text-[#4B5563] mt-1 leading-relaxed max-w-[22rem]">
                                        {replyTime}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 flex gap-4">
                            <Phone
                                size={18}
                                strokeWidth={1.5}
                                className="text-[#CC0033] mt-0.5"
                            />
                            <div>
                                <a
                                    href="tel:+918800337299"
                                    className="text-sm text-[#002B5C] hover:text-[#CC0033]"
                                >
                                    +91 88003 37299
                                </a>
                                {phoneHours && (
                                    <p className="text-xs text-[#4B5563] mt-1">
                                        {phoneHours}
                                    </p>
                                )}
                            </div>
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
                )}
            </section>
        </div>
    );
}
