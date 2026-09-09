import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, Upload } from "lucide-react";
import {
    fetchSiteContent,
    adminSetSiteContent,
    adminUploadEbookPriceList,
    formatApiError,
} from "../../lib/api";
import { TextSlotRow } from "../../components/admin/ContentEditors";
import MediaListEditor from "../../components/admin/MediaListEditor";
import CONTENT_DEFAULTS from "../../lib/contentDefaults";

/**
 * A two-state switch that saves on click.
 *
 * Defaults to on when the value has never been set, matching how every other
 * toggle on this screen reads its own key — an unset switch should behave like
 * the feature's default, not like "off".
 */
function OnOff({ name, value, onChange }) {
    const on = String(value ?? "on").toLowerCase() !== "off";
    return (
        <div className="flex gap-4">
            {[
                { v: "on", label: "Shown" },
                { v: "off", label: "Hidden" },
            ].map((opt) => (
                <label key={opt.v} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                        type="radio"
                        name={name}
                        checked={on === (opt.v === "on")}
                        onChange={() => onChange(opt.v)}
                        data-testid={`${name}-${opt.v}`}
                    />
                    {opt.label}
                </label>
            ))}
        </div>
    );
}

/**
 * Bulk price list, keyed on ISBN.
 *
 * Always checked before it is applied. The eReader prices 110 titles; a column
 * named something unexpected, or ISBNs formatted differently at the two ends,
 * is the difference between 110 updates and 0 — and that is a number to read on
 * screen, not to discover afterwards on the storefront.
 *
 * Deliberately updates only: a price for a title we do not sell is a row to
 * report, never a book to create.
 */
