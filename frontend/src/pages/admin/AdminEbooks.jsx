import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { fetchSiteContent, adminSetSiteContent } from "../../lib/api";
import { TextSlotRow } from "../../components/admin/ContentEditors";
import CONTENT_DEFAULTS from "../../lib/contentDefaults";

/**
 * E-books — one screen for the platform link and every button that points at it.
 *
 * These fields used to live inside Admin -> Pages, mixed in with homepage copy,
 * which made them hard to find and easy to mistake for page content. They are
 * one feature spanning three pages, so they get their own section.
 *
 * Wording resolves per placement: the page-specific field wins, then the shared
 * field, then the built-in default.
 */
export default function AdminEbooks() {
    const [site, setSite] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSiteContent()
            .then(setSite)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const saveSite = async (key, value) => {
        await adminSetSiteContent(key, value);
        setSite((s) => ({ ...s, [key]: value }));
        toast.success("Saved — live on the site.");
    };

    const url = site.ebook_url ?? CONTENT_DEFAULTS.ebook_url;
    const enabled = String(site.ebook_enabled ?? "on").toLowerCase() !== "off";
    const live = enabled && Boolean((url || "").trim());

    const setEnabled = (on) => saveSite("ebook_enabled", on ? "on" : "off");

    return (
        <div data-testid="admin-ebooks-page">
            <div className="overline">Storefront</div>
            <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">E-Books</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                The link to the Oakbridge eReader and the buttons that point at it — on the
                homepage, the Bookstore listing and every book page.
            </p>

            <div
                className={`mt-6 max-w-3xl border-l-2 pl-4 py-3 ${live ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#F59E0B] bg-[#FFFBEB]"}`}
            >
                {live ? (
                    <p className="text-sm text-[#002B5C]">
                        Buttons are <strong>live</strong> and pointing at{" "}
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs border-b border-[#002B5C] inline-flex items-center gap-1"
                        >
                            {url}
                            <ExternalLink size={11} strokeWidth={1.5} />
                        </a>
                    </p>
                ) : (
                    <p className="text-sm text-[#002B5C]">
                        The e-book buttons are <strong>hidden</strong> on every page
                        {enabled ? " because no URL is set" : " — they're switched off below"}.
                    </p>
                )}
            </div>

            <section className="mt-8 max-w-3xl border border-[#E5E7EB] bg-white p-5">
                <h2 className="font-serif text-xl text-[#002B5C]">Show e-book buttons</h2>
                <p className="text-[11px] text-[#4B5563] mt-1">
                    Turns the homepage band, Bookstore strip and book-page button on or off
                    together. The URL and wording below are kept either way, so switching back
                    on restores exactly what you had.
                </p>
                <div className="mt-4 flex flex-wrap gap-6">
                    {[
                        { on: true, label: "Enabled", hint: "Buttons visible to customers" },
                        { on: false, label: "Disabled", hint: "Hidden everywhere" },
                    ].map((opt) => (
                        <label key={opt.label} className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="radio"
                                name="ebook-enabled"
                                checked={enabled === opt.on}
                                onChange={() => setEnabled(opt.on)}
                                data-testid={`ebook-enabled-${opt.on ? "on" : "off"}`}
                                className="accent-[#002B5C] w-4 h-4 mt-0.5"
                            />
                            <span>
                                <span className="block text-sm text-[#002B5C]">{opt.label}</span>
                                <span className="block text-[11px] text-[#4B5563]">{opt.hint}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </section>

            {loading ? (
                <p className="mt-8 font-mono text-xs text-[#4B5563]">Loading…</p>
            ) : (
                <div className="mt-8 max-w-3xl space-y-8">
                    <section>
                        <h2 className="font-serif text-xl text-[#002B5C]">Destination</h2>
                        <p className="text-[11px] text-[#4B5563] mt-1 mb-3">
                            Clearing this hides the e-book button everywhere — a quick kill switch
                            if the platform goes down.
                        </p>
                        <TextSlotRow
                            label="E-book platform URL"
                            value={site.ebook_url}
                            defaultValue={CONTENT_DEFAULTS.ebook_url}
                            onSave={(v) => saveSite("ebook_url", v)}
                        />
                    </section>

                    <section>
                        <h2 className="font-serif text-xl text-[#002B5C]">Wording — all pages</h2>
                        <p className="text-[11px] text-[#4B5563] mt-1 mb-3">
                            Used everywhere unless a page below overrides it.
                        </p>
                        <div className="space-y-3">
                            <TextSlotRow label="Label" value={site.ebook_cta_label} defaultValue={CONTENT_DEFAULTS.ebook_cta_label} onSave={(v) => saveSite("ebook_cta_label", v)} />
                            <TextSlotRow label="Action text" value={site.ebook_cta_action} defaultValue={CONTENT_DEFAULTS.ebook_cta_action} onSave={(v) => saveSite("ebook_cta_action", v)} />
                            <TextSlotRow label="Blurb" value={site.ebook_cta_blurb} defaultValue={CONTENT_DEFAULTS.ebook_cta_blurb} onSave={(v) => saveSite("ebook_cta_blurb", v)} multiline />
                        </div>
                    </section>

                    <section>
                        <h2 className="font-serif text-xl text-[#002B5C]">Homepage band</h2>
                        <p className="text-[11px] text-[#4B5563] mt-1 mb-3">
                            The navy strip under the hero. Leave blank to use the shared wording.
                        </p>
                        <div className="space-y-3">
                            <TextSlotRow label="Headline" value={site.ebook_home_label} defaultValue={CONTENT_DEFAULTS.ebook_cta_label} onSave={(v) => saveSite("ebook_home_label", v)} />
                            <TextSlotRow label="Button text" value={site.ebook_home_action} defaultValue={CONTENT_DEFAULTS.ebook_cta_action} onSave={(v) => saveSite("ebook_home_action", v)} />
                            <TextSlotRow label="Blurb" value={site.ebook_home_blurb} defaultValue={CONTENT_DEFAULTS.ebook_cta_blurb} onSave={(v) => saveSite("ebook_home_blurb", v)} multiline />
                        </div>
                    </section>

                    <section>
                        <h2 className="font-serif text-xl text-[#002B5C]">Bookstore strip</h2>
                        <p className="text-[11px] text-[#4B5563] mt-1 mb-3">
                            The slim bar above the book listing.
                        </p>
                        <div className="space-y-3">
                            <TextSlotRow label="Label" value={site.ebook_plp_label} defaultValue={CONTENT_DEFAULTS.ebook_cta_label} onSave={(v) => saveSite("ebook_plp_label", v)} />
                            <TextSlotRow label="Trailing text" value={site.ebook_plp_action} defaultValue={CONTENT_DEFAULTS.ebook_cta_action} onSave={(v) => saveSite("ebook_plp_action", v)} />
                        </div>
                    </section>

                    <section>
                        <h2 className="font-serif text-xl text-[#002B5C]">Book page button</h2>
                        <p className="text-[11px] text-[#4B5563] mt-1 mb-3">
                            Sits beside the format badge on every book page. Keep it short.
                        </p>
                        <TextSlotRow label="Button text" value={site.ebook_pdp_label} defaultValue={CONTENT_DEFAULTS.ebook_cta_label} onSave={(v) => saveSite("ebook_pdp_label", v)} />
                    </section>
                </div>
            )}
        </div>
    );
}
