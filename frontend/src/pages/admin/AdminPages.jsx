import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UploadCloud, ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import { toast } from "sonner";
import {
    fetchSiteContent,
    adminSetSiteContent,
    fetchCategories,
    adminUpdateCategoryImage,
    fetchCollection,
    adminSaveCollection,
    adminUploadMedia,
    mediaUrl,
} from "../../lib/api";
import {
    PageGroup,
    SlotRow,
    TextSlotRow,
    PageCardsEditor,
    ListEditor,
    CollectionEditor,
} from "../../components/admin/ContentEditors";

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

            <section className="mt-10">
                <h2 className="font-serif text-2xl text-[#002B5C]">Storefront pages</h2>
                <p className="text-sm text-[#4B5563] mt-1 max-w-2xl">
                    Edit the copy, cards and images on each storefront page. Images can be dragged straight onto a slot, or pasted as a URL from the Media Library. Saves apply instantly.
                </p>

                <PageGroup title="Homepage" path="/">
                    <SlotRow label="Hero image" value={site.home_hero} onSave={(v) => saveSite("home_hero", v)} />
                    <div className="overline !text-[10px] mt-6 mb-2">Imprint tiles (Five Imprints section)</div>
                    <div className="space-y-3">
                        <SlotRow label="Coffee Table Books" value={site.home_imprint_coffee_table} onSave={(v) => saveSite("home_imprint_coffee_table", v)} />
                        <SlotRow label="Bespoke Books" value={site.home_imprint_curated} onSave={(v) => saveSite("home_imprint_curated", v)} />
                    </div>
                </PageGroup>

                <PageGroup title="Bookstore — Product Listing (PLP)" path="/books">
                    <p className="text-sm text-[#4B5563] mb-4">
                        Sort options, filters and the homepage carousel live in{" "}
                        <Link to="/admin/page-bookstore" className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]">Bookstore page settings</Link>.
                    </p>
                    <SlotRow label="Banner image" value={site.plp_banner} onSave={(v) => saveSite("plp_banner", v)} />
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
                        <ListEditor collectionKey="page_ac_features" defaults={AC_FEATURES_DEFAULT} iconOptions={["GraduationCap", "BadgeCheck", "BookOpen", "Award"]} fields={[{ key: "title", label: "Title" }, { key: "text", label: "Text", type: "textarea" }]} blank={{ icon: "GraduationCap", title: "", text: "" }} />
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
                    <FlagshipEventsEditor />
                    <div className="overline !text-[10px] mb-2 mt-8 pt-8 border-t border-[#E5E7EB]">Flagship banners (also power the rotating hero)</div>
                    <div className="space-y-3">
                        <SlotRow label="Vidhi Utsav banner" value={site["events_vidhi_banner"]} onSave={(v) => saveSite("events_vidhi_banner", v)} />
                        <SlotRow label="India Law, AI & Tech Summit banner" value={site["events_summit_banner"]} onSave={(v) => saveSite("events_summit_banner", v)} />
                    </div>
                    <CollectionEditor label="Vidhi Utsav speakers" collectionKey="events_vidhi_speakers" />
                    <CollectionEditor label="Summit speakers" collectionKey="events_summit_speakers" />
                </PageGroup>
            </section>
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
    { id: "publishing", icon: "BookOpen", kicker: "01 · Publishing", title: "Scholarly & Professional Books", lede: "Our flagship business — authoritative books across Academic, Law, Tax, Business, General, Coffee Table and Curated Works.", bullets: ["500+ titles across 5 publishing programs", "Distribution across India and 18 international markets", "Print, eBook and institutional licensing"], cta_label: "Browse the bookstore", cta_to: "/books", coming_soon: false, image: "" },
    { id: "events", icon: "Calendar", kicker: "02 · Events", title: "Forums, Launches & Conferences", lede: "Book launches, thought-leadership forums and policy roundtables — convening the scholars, practitioners and policymakers shaping India.", bullets: ["Flagship India Law Forum and annual Tax Conclave", "Intimate book launches with senior authors", "Curated meet-and-greet series with Supreme Court jurists"], cta_label: "Partner on an event", cta_to: "/contact", coming_soon: false, image: "" },
    { id: "digital-solutions", icon: "Cpu", kicker: "03 · Digital Solutions", title: "AI-Powered Knowledge Products", lede: "Next-generation digital platforms built on our scholarly content — semantic search, research assistants, subscription databases and institutional APIs.", bullets: ["Semantic search across 500+ legal and tax titles", "AI research copilots for practitioners", "Licensed APIs for law firms, universities and fintechs"], cta_label: "Get early access", cta_to: "/contact", coming_soon: true, image: "" },
    { id: "training", icon: "GraduationCap", kicker: "04 · Training & Certification", title: "Programs for Practitioners", lede: "CPD-accredited training programs, certification courses and in-house workshops — drawing from the same authors that write our books.", bullets: ["Advocate and Chartered Accountant CPD programmes", "In-house workshops for law firms and corporates", "Certification tracks in Tax, Corporate Law and Governance"], cta_label: "See upcoming cohorts", cta_to: "/contact", coming_soon: false, image: "" },
];

// Generic list editor for simple repeating content (features, stats, sections…).

const DS_FEATURES_DEFAULT = [
    { icon: "Sparkles", title: "Semantic search", text: "Ask plain-English questions across 500+ of our scholarly titles, with verified citations to the page." },
    { icon: "Bot", title: "AI research copilots", text: "Practitioner-grade assistants for Tax, Corporate Law, M&A and GST research — grounded in Oakbridge sources only." },
    { icon: "Database", title: "Licensed APIs", text: "Stream our editorial taxonomy, abstracts and commentary into your firm's research stack." },
];

const DS_STATS_DEFAULT = [
    { value: "500+", label: "Titles indexed" },
    { value: "Q3", label: "Beta launch target" },
    { value: "Q4", label: "General availability" },
];

const AC_FEATURES_DEFAULT = [
    { icon: "GraduationCap", title: "Certification tracks", text: "Multi-week certification programmes in Tax, Corporate Law, GST and Governance — taught by leading practitioners and our authors." },
    { icon: "BadgeCheck", title: "CPD-accredited programmes", text: "Continuing Professional Development credits for Advocates, Chartered Accountants and Company Secretaries." },
    { icon: "BookOpen", title: "In-house workshops", text: "Bespoke training delivered on-site for law firms, in-house legal teams and corporates — built around your priorities." },
];

const AC_STATS_DEFAULT = [
    { value: "12+", label: "Tracks in development" },
    { value: "CPD", label: "Accredited" },
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
    { id: "legal", overline: "Legal", title: "The fine print.", text: "Oakbridge Publishing Pvt. Ltd. — GSTIN 06AACCO5406D1ZW · Office: B3 Tower, Spaze iTech Park, 934, Sohna–Gurgaon Rd, Sector 49, Gurugram, Haryana 122018.", link_label: "", link_to: "" },
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