function PriceListUpload() {
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);

    const pick = (f) => {
        setFile(f || null);
        setPreview(null); // a new file invalidates the old numbers
    };

    const run = async (dryRun) => {
        if (!file) return;
        setBusy(true);
        try {
            const res = await adminUploadEbookPriceList(file, dryRun);
            setPreview(res);
            if (!dryRun) {
                toast.success(`${res.updated} title${res.updated === 1 ? "" : "s"} updated.`);
                setFile(null);
            }
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setBusy(false);
        }
    };

    const Stat = ({ label, value, tone = "" }) => (
        <div className="border border-[#E5E7EB] bg-white px-3 py-2">
            <div className="overline !text-[9px]">{label}</div>
            <div className={`font-serif text-2xl ${tone || "text-[#002B5C]"}`}>{value}</div>
        </div>
    );

    return (
        <section className="border border-[#E5E7EB] bg-white p-5" data-testid="ebook-price-list">
            {/* Titled for links FIRST, and renamed from "Upload a price list"
                for a reason: linking a title is what makes its eBook button
                appear at all, and this is the only way to do it for more than a
                handful. Filed under a price heading, the one tool that turns the
                feature on for the whole catalogue read as optional pricing
                admin, and titles went unlinked because nobody knew it was
                here. */}
            <h2 className="font-serif text-xl text-[#002B5C]">Link titles to the eReader, in bulk</h2>
            <p className="text-[11px] text-[#4B5563] mt-1 mb-4 max-w-2xl">
                <strong>This is what makes the eBook button appear on a title.</strong> A .csv or
                .xlsx with an <code className="font-mono">isbn</code> column, plus{" "}
                <code className="font-mono">ebook_url</code>,{" "}
                <code className="font-mono">ebook_price</code>, or both — a title needs the URL to
                show the button at all, and the price only adds the figure beside it. ISBNs match
                with or without hyphens. Prices go in <strong>before GST</strong> — the rate above
                is added when they are shown. A blank cell leaves that title's existing value
                alone; put <code className="font-mono">-</code> in it to clear one. Existing titles
                are updated and none are created.
            </p>

            <div className="flex flex-wrap items-center gap-3">
                <input
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(e) => pick(e.target.files?.[0])}
                    data-testid="price-list-file"
                    className="text-sm"
                />
                <button
                    type="button"
                    onClick={() => run(true)}
                    disabled={!file || busy}
                    data-testid="price-list-check"
                    className="inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-4 py-2 text-sm hover:bg-[#F5F7FA] disabled:opacity-40"
                >
                    <Upload size={14} strokeWidth={1.5} />
                    {busy ? "Working…" : "Check file"}
                </button>
                {preview?.dry_run && preview.updated > 0 && (
                    <button
                        type="button"
                        onClick={() => run(false)}
                        disabled={busy}
                        data-testid="price-list-apply"
                        className="bg-[#0A7D55] text-white px-4 py-2 text-sm hover:bg-[#086544] disabled:opacity-40"
                    >
                        Apply to {preview.updated} title{preview.updated === 1 ? "" : "s"}
                    </button>
                )}
            </div>

            {preview && (
                <div className="mt-5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Stat label="Rows read" value={preview.rows_read} />
                        <Stat
                            label={preview.dry_run ? "Would update" : "Updated"}
                            value={preview.updated}
                            tone="text-[#0A7D55]"
                        />
                        <Stat
                            label="No such ISBN"
                            value={preview.unmatched}
                            tone={preview.unmatched ? "text-[#854F0B]" : ""}
                        />
                        <Stat
                            label="Bad rows"
                            value={preview.invalid}
                            tone={preview.invalid ? "text-[#CC0033]" : ""}
                        />
                    </div>

                    <p className="text-[11px] text-[#4B5563] mt-3">
                        Read columns — ISBN: <code className="font-mono">{preview.columns.isbn}</code>
                        {preview.columns.price && (
                            <>
                                , price: <code className="font-mono">{preview.columns.price}</code>
                            </>
                        )}
                        {preview.columns.url && (
                            <>
                                , link: <code className="font-mono">{preview.columns.url}</code>
                            </>
                        )}
                        .
                    </p>

                    {preview.unmatched > 0 && (
                        <p className="text-[11px] text-[#854F0B] mt-2">
                            Not in the catalogue: {preview.unmatched_isbns.join(", ")}
                            {preview.unmatched > preview.unmatched_isbns.length && " …"}
                        </p>
                    )}
                    {preview.invalid > 0 && (
                        <ul className="text-[11px] text-[#CC0033] mt-2 space-y-0.5">
                            {preview.invalid_rows.map((r, i) => (
                                <li key={i}>
                                    Row {r.row} ({r.isbn}): {r.error}
                                </li>
                            ))}
                        </ul>
                    )}

                    {preview.sample?.length > 0 && (
                        <div className="mt-3 border border-[#E5E7EB]">
                            <table className="w-full text-[11px]">
                                <tbody>
                                    {preview.sample.map((r, i) => (
                                        <tr key={i} className="border-b border-[#E5E7EB] last:border-0">
                                            <td className="px-2 py-1.5 font-mono text-[#4B5563]">{r.isbn}</td>
                                            <td className="px-2 py-1.5 text-[#002B5C]">{r.title}</td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                                {r.ebook_price === "—" ? "—" : `₹${r.ebook_price}`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {preview.updated > preview.sample.length && (
                                <div className="px-2 py-1.5 text-[11px] text-[#4B5563]">
                                    …and {preview.updated - preview.sample.length} more
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

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

                    {/* Per-title eBook edition — separate from the generic
                        platform CTA above, because it appears only on books
                        that carry their own ebook_url. */}
                    <section className="border border-[#0A7D55]/30 bg-[#0A7D55]/[0.04] p-5">
                        <h2 className="font-serif text-xl text-[#002B5C]">
                            Per-title eBook edition
                        </h2>
                        <p className="text-[11px] text-[#4B5563] mt-1 mb-4 max-w-2xl">
                            The eBook mark on individual books. It appears only on titles that have
                            a link saved in{" "}
                            <Link
                                to="/admin/books"
                                className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]"
                            >
                                Admin → Books
                            </Link>
                            , so switching these on shows nothing until titles are linked. Turning a
                            switch off here hides the mark on every book at once, without touching
                            any of the links.
                        </p>

                        <div className="space-y-5">
                            <div>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="overline !text-[10px]">
                                        Bookstore listings
                                    </div>
                                    <OnOff
                                        name="ebook-plp"
                                        value={site.ebook_plp_enabled}
                                        onChange={(v) => saveSite("ebook_plp_enabled", v)}
                                    />
                                </div>
                                <p className="text-[11px] text-[#4B5563] mt-1 mb-2">
                                    A small link beside the delivery estimate on each book card.
                                </p>
                                <TextSlotRow
                                    label="Label"
                                    value={site.ebook_plp_label}
                                    defaultValue={CONTENT_DEFAULTS.ebook_plp_label}
                                    onSave={(v) => saveSite("ebook_plp_label", v)}
                                />
                            </div>

                            <div className="border-t border-[#0A7D55]/20 pt-5">
                                <div className="overline !text-[10px]">Show the eBook price</div>
                                <p className="text-[11px] text-[#4B5563] mt-1 mb-3">
                                    On listings the price rides inside the eBook link beside the
                                    delivery estimate — <strong>3–7 days · eBook ₹489</strong> — so
                                    nothing on the tile moves. On the product page it sits under the
                                    print price as <strong>Book ₹716 / eBook ₹489</strong>. A title
                                    with a price but no link shows nothing either way.
                                </p>
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <span className="text-sm text-[#002B5C]">On book tiles</span>
                                        <OnOff
                                            name="ebook-price-plp"
                                            value={site.ebook_price_plp_enabled ?? "off"}
                                            onChange={(v) => saveSite("ebook_price_plp_enabled", v)}
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <span className="text-sm text-[#002B5C]">On the product page</span>
                                        <OnOff
                                            name="ebook-price-pdp"
                                            value={site.ebook_price_pdp_enabled ?? "off"}
                                            onChange={(v) => saveSite("ebook_price_pdp_enabled", v)}
                                        />
                                    </div>
                                    <TextSlotRow
                                        label="GST added to eBook prices (%)"
                                        value={site.ebook_gst_percent}
                                        defaultValue={CONTENT_DEFAULTS.ebook_gst_percent}
                                        onSave={(v) => saveSite("ebook_gst_percent", v)}
                                    />
                                    <p className="text-[11px] text-[#4B5563]">
                                        Prices are stored <strong>before</strong> GST and grossed up
                                        here, so a rate change covers every title at once. Set 0 to
                                        show the uploaded figures unchanged.
                                    </p>
                                    <TextSlotRow
                                        label="Label for the print price"
                                        value={site.ebook_price_print_label}
                                        defaultValue={CONTENT_DEFAULTS.ebook_price_print_label}
                                        onSave={(v) => saveSite("ebook_price_print_label", v)}
                                    />
                                    <TextSlotRow
                                        label="Label for the eBook price"
                                        value={site.ebook_price_ebook_label}
                                        defaultValue={CONTENT_DEFAULTS.ebook_price_ebook_label}
                                        onSave={(v) => saveSite("ebook_price_ebook_label", v)}
                                    />
                                </div>
                            </div>

                            <div className="border-t border-[#0A7D55]/20 pt-5">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="overline !text-[10px]">Product page</div>
                                    <OnOff
                                        name="ebook-pdp"
                                        value={site.ebook_pdp_enabled}
                                        onChange={(v) => saveSite("ebook_pdp_enabled", v)}
                                    />
                                </div>
                                <p className="text-[11px] text-[#4B5563] mt-1 mb-2">
                                    The panel under Buy Now. Leave the body blank to show only the
                                    heading.
                                </p>
                                <div className="space-y-3">
                                    <TextSlotRow
                                        label="Heading"
                                        value={site.ebook_pdp_title}
                                        defaultValue={CONTENT_DEFAULTS.ebook_pdp_title}
                                        onSave={(v) => saveSite("ebook_pdp_title", v)}
                                    />
                                    <TextSlotRow
                                        label="Body (optional)"
                                        value={site.ebook_pdp_body}
                                        defaultValue={CONTENT_DEFAULTS.ebook_pdp_body}
                                        onSave={(v) => saveSite("ebook_pdp_body", v)}
                                    />
                                    <TextSlotRow
                                        label="Button text"
                                        value={site.ebook_pdp_button}
                                        defaultValue={CONTENT_DEFAULTS.ebook_pdp_button}
                                        onSave={(v) => saveSite("ebook_pdp_button", v)}
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <PriceListUpload />

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

                    <section>
                        <h2 className="font-serif text-xl text-[#002B5C]">
                            The eBooks page{" "}
                            <Link
                                to="/ebooks"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[10px] uppercase tracking-widest text-[#CC0033] align-middle"
                            >
                                view ↗
                            </Link>
                        </h2>
                        <p className="text-[11px] text-[#4B5563] mt-1 mb-3">
                            The print-versus-eBook comparison at <code>/ebooks</code>, linked from the
                            header. The bullet lists under each format are edited below.
                        </p>
                        <div className="space-y-3">
                            <TextSlotRow label="Eyebrow" value={site.eb_eyebrow} defaultValue={CONTENT_DEFAULTS.eb_eyebrow} onSave={(v) => saveSite("eb_eyebrow", v)} />
                            <TextSlotRow label="Headline (line breaks allowed)" value={site.eb_headline} defaultValue={CONTENT_DEFAULTS.eb_headline} onSave={(v) => saveSite("eb_headline", v)} multiline />
                            <TextSlotRow label="Headline — the amber words at the end" value={site.eb_accent} defaultValue={CONTENT_DEFAULTS.eb_accent} onSave={(v) => saveSite("eb_accent", v)} />
                            <TextSlotRow label="Intro paragraph" value={site.eb_body} defaultValue={CONTENT_DEFAULTS.eb_body} onSave={(v) => saveSite("eb_body", v)} multiline />
                            <TextSlotRow label="Left column — heading" value={site.eb_print_title} defaultValue={CONTENT_DEFAULTS.eb_print_title} onSave={(v) => saveSite("eb_print_title", v)} />
                            <TextSlotRow label="Left column — one-liner" value={site.eb_print_body} defaultValue={CONTENT_DEFAULTS.eb_print_body} onSave={(v) => saveSite("eb_print_body", v)} />
                            <TextSlotRow label="Right column — heading" value={site.eb_ebook_title} defaultValue={CONTENT_DEFAULTS.eb_ebook_title} onSave={(v) => saveSite("eb_ebook_title", v)} />
                            <TextSlotRow label="Right column — one-liner" value={site.eb_ebook_body} defaultValue={CONTENT_DEFAULTS.eb_ebook_body} onSave={(v) => saveSite("eb_ebook_body", v)} />
                            <TextSlotRow label="Motion — animate the illustrations (on / off)" value={site.eb_anim_enabled} defaultValue={CONTENT_DEFAULTS.eb_anim_enabled} onSave={(v) => saveSite("eb_anim_enabled", v)} />
                            <TextSlotRow label="Motion — the portal ring behind the artwork (on / off, desktop only)" value={site.eb_portal_enabled} defaultValue={CONTENT_DEFAULTS.eb_portal_enabled} onSave={(v) => saveSite("eb_portal_enabled", v)} />
                            <TextSlotRow label="Motion — heartbeat, seconds per pulse" value={site.eb_anim_beat} defaultValue={CONTENT_DEFAULTS.eb_anim_beat} onSave={(v) => saveSite("eb_anim_beat", v)} />
                            <TextSlotRow label="Motion — how long a letter takes to cross, seconds" value={site.eb_anim_flight} defaultValue={CONTENT_DEFAULTS.eb_anim_flight} onSave={(v) => saveSite("eb_anim_flight", v)} />
                            <TextSlotRow label="Illustration — width in pixels (320–1000; the portal resizes with it)" value={site.eb_art_width} defaultValue={CONTENT_DEFAULTS.eb_art_width} onSave={(v) => saveSite("eb_art_width", v)} />
                            <TextSlotRow label="Illustration — book title" value={site.eb_art_title} defaultValue={CONTENT_DEFAULTS.eb_art_title} onSave={(v) => saveSite("eb_art_title", v)} />
                            <TextSlotRow label="Illustration — author" value={site.eb_art_author} defaultValue={CONTENT_DEFAULTS.eb_art_author} onSave={(v) => saveSite("eb_art_author", v)} />
                            <TextSlotRow label="Illustration — chapter line" value={site.eb_art_chapter} defaultValue={CONTENT_DEFAULTS.eb_art_chapter} onSave={(v) => saveSite("eb_art_chapter", v)} />
                            <TextSlotRow label="Illustration — page count (drives the reader's progress bar)" value={site.eb_art_pages} defaultValue={CONTENT_DEFAULTS.eb_art_pages} onSave={(v) => saveSite("eb_art_pages", v)} />
                            <TextSlotRow label="Cloud panel — kicker" value={site.eb_cloud_kicker} defaultValue={CONTENT_DEFAULTS.eb_cloud_kicker} onSave={(v) => saveSite("eb_cloud_kicker", v)} />
                            <TextSlotRow label="Cloud panel — tagline" value={site.eb_cloud_tagline} defaultValue={CONTENT_DEFAULTS.eb_cloud_tagline} onSave={(v) => saveSite("eb_cloud_tagline", v)} />
                            <TextSlotRow label="Cloud panel — supporting line" value={site.eb_cloud_body} defaultValue={CONTENT_DEFAULTS.eb_cloud_body} onSave={(v) => saveSite("eb_cloud_body", v)} multiline />
                            <TextSlotRow label="Closing strip — kicker" value={site.eb_cta_kicker} defaultValue={CONTENT_DEFAULTS.eb_cta_kicker} onSave={(v) => saveSite("eb_cta_kicker", v)} />
                            <TextSlotRow label="Closing strip — heading" value={site.eb_cta_headline} defaultValue={CONTENT_DEFAULTS.eb_cta_headline} onSave={(v) => saveSite("eb_cta_headline", v)} />
                        </div>

                        <div className="overline !text-[10px] mt-6 mb-2">Left column — printed book</div>
                        <MediaListEditor
                            collectionKey="page_eb_print"
                            addLabel="Add point"
                            max={7}
                            help="Reasons to buy the printed edition. Order here is the order on the page. Clear the list entirely and the column's bullets disappear."
                            fields={[
                                { key: "title", label: "Point" },
                                { key: "text", label: "Supporting line (optional)" },
                            ]}
                        />

                        <div className="overline !text-[10px] mt-6 mb-2">Right column — eBook</div>
                        <MediaListEditor
                            collectionKey="page_eb_ebook"
                            addLabel="Add point"
                            max={7}
                            help="Reasons to buy the eBook. Avoid stating a discount percentage here — the real number differs per title and is shown on each book's own page."
                            fields={[
                                { key: "title", label: "Point" },
                                { key: "text", label: "Supporting line (optional)" },
                            ]}
                        />
                    </section>
                </div>
            )}
        </div>
    );
}
