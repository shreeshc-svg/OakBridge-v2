import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UploadCloud, ArrowUp, ArrowDown, X, Plus, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { SECTION_REGISTRY } from "../../lib/sections";
import {
    fetchSiteContent,
    adminSetSiteContent,
    fetchCategories,
    adminUpdateCategoryImage,
    fetchCollection,
    adminSaveCollection,
    adminUploadMedia,
    fetchSettings,
    adminSetSetting,
    mediaUrl,
} from "../../lib/api";

// Reorder the whole sections of the public Events page.
const EVENTS_SECTIONS = [
    { key: "flagship", label: "Flagship Events" },
    { key: "experiences", label: "The Experience" },
    { key: "summit_speakers", label: "Summit Speakers" },
    { key: "who_attends", label: "Who Attends" },
    { key: "vidhi_speakers", label: "Vidhi Utsav Speakers" },
    { key: "cta", label: "Get Involved (CTA)" },
];

function EventsSectionOrder() {
    const [order, setOrder] = useState(EVENTS_SECTIONS.map((s) => s.key));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings()
            .then((s) => {
                const saved = Array.isArray(s.events_section_order) ? s.events_section_order : [];
                const merged = [
                    ...saved.filter((k) => EVENTS_SECTIONS.some((x) => x.key === k)),
                    ...EVENTS_SECTIONS.map((x) => x.key).filter((k) => !saved.includes(k)),
                ];
                setOrder(merged);
            })
            .catch(() => {});
    }, []);

    const move = (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= order.length) return;
        const n = [...order];
        [n[i], n[j]] = [n[j], n[i]];
        setOrder(n);
    };

    const save = async () => {
        setSaving(true);
        try {
            await adminSetSetting("events_section_order", order);
            toast.success("Section order saved — live on /events.");
        } catch {
            toast.error("Could not save order.");
        } finally {
            setSaving(false);
        }
    };

    const labelFor = (k) => EVENTS_SECTIONS.find((x) => x.key === k)?.label || k;

    return (
        <div className="border border-[#E5E7EB] bg-[#F5F7FA] p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="overline !text-[10px]">Section order (drag with arrows)</div>
                <button onClick={save} disabled={saving} className="text-sm border border-[#002B5C] text-[#002B5C] px-3 py-1 hover:bg-white disabled:opacity-60">
                    {saving ? "Saving…" : "Save order"}
                </button>
            </div>
            <div className="space-y-2">
                {order.map((k, i) => (
                    <div key={k} className="flex items-center gap-2 bg-white border border-[#E5E7EB] px-3 py-2">
                        <span className="font-mono text-xs text-[#4B5563] w-5">{String(i + 1).padStart(2, "0")}</span>
                        <span className="flex-1 text-sm text-[#002B5C]">{labelFor(k)}</span>
                        <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Up" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25"><ArrowUp size={14} strokeWidth={1.5} /></button>
                        <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Down" className="text-[#4B5563] hover:text-[#002B5C] disabled:opacity-25"><ArrowDown size={14} strokeWidth={1.5} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}
import {
    PageGroup,
    pageGroupId,
    SlotRow,
    TextSlotRow,
    PageCardsEditor,
    ListEditor,
    CollectionEditor,
} from "../../components/admin/ContentEditors";

// Tab bar targets — label shown, title must match the PageGroup title exactly.
const PAGE_TABS = [
    { label: "Homepage", title: "Homepage" },
    { label: "Bookstore", title: "Bookstore — Product Listing (PLP)" },
    { label: "Book page", title: "Book pages — Product Detail (PDP)" },
    { label: "What We Do", title: "What We Do" },
    { label: "Digital Solutions", title: "Digital Solutions" },
    { label: "Academy", title: "Academy" },
    { label: "Solutions", title: "Solutions" },
    { label: "About", title: "About" },
    { label: "Authors", title: "Authors" },
    { label: "Events", title: "Events" },
    { label: "Contact", title: "Contact" },
    { label: "Submissions", title: "Author Submissions" },
    { label: "Careers", title: "Careers" },
    { label: "Media", title: "Media & Gallery" },
];

function scrollToGroup(title) {
    const el = document.getElementById(pageGroupId(title));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function AdminPages() {
    const [cats, setCats] = useState([]);
    const [site, setSite] = useState({});

    useEffect(() => {
        fetchCategories().then(setCats).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);

    const saveSite = async (key, value) => {
        await adminSetSiteContent(key, value);
        setSite((s) => ({ ...s, [key]: value }));
        toast.success("Saved — live on the site.");
    };
    const saveCat = async (id, image) => {
        await adminUpdateCategoryImage(id, image);
        setCats((cs) => cs.map((c) => (c.id === id ? { ...c, image } : c)));
        toast.success("Category image saved.");
    };

    return (
        <div data-testid="admin-pages">
            <div className="overline">Content</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Pages</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Everything that appears on your storefront pages — headlines, body copy, cards and
                images. Header and footer links live under Navigation.
            </p>

            {/* Jump-to tabs — click a page to scroll straight to its editor. */}
            <div className="mt-6 sticky top-0 z-20 -mx-2 px-2 py-3 bg-[#F5F7FA]/95 backdrop-blur border-b border-[#E5E7EB]">
                <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {PAGE_TABS.map((t) => (
                        <button
                            key={t.title}
                            onClick={() => scrollToGroup(t.title)}
                            data-testid={`page-tab-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
                            className="flex-shrink-0 border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#002B5C] hover:border-[#002B5C] hover:bg-[#002B5C] hover:text-white transition-colors"
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <section className="mt-8">
                <SectionVisibility />
            </section>

            <section className="mt-10">
                <h2 className="font-serif text-2xl text-[#002B5C]">Storefront pages</h2>
                <p className="text-sm text-[#4B5563] mt-1 max-w-2xl">
                    Edit the copy, cards and images on each storefront page. Images can be dragged straight onto a slot, or pasted as a URL from the Media Library. Saves apply instantly.
                </p>

                <PageGroup title="Homepage" path="/">
                    <SlotRow label="Hero image" value={site.home_hero} onSave={(v) => saveSite("home_hero", v)} />
                    <div className="overline !text-[10px] mt-6 mb-2">Hero text</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Overline (Est. 2017 · …)" value={site.home_hero_overline} onSave={(v) => saveSite("home_hero_overline", v)} />
                        <TextSlotRow label="Headline (wrap a word in *stars* for red; use line breaks)" value={site.home_hero_title} onSave={(v) => saveSite("home_hero_title", v)} multiline />
                        <TextSlotRow label="Intro paragraph" value={site.home_hero_body} onSave={(v) => saveSite("home_hero_body", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mt-6 mb-2">Section headings (tip: *word* = red accent)</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Our Businesses — overline" value={site.home_biz_overline} onSave={(v) => saveSite("home_biz_overline", v)} />
                        <TextSlotRow label="Our Businesses — heading" value={site.home_biz_title} onSave={(v) => saveSite("home_biz_title", v)} multiline />
                        <TextSlotRow label="Imprints — overline" value={site.home_imprints_overline} onSave={(v) => saveSite("home_imprints_overline", v)} />
                        <TextSlotRow label="Imprints — heading" value={site.home_imprints_title} onSave={(v) => saveSite("home_imprints_title", v)} multiline />
                        <TextSlotRow label="Hot Off the Press — overline" value={site.home_hot_overline} onSave={(v) => saveSite("home_hot_overline", v)} />
                        <TextSlotRow label="Hot Off the Press — heading" value={site.home_hot_title} onSave={(v) => saveSite("home_hot_title", v)} multiline />
                        <TextSlotRow label="Solutions — overline" value={site.home_solutions_overline} onSave={(v) => saveSite("home_solutions_overline", v)} />
                        <TextSlotRow label="Solutions — heading" value={site.home_solutions_title} onSave={(v) => saveSite("home_solutions_title", v)} multiline />
                        <TextSlotRow label="Bestsellers — overline" value={site.home_bestsellers_overline} onSave={(v) => saveSite("home_bestsellers_overline", v)} />
                        <TextSlotRow label="Bestsellers — heading" value={site.home_bestsellers_title} onSave={(v) => saveSite("home_bestsellers_title", v)} multiline />
                        <TextSlotRow label="Testimonials — overline" value={site.home_testimonials_overline} onSave={(v) => saveSite("home_testimonials_overline", v)} />
                        <TextSlotRow label="Testimonials — heading" value={site.home_testimonials_title} onSave={(v) => saveSite("home_testimonials_title", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mt-6 mb-2">Hero stats (three)</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Stat 1 — value (e.g. 230+)" value={site.home_stat1_value} onSave={(v) => saveSite("home_stat1_value", v)} />
                        <TextSlotRow label="Stat 1 — label" value={site.home_stat1_label} onSave={(v) => saveSite("home_stat1_label", v)} />
                        <TextSlotRow label="Stat 2 — value (e.g. 320K)" value={site.home_stat2_value} onSave={(v) => saveSite("home_stat2_value", v)} />
                        <TextSlotRow label="Stat 2 — label" value={site.home_stat2_label} onSave={(v) => saveSite("home_stat2_label", v)} />
                        <TextSlotRow label="Stat 3 — value (e.g. Global)" value={site.home_stat3_value} onSave={(v) => saveSite("home_stat3_value", v)} />
                        <TextSlotRow label="Stat 3 — label" value={site.home_stat3_label} onSave={(v) => saveSite("home_stat3_label", v)} />
                    </div>
                    <div className="overline !text-[10px] mt-6 mb-2">Imprint tiles (Five Imprints section)</div>
                    <div className="space-y-3">
                        <SlotRow label="Coffee Table Books" value={site.home_imprint_coffee_table} onSave={(v) => saveSite("home_imprint_coffee_table", v)} />
                        <SlotRow label="Bespoke and Curated Works" value={site.home_imprint_curated} onSave={(v) => saveSite("home_imprint_curated", v)} />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Testimonials (add / edit / reorder)</div>
                    <ListEditor
                        collectionKey="home_testimonials"
                        defaults={HOME_TESTIMONIALS_DEFAULT}
                        fields={[
                            { key: "quote", label: "Quote", type: "textarea" },
                            { key: "name", label: "Name" },
                            { key: "role", label: "Role / organisation" },
                        ]}
                        blank={{ quote: "", name: "", role: "" }}
                    />
                </PageGroup>

                <PageGroup title="Bookstore — Product Listing (PLP)" path="/books">
                    <p className="text-sm text-[#4B5563] mb-4">
                        Sort options, filters and the homepage carousel live in{" "}
                        <Link to="/admin/page-bookstore" className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]">Bookstore page settings</Link>.
                    </p>
                    <SlotRow label="Banner image" value={site.plp_banner} onSave={(v) => saveSite("plp_banner", v)} />
                    <div className="overline !text-[10px] mt-6 mb-2">Hero text (shown on the main bookstore landing)</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Overline" value={site.plp_hero_overline} onSave={(v) => saveSite("plp_hero_overline", v)} />
                        <TextSlotRow label="Headline (*word* = amber accent; line breaks allowed)" value={site.plp_hero_title} onSave={(v) => saveSite("plp_hero_title", v)} multiline />
                        <TextSlotRow label="Description" value={site.plp_hero_body} onSave={(v) => saveSite("plp_hero_body", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mt-6 mb-2">Category images</div>
                    <div className="space-y-3">
                        {cats.map((c) => (
                            <SlotRow key={c.id} label={c.name} value={c.image} onSave={(v) => saveCat(c.id, v)} />
                        ))}
                    </div>
                </PageGroup>

                <PageGroup title="Book pages — Product Detail (PDP)" path="/books/:id">
                    <p className="text-sm text-[#4B5563]">
                        Delivery copy, binding and size options live in{" "}
                        <Link to="/admin/page-book" className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]">Book page settings</Link>.
                        Each book's cover is set per title in{" "}
                        <Link to="/admin/books" className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]">Books</Link>{" "}
                        — upload it in the Media Library, copy the URL, and paste it into the book's cover field.
                    </p>
                </PageGroup>

                <PageGroup title="What We Do" path="/what-we-do">
                    <div className="overline !text-[10px] mb-2">Hero</div>
                    <div className="space-y-3">
                        <SlotRow label="Hero image (right-hand panel)" value={site.wwd_hero} onSave={(v) => saveSite("wwd_hero", v)} />
                        <TextSlotRow label="Overline" value={site.wwd_overline} onSave={(v) => saveSite("wwd_overline", v)} />
                        <TextSlotRow label="Title (line breaks allowed)" value={site.wwd_title} onSave={(v) => saveSite("wwd_title", v)} multiline />
                        <TextSlotRow label="Title highlight (red)" value={site.wwd_highlight} onSave={(v) => saveSite("wwd_highlight", v)} />
                        <TextSlotRow label="Intro paragraph" value={site.wwd_body} onSave={(v) => saveSite("wwd_body", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Vertical cards (add / edit / reorder)</div>
                    <PageCardsEditor collectionKey="page_verticals" iconOptions={["BookOpen", "Calendar", "Cpu", "GraduationCap"]} defaults={WWD_CARDS_DEFAULT} />
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Card images (by id — alternative to per-card upload)</div>
                    <div className="space-y-3">
                        <SlotRow label="Publishing" value={site["verticals_publishing"]} onSave={(v) => saveSite("verticals_publishing", v)} />
                        <SlotRow label="Events" value={site["verticals_events"]} onSave={(v) => saveSite("verticals_events", v)} />
                        <SlotRow label="Digital Solutions" value={site["verticals_digital-solutions"]} onSave={(v) => saveSite("verticals_digital-solutions", v)} />
                        <SlotRow label="Training & Certification" value={site["verticals_training"]} onSave={(v) => saveSite("verticals_training", v)} />
                    </div>
                </PageGroup>

                <PageGroup title="Digital Solutions" path="/digital-solutions">
                    <div className="overline !text-[10px] mb-2">Hero</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Eyebrow" value={site.ds_eyebrow} onSave={(v) => saveSite("ds_eyebrow", v)} />
                        <TextSlotRow label="Headline (line breaks allowed)" value={site.ds_headline} onSave={(v) => saveSite("ds_headline", v)} multiline />
                        <TextSlotRow label="Headline accent (amber)" value={site.ds_accent} onSave={(v) => saveSite("ds_accent", v)} />
                        <TextSlotRow label="Body paragraph" value={site.ds_body} onSave={(v) => saveSite("ds_body", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Hero stats</div>
                    <ListEditor collectionKey="page_ds_stats" defaults={DS_STATS_DEFAULT} fields={[{ key: "value", label: "Value (e.g. 500+)" }, { key: "label", label: "Label" }]} blank={{ value: "", label: "" }} />
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">“What’s coming” section</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Section kicker" value={site.ds_features_kicker} onSave={(v) => saveSite("ds_features_kicker", v)} />
                        <TextSlotRow label="Section headline (line breaks allowed)" value={site.ds_features_headline} onSave={(v) => saveSite("ds_features_headline", v)} multiline />
                    </div>
                    <div className="mt-4">
                        <ListEditor collectionKey="page_ds_features" defaults={DS_FEATURES_DEFAULT} iconOptions={["Sparkles", "Bot", "Database", "Cpu"]} fields={[{ key: "title", label: "Title" }, { key: "text", label: "Text", type: "textarea" }]} blank={{ icon: "Sparkles", title: "", text: "" }} />
                    </div>
                </PageGroup>

                <PageGroup title="Academy" path="/academy">
                    <div className="overline !text-[10px] mb-2">Hero</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Eyebrow" value={site.ac_eyebrow} onSave={(v) => saveSite("ac_eyebrow", v)} />
                        <TextSlotRow label="Headline (line breaks allowed)" value={site.ac_headline} onSave={(v) => saveSite("ac_headline", v)} multiline />
                        <TextSlotRow label="Headline accent (amber)" value={site.ac_accent} onSave={(v) => saveSite("ac_accent", v)} />
                        <TextSlotRow label="Body paragraph" value={site.ac_body} onSave={(v) => saveSite("ac_body", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Hero stats</div>
                    <ListEditor collectionKey="page_ac_stats" defaults={AC_STATS_DEFAULT} fields={[{ key: "value", label: "Value (e.g. 12+)" }, { key: "label", label: "Label" }]} blank={{ value: "", label: "" }} />
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">“What’s coming” section</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Section kicker" value={site.ac_features_kicker} onSave={(v) => saveSite("ac_features_kicker", v)} />
                        <TextSlotRow label="Section headline (line breaks allowed)" value={site.ac_features_headline} onSave={(v) => saveSite("ac_features_headline", v)} multiline />
                    </div>
                    <div className="mt-4">
                        <ListEditor collectionKey="page_ac_features" defaults={AC_FEATURES_DEFAULT} iconOptions={["MonitorPlay", "GraduationCap", "BookOpen", "Award"]} fields={[{ key: "title", label: "Title" }, { key: "text", label: "Text", type: "textarea" }]} blank={{ icon: "GraduationCap", title: "", text: "" }} />
                    </div>
                </PageGroup>

                <PageGroup title="Solutions" path="/solutions/:slug">
                    <div className="space-y-3">
                        <SlotRow label="For Schools" value={site["solutions_schools"]} onSave={(v) => saveSite("solutions_schools", v)} />
                        <SlotRow label="For Colleges" value={site["solutions_higher-ed"]} onSave={(v) => saveSite("solutions_higher-ed", v)} />
                        <SlotRow label="For Educators" value={site["solutions_educators"]} onSave={(v) => saveSite("solutions_educators", v)} />
                    </div>
                </PageGroup>

                <PageGroup title="About" path="/about">
                    <div className="overline !text-[10px] mb-2">Hero — wrap a word in *asterisks* to show it in red</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Overline" value={site.about_overline} onSave={(v) => saveSite("about_overline", v)} />
                        <TextSlotRow label="Headline (line breaks + *highlight*)" value={site.about_title} onSave={(v) => saveSite("about_title", v)} multiline />
                        <TextSlotRow label="Intro paragraph" value={site.about_body1} onSave={(v) => saveSite("about_body1", v)} multiline />
                        <TextSlotRow label="Second paragraph" value={site.about_body2} onSave={(v) => saveSite("about_body2", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Timeline</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Timeline overline" value={site.about_timeline_overline} onSave={(v) => saveSite("about_timeline_overline", v)} />
                        <TextSlotRow label="Timeline headline (line breaks allowed)" value={site.about_timeline_title} onSave={(v) => saveSite("about_timeline_title", v)} multiline />
                    </div>
                    <div className="mt-4">
                        <ListEditor collectionKey="page_about_milestones" defaults={ABOUT_MILESTONES_DEFAULT} fields={[{ key: "year", label: "Year" }, { key: "text", label: "Milestone text", type: "textarea" }]} blank={{ year: "", text: "" }} />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Management team</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Section overline" value={site.about_team_overline} onSave={(v) => saveSite("about_team_overline", v)} />
                        <TextSlotRow label="Section headline (line breaks + *highlight*)" value={site.about_team_title} onSave={(v) => saveSite("about_team_title", v)} multiline />
                    </div>
                    <div className="mt-4">
                        <ListEditor
                            collectionKey="page_about_team"
                            defaults={ABOUT_TEAM_DEFAULT}
                            fields={[
                                { key: "name", label: "Name" },
                                { key: "role", label: "Role (e.g. Co-Founder, Director)" },
                                { key: "photo", label: "Photo path or URL (e.g. /team/name.jpg)" },
                                { key: "bio", label: "Bio — blank line for a paragraph break", type: "textarea" },
                            ]}
                            blank={{ name: "", role: "", photo: "", bio: "" }}
                        />
                    </div>

                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Bottom columns (Careers · Press · Legal)</div>
                    <ListEditor collectionKey="page_about_columns" defaults={ABOUT_COLUMNS_DEFAULT} fields={[{ key: "overline", label: "Overline" }, { key: "title", label: "Title" }, { key: "text", label: "Text", type: "textarea" }, { key: "link_label", label: "Link label (leave blank for no link)" }, { key: "link_to", label: "Link target (/path)" }]} blank={{ overline: "", title: "", text: "", link_label: "", link_to: "/contact" }} />
                </PageGroup>

                <PageGroup title="Authors" path="/authors">
                    <div className="overline !text-[10px] mb-2">Hero</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Overline" value={site.authors_overline} onSave={(v) => saveSite("authors_overline", v)} />
                        <TextSlotRow label="Headline (line breaks allowed)" value={site.authors_title} onSave={(v) => saveSite("authors_title", v)} multiline />
                    </div>
                    <p className="text-xs text-[#4B5563] mt-4">
                        The author tiles themselves come from your author records — edit those in{" "}
                        <Link to="/admin/books" className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]">Admin → Books</Link>.
                    </p>
                </PageGroup>

                <PageGroup title="Events" path="/events">
                    <div className="overline !text-[10px] mb-2">Page section order</div>
                    <EventsSectionOrder />
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Flagship events (add / edit / reorder)</div>
                    <FlagshipEventsEditor />
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Page text (headings &amp; intros — *word* = accent)</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Hero — overline" value={site.events_hero_overline} onSave={(v) => saveSite("events_hero_overline", v)} />
                        <TextSlotRow label="Hero — heading" value={site.events_hero_title} onSave={(v) => saveSite("events_hero_title", v)} multiline />
                        <TextSlotRow label="Hero — intro" value={site.events_hero_body} onSave={(v) => saveSite("events_hero_body", v)} multiline />
                        <TextSlotRow label="Flagship — overline" value={site.events_flagship_overline} onSave={(v) => saveSite("events_flagship_overline", v)} />
                        <TextSlotRow label="Flagship — heading" value={site.events_flagship_title} onSave={(v) => saveSite("events_flagship_title", v)} multiline />
                        <TextSlotRow label="Flagship — intro" value={site.events_flagship_body} onSave={(v) => saveSite("events_flagship_body", v)} multiline />
                        <TextSlotRow label="Experience — overline" value={site.events_exp_overline} onSave={(v) => saveSite("events_exp_overline", v)} />
                        <TextSlotRow label="Experience — heading" value={site.events_exp_title} onSave={(v) => saveSite("events_exp_title", v)} multiline />
                        <TextSlotRow label="Summit Speakers — overline" value={site.events_summit_overline} onSave={(v) => saveSite("events_summit_overline", v)} />
                        <TextSlotRow label="Summit Speakers — heading" value={site.events_summit_title} onSave={(v) => saveSite("events_summit_title", v)} multiline />
                        <TextSlotRow label="Who Attends — overline" value={site.events_who_overline} onSave={(v) => saveSite("events_who_overline", v)} />
                        <TextSlotRow label="Who Attends — heading" value={site.events_who_title} onSave={(v) => saveSite("events_who_title", v)} multiline />
                        <TextSlotRow label="Who Attends — intro" value={site.events_who_body} onSave={(v) => saveSite("events_who_body", v)} multiline />
                        <TextSlotRow label="Vidhi Speakers — overline" value={site.events_vidhi_overline} onSave={(v) => saveSite("events_vidhi_overline", v)} />
                        <TextSlotRow label="Vidhi Speakers — heading" value={site.events_vidhi_title} onSave={(v) => saveSite("events_vidhi_title", v)} multiline />
                        <TextSlotRow label="Get Involved — overline" value={site.events_cta_overline} onSave={(v) => saveSite("events_cta_overline", v)} />
                        <TextSlotRow label="Get Involved — heading" value={site.events_cta_title} onSave={(v) => saveSite("events_cta_title", v)} multiline />
                        <TextSlotRow label="Get Involved — intro" value={site.events_cta_body} onSave={(v) => saveSite("events_cta_body", v)} multiline />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Flagship banners (also power the rotating hero)</div>
                    <div className="space-y-3">
                        <SlotRow label="Vidhi Utsav banner" value={site["events_vidhi_banner"]} onSave={(v) => saveSite("events_vidhi_banner", v)} />
                        <SlotRow label="India Law, AI & Tech Summit banner" value={site["events_summit_banner"]} onSave={(v) => saveSite("events_summit_banner", v)} />
                    </div>
                    <CollectionEditor label="Vidhi Utsav speakers" collectionKey="events_vidhi_speakers" />
                    <CollectionEditor label="Summit speakers" collectionKey="events_summit_speakers" />
                </PageGroup>

                <PageGroup title="Contact" path="/contact">
                    <div className="overline !text-[10px] mb-2">Page text</div>
                    <div className="space-y-3">
                        <TextSlotRow label="Overline" value={site.contact_overline} onSave={(v) => saveSite("contact_overline", v)} />
                        <TextSlotRow label="Heading" value={site.contact_title} onSave={(v) => saveSite("contact_title", v)} multiline />
                        <TextSlotRow label="Intro" value={site.contact_body} onSave={(v) => saveSite("contact_body", v)} multiline />
                    </div>
                    <p className="text-[11px] text-[#4B5563] mt-3">Direct-line emails are in <Link to="/admin/settings" className="text-[#002B5C] border-b border-[#002B5C]">Settings</Link>.</p>
                </PageGroup>

                <PageGroup title="Author Submissions" path="/submissions">
                    <div className="space-y-3">
                        <TextSlotRow label="Overline" value={site.sub_overline} onSave={(v) => saveSite("sub_overline", v)} />
                        <TextSlotRow label="Heading" value={site.sub_title} onSave={(v) => saveSite("sub_title", v)} multiline />
                        <TextSlotRow label="Intro" value={site.sub_body} onSave={(v) => saveSite("sub_body", v)} multiline />
                        <TextSlotRow label="'What we look for' — heading" value={site.sub_lookfor_title} onSave={(v) => saveSite("sub_lookfor_title", v)} />
                        <TextSlotRow label="'What we look for' — list (one item per line)" value={site.sub_lookfor_items} onSave={(v) => saveSite("sub_lookfor_items", v)} multiline />
                    </div>
                </PageGroup>

                <PageGroup title="Careers" path="/careers">
                    <p className="text-sm text-[#4B5563] mb-3">Open roles and applications are managed in <Link to="/admin/careers" className="text-[#002B5C] border-b border-[#002B5C]">Careers</Link>.</p>
                    <div className="space-y-3">
                        <TextSlotRow label="Overline" value={site.careers_overline} onSave={(v) => saveSite("careers_overline", v)} />
                        <TextSlotRow label="Heading" value={site.careers_title} onSave={(v) => saveSite("careers_title", v)} multiline />
                        <TextSlotRow label="Intro" value={site.careers_body} onSave={(v) => saveSite("careers_body", v)} multiline />
                    </div>
                </PageGroup>

                <PageGroup title="Media & Gallery" path="/media">
                    <p className="text-sm text-[#4B5563] mb-3">Photos and videos are managed in <Link to="/admin/media-gallery" className="text-[#002B5C] border-b border-[#002B5C]">Media &amp; Gallery</Link>.</p>
                    <div className="space-y-3">
                        <TextSlotRow label="Overline" value={site.media_overline} onSave={(v) => saveSite("media_overline", v)} />
                        <TextSlotRow label="Heading (*word* = accent)" value={site.media_title} onSave={(v) => saveSite("media_title", v)} multiline />
                        <TextSlotRow label="Intro" value={site.media_body} onSave={(v) => saveSite("media_body", v)} multiline />
                    </div>
                </PageGroup>
            </section>
        </div>
    );
}

function SectionVisibility() {
    const [hidden, setHidden] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings()
            .then((s) => setHidden(new Set(Array.isArray(s.hidden_sections) ? s.hidden_sections : [])))
            .catch(() => setHidden(new Set()));
    }, []);

    if (!hidden) return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;

    const toggle = (key) => {
        const next = new Set(hidden);
        if (next.has(key)) next.delete(key); else next.add(key);
        setHidden(next);
    };
    const save = async () => {
        setSaving(true);
        try {
            await adminSetSetting("hidden_sections", [...hidden]);
            toast.success("Visibility saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-[#E5E7EB] bg-white p-6 mb-8" data-testid="section-visibility">
            <div className="flex items-center justify-between">
                <h2 className="font-serif text-xl text-[#002B5C]">Section visibility</h2>
                <button onClick={save} disabled={saving} className="text-sm bg-[#002B5C] text-white px-4 py-1.5 hover:bg-[#001F42] disabled:opacity-60">
                    {saving ? "Saving…" : "Save visibility"}
                </button>
            </div>
            <p className="text-[11px] text-[#4B5563] mt-1">
                Hide any section from the live site without deleting it. Click the eye to toggle, then Save.
                Hidden sections keep their content and can be shown again anytime.
            </p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {SECTION_REGISTRY.map((group) => (
                    <div key={group.page}>
                        <div className="overline !text-[10px] mb-2">{group.page}</div>
                        <div className="space-y-1.5">
                            {group.items.map((it) => {
                                const isHidden = hidden.has(it.key);
                                return (
                                    <button
                                        key={it.key}
                                        onClick={() => toggle(it.key)}
                                        data-testid={`vis-${it.key}`}
                                        className={`w-full flex items-center gap-2 border px-3 py-1.5 text-sm text-left ${isHidden ? "border-[#E5E7EB] bg-[#F5F7FA] text-[#4B5563]" : "border-[#E5E7EB] bg-white text-[#002B5C]"}`}
                                    >
                                        {isHidden ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} className="text-[#002B5C]" />}
                                        <span className="flex-1">{it.label}</span>
                                        <span className="font-mono text-[10px] uppercase tracking-widest">{isHidden ? "Hidden" : "Shown"}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

const DEFAULT_FLAGSHIP = [
    {
        id: "vidhi-utsav",
        eyebrow: "An Oakbridge Initiative · 4th Edition",
        title: "Vidhi Utsav 2027",
        subtitle: "The Legal Literature Festival",
        tagline: "Kanoon aur Kala ka Utsav, ek Naye Rang Mein.",
        description:
            "A unique festival that celebrates Law, Legal Literature and Legal Luminaries — a confluence of eminent judges, jurists, writers, lawyers, corporate counsels, leaders and artists.",
        date: "Coming soon · Feb – Mar 2027",
        venue: "New Delhi",
        time: "Two-day premium festival",
        href: "https://www.vidhiutsav.com",
        cta: "Visit vidhiutsav.com",
        image: "",
        chips: ["Law", "Literature", "Luminaries", "Awards", "Music", "Comedy"],
    },
    {
        id: "law-ai-tech-summit",
        eyebrow: "An Oakbridge Initiative",
        title: "India Law, AI & Tech Summit",
        subtitle: "Forging the Future of Law, AI & Tech",
        tagline: "Where Law meets Innovation.",
        description:
            "India's premier annual forum for legal innovation — a dynamic experience designed for maximum engagement and unparalleled access, celebrating Law, AI & Tech pioneers, leaders and innovators.",
        date: "Coming soon · Next edition 2026",
        venue: "New Delhi",
        time: "Full-day premium summit",
        href: "https://www.oakbridge.events",
        cta: "Visit oakbridge.events",
        image: "",
        chips: ["Legal Tech", "AI", "Innovation", "Networking"],
    },
];


const EVENT_FIELDS = [
    { key: "eyebrow", label: "Eyebrow (small label above title)" },
    { key: "title", label: "Title" },
    { key: "subtitle", label: "Subtitle" },
    { key: "tagline", label: "Tagline (shown in quotes)" },
    { key: "date", label: "Dates" },
    { key: "venue", label: "Venue" },
    { key: "time", label: "Format" },
    { key: "cta", label: "Button label" },
    { key: "href", label: "Button link (URL)" },
];


const WWD_CARDS_DEFAULT = [
    { id: "publishing", icon: "BookOpen", kicker: "01 · Publishing", title: "Scholarly & Professional Books", lede: "Our flagship business — authoritative books across Academic, Law, Tax, Business, General, Coffee Table and Curated Works.", bullets: ["200+ titles across 5 publishing programs", "Distribution across India and 18 international markets", "Print, eBook and institutional licensing"], cta_label: "Browse the bookstore", cta_to: "/books", coming_soon: false, image: "" },
    { id: "events", icon: "Calendar", kicker: "02 · Events", title: "Forums, Launches & Conferences", lede: "Book launches, thought-leadership forums and policy roundtables — convening the scholars, practitioners and policymakers shaping India.", bullets: ["Flagship India Law Forum and annual Tax Conclave", "Intimate book launches with senior authors", "Curated meet-and-greet series with Supreme Court jurists"], cta_label: "Partner on an event", cta_to: "/contact", coming_soon: false, image: "" },
    { id: "digital-solutions", icon: "Cpu", kicker: "03 · Digital Solutions", title: "AI-Powered Knowledge Products", lede: "Next-generation digital platforms built on our scholarly content — semantic search, research assistants, subscription databases and institutional APIs.", bullets: ["Semantic search across our full legal and tax list", "AI research copilots for practitioners", "Licensed APIs for law firms, universities and fintechs"], cta_label: "Get early access", cta_to: "/contact", coming_soon: true, image: "" },
    { id: "training", icon: "GraduationCap", kicker: "04 · Training & Certification", title: "Programs for Practitioners", lede: "Training programmes, certification courses and in-house workshops — drawing from the same authors that write our books.", bullets: ["Programmes for Advocates and Chartered Accountants", "In-house workshops for law firms and corporates", "Certification tracks in Tax, Corporate Law and Governance"], cta_label: "See upcoming cohorts", cta_to: "/contact", coming_soon: false, image: "" },
];

// Generic list editor for simple repeating content (features, stats, sections…).

// Empty by design — Digital Solutions is a pure "coming soon" page for now.
// Add cards here when the offerings are ready to announce.
const DS_FEATURES_DEFAULT = [];

const DS_STATS_DEFAULT = [
    { value: "200+", label: "Titles indexed" },
    { value: "Q3", label: "Beta launch target" },
    { value: "Q4", label: "General availability" },
];

const HOME_TESTIMONIALS_DEFAULT = [
    { quote: "Oakbridge's commentaries are now the first reference on our shelves.", name: "Placeholder Name", role: "Designation, Organisation" },
    { quote: "Rigorous, current and genuinely practitioner-first — a rare combination in Indian legal publishing.", name: "Placeholder Name", role: "Designation, Organisation" },
    { quote: "Our faculty adopted three Oakbridge titles this year, and the students noticed the difference at once.", name: "Placeholder Name", role: "Designation, Organisation" },
    { quote: "The editorial quality stands with the best international houses, and the pricing makes it reachable.", name: "Placeholder Name", role: "Designation, Organisation" },
    { quote: "Clear, authoritative and beautifully produced — exactly what the profession needed.", name: "Placeholder Name", role: "Designation, Organisation" },
];

const AC_FEATURES_DEFAULT = [
    { icon: "MonitorPlay", title: "Self-paced e-learning programmes", text: "Structured online modules you can work through on your own schedule — built from the same practitioner-authors who write our reference titles." },
    { icon: "GraduationCap", title: "Certification tracks", text: "Multi-week certification programmes in Tax, Corporate Law, GST and Governance — taught by leading practitioners and our authors." },
    { icon: "BookOpen", title: "In-house workshops", text: "Bespoke training delivered on-site for law firms, in-house legal teams and corporates — built around your priorities." },
];

const AC_STATS_DEFAULT = [
    { value: "12+", label: "Tracks in development" },
    { value: "Online", label: "Self-paced & live" },
    { value: "Q4", label: "First cohort target" },
];


const ABOUT_TEAM_DEFAULT = [
    { id: "shreesh-chandra", name: "Shreesh Chandra", role: "Co-Founder, Director", photo: "/team/shreesh-chandra.jpg", bio: "" },
    { id: "vikesh-dhyani", name: "Vikesh Dhyani", role: "Co-Founder, Director", photo: "/team/vikesh-dhyani.jpg", bio: "" },
];

const ABOUT_MILESTONES_DEFAULT = [
    { year: "2017", text: "Oakbridge Publishing founded in New Delhi by two veteran publishing professionals with leadership experience at some of the world's most respected publishing houses." },
    { year: "2019", text: "First School list rolled out across 120 schools in four states." },
    { year: "2022", text: "Launch of the Higher Education and Professional lists — including our flagship Law and Tax titles." },
    { year: "2024", text: "Coffee Table & Curated Works imprints added, serving corporations, institutions and estates." },
    { year: "2025", text: "Oakbridge Digital — a companion platform for interactive learning — goes live." },
];

const ABOUT_COLUMNS_DEFAULT = [
    { id: "careers", overline: "Careers", title: "Join our list.", text: "We hire editors, designers, and field specialists who believe publishing is a craft of public service. Send us your work.", link_label: "careers@oakbridge.in", link_to: "/contact" },
    { id: "press", overline: "Press", title: "Media inquiries.", text: "For review copies, interviews with our authors or editorial briefings, reach out to our press team.", link_label: "press@oakbridge.in", link_to: "/contact" },
];


function FlagshipEventsEditor() {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    const norm = (arr) =>
        arr.map((it) => ({ ...it, chips: Array.isArray(it.chips) ? it.chips.join(", ") : it.chips || "" }));
    useEffect(() => {
        fetchCollection("events_flagship")
            .then((d) => setItems(norm(d?.items?.length ? d.items : DEFAULT_FLAGSHIP)))
            .catch(() => setItems(norm(DEFAULT_FLAGSHIP)));
    }, []);
    if (!items) return null;

    const update = (i, key, val) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
    const move = (i, dir) =>
        setItems((arr) => {
            const j = i + dir;
            if (j < 0 || j >= arr.length) return arr;
            const c = [...arr];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });
    const add = () =>
        setItems((arr) => [
            ...arr,
            { id: "event-" + Date.now(), eyebrow: "", title: "New event", subtitle: "", tagline: "", description: "", date: "", venue: "", time: "", href: "", cta: "Learn more", image: "", chips: "" },
        ]);
    const remove = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));
    const uploadImg = async (i, fileList) => {
        const file = Array.from(fileList || []).find((x) => x.type.startsWith("image/"));
        if (!file) return;
        try {
            const m = await adminUploadMedia(file);
            update(i, "image", m.url);
            toast.success("Image uploaded — click Save all to publish.");
        } catch {
            toast.error("Upload failed — object storage (S3) may not be configured.");
        }
    };
    const save = async () => {
        setSaving(true);
        try {
            const payload = items.map((it) => ({
                ...it,
                chips: String(it.chips || "").split(",").map((c) => c.trim()).filter(Boolean),
            }));
            await adminSaveCollection("events_flagship", payload);
            toast.success("Events saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <div className="overline !text-[10px]">Flagship events ({items.length})</div>
                    <p className="text-xs text-[#4B5563] mt-1">The top event shows first on the page — move the next upcoming event to the top.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]"><Plus size={12} strokeWidth={1.5} /> Add event</button>
                    <button onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">{saving ? "…" : "Save all"}</button>
                </div>
            </div>
            <div className="mt-4 space-y-4">
                {items.map((it, i) => (
                    <div key={i} className="border border-[#E5E7EB] bg-white p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="overline !text-[10px] !text-[#002B5C]">
                                #{i + 1}{i === 0 ? <span className="text-[#CC0033]"> · shows first</span> : null}
                            </div>
                            <div className="flex gap-1">
                                <button onClick={() => move(i, -1)} disabled={i === 0} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={12} /></button>
                                <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={12} /></button>
                                <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={12} /></button>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <label
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => { e.preventDefault(); uploadImg(i, e.dataTransfer.files); }}
                                title="Drag & drop or click to upload banner"
                                className="w-28 h-20 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden flex-shrink-0 cursor-pointer flex items-center justify-center"
                            >
                                {it.image ? <img src={mediaUrl(it.image)} alt="" className="w-full h-full object-cover" /> : <UploadCloud size={16} strokeWidth={1.5} className="text-[#4B5563]" />}
                                <input type="file" accept="image/*" onChange={(e) => uploadImg(i, e.target.files)} className="hidden" />
                            </label>
                            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {EVENT_FIELDS.slice(0, 4).map((fl) => (
                                    <input key={fl.key} value={it[fl.key] || ""} onChange={(e) => update(i, fl.key, e.target.value)} placeholder={fl.label} className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                                ))}
                            </div>
                        </div>
                        <textarea value={it.description || ""} onChange={(e) => update(i, "description", e.target.value)} placeholder="Description" rows={3} className="mt-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {EVENT_FIELDS.slice(4, 7).map((fl) => (
                                <input key={fl.key} value={it[fl.key] || ""} onChange={(e) => update(i, fl.key, e.target.value)} placeholder={fl.label} className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            ))}
                        </div>
                        <input value={it.chips || ""} onChange={(e) => update(i, "chips", e.target.value)} placeholder="Tags (comma-separated) — e.g. Law, AI, Innovation" className="mt-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {EVENT_FIELDS.slice(7).map((fl) => (
                                <input key={fl.key} value={it[fl.key] || ""} onChange={(e) => update(i, fl.key, e.target.value)} placeholder={fl.label} className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

