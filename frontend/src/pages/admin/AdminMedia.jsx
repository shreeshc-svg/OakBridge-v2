import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { UploadCloud, Trash2, Copy, ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import { toast } from "sonner";
import {
    adminListMedia,
    adminUploadMedia,
    adminDeleteMedia,
    fetchSiteContent,
    adminSetSiteContent,
    fetchCategories,
    adminUpdateCategoryImage,
    fetchCollection,
    adminSaveCollection,
    mediaUrl,
} from "../../lib/api";

export default function AdminMedia() {
    const [media, setMedia] = useState([]);
    const [cats, setCats] = useState([]);
    const [site, setSite] = useState({});
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef(null);

    const load = () => {
        adminListMedia().then(setMedia).catch(() => {});
        fetchCategories().then(setCats).catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
    };
    useEffect(load, []);

    const uploadFiles = async (fileList) => {
        const imgs = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return;
        setUploading(true);
        let ok = 0;
        for (const f of imgs) {
            try {
                const m = await adminUploadMedia(f);
                setMedia((prev) => [m, ...prev]);
                ok += 1;
            } catch {
                /* keep going */
            }
        }
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
        if (ok) toast.success(`${ok} image${ok > 1 ? "s" : ""} uploaded.`);
        else toast.error("Upload failed — object storage (S3) may not be configured yet.");
    };
    const onPick = (e) => uploadFiles(e.target.files);
    const onDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        uploadFiles(e.dataTransfer.files);
    };
    const onDelete = async (id) => {
        try {
            await adminDeleteMedia(id);
            setMedia((p) => p.filter((m) => m.id !== id));
            toast.success("Removed from library.");
        } catch {
            toast.error("Could not delete.");
        }
    };
    const copy = (u) => {
        navigator.clipboard?.writeText(mediaUrl(u));
        toast.success("URL copied to clipboard.");
    };
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
        <div data-testid="admin-media-page">
            <div className="overline">Content</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Media</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Master media library and site-wide image placements. Upload once, use anywhere —
                changes go live immediately.
            </p>

            {/* MASTER LIBRARY */}
            <section className="mt-10">
                <h2 className="font-serif text-2xl text-[#002B5C]">Media library ({media.length})</h2>
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    data-testid="media-dropzone"
                    className={`mt-4 border-2 border-dashed p-10 text-center transition-colors ${
                        dragOver ? "border-[#002B5C] bg-[#F5F7FA]" : "border-[#E5E7EB] bg-white"
                    }`}
                >
                    <UploadCloud size={28} strokeWidth={1.5} className="mx-auto text-[#4B5563]" />
                    <p className="mt-3 text-sm text-[#002B5C] font-medium">
                        {uploading ? "Uploading…" : "Drag & drop images here"}
                    </p>
                    <p className="text-xs text-[#4B5563] mt-1">
                        or{" "}
                        <label className="text-[#002B5C] border-b border-[#002B5C] cursor-pointer hover:text-[#CC0033]">
                            browse your files
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={onPick}
                                className="hidden"
                                data-testid="media-upload-input"
                            />
                        </label>
                    </p>
                    <p className="text-[11px] text-[#4B5563]/70 mt-2 font-mono">PNG · JPG · WEBP — up to 10 MB each</p>
                </div>

                {media.length > 0 && (
                    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {media.map((m) => (
                            <div key={m.id} data-testid={`media-${m.id}`} className="border border-[#E5E7EB] bg-white">
                                <div className="aspect-[4/3] bg-[#F5F7FA] overflow-hidden">
                                    <img src={mediaUrl(m.url)} alt={m.alt || m.filename} className="w-full h-full object-cover" loading="lazy" />
                                </div>
                                <div className="px-2 py-1.5">
                                    <div className="text-[11px] text-[#4B5563] truncate" title={m.filename}>{m.filename || "image"}</div>
                                    <div className="flex items-center justify-between gap-2 mt-1">
                                        <button onClick={() => copy(m.url)} className="inline-flex items-center gap-1 text-xs text-[#002B5C] hover:text-[#CC0033]">
                                            <Copy size={12} strokeWidth={1.5} /> Copy URL
                                        </button>
                                        <button onClick={() => onDelete(m.id)} className="text-[#CC0033] hover:opacity-70 p-1" aria-label="Delete">
                                            <Trash2 size={14} strokeWidth={1.5} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* PLACEMENTS BY PAGE */}
            <section className="mt-16 border-t border-[#E5E7EB] pt-12">
                <h2 className="font-serif text-2xl text-[#002B5C]">Place media on pages</h2>
                <p className="text-sm text-[#4B5563] mt-1 max-w-2xl">
                    Paste an image URL (copy one from the library above), or any external URL. Saves apply to the live storefront instantly.
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
                        Each book's cover is set per title in{" "}
                        <Link to="/admin/books" className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033]">Admin → Books</Link>.
                        Upload an image above, copy its URL, and paste it into the book's cover field.
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

function PageGroup({ title, path, children }) {
    return (
        <div className="mt-8 border border-[#E5E7EB] bg-white p-6">
            <div className="flex items-baseline gap-3">
                <h3 className="font-serif text-xl text-[#002B5C]">{title}</h3>
                <span className="font-mono text-[11px] text-[#4B5563]">{path}</span>
            </div>
            <div className="mt-4">{children}</div>
        </div>
    );
}

function SlotRow({ label, value, onSave }) {
    const [val, setVal] = useState(value || "");
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef(null);
    useEffect(() => setVal(value || ""), [value]);
    const changed = (val || "") !== (value || "");
    const save = async (override) => {
        const next = ((override ?? val) || "").trim();
        setSaving(true);
        try {
            await onSave(next);
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };
    const handleFiles = async (fileList) => {
        const f = Array.from(fileList || []).find((x) => x.type.startsWith("image/"));
        if (!f) return;
        setUploading(true);
        try {
            const m = await adminUploadMedia(f);
            setVal(m.url);
            await save(m.url); // auto-save this slot to the freshly uploaded image
        } catch {
            toast.error("Upload failed — object storage (S3) may not be configured yet.");
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };
    return (
        <div className="flex items-center gap-4 border border-[#E5E7EB] bg-white p-3">
            <label
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFiles(e.dataTransfer.files);
                }}
                title="Drag & drop an image here, or click to upload"
                className={`relative w-24 h-16 bg-[#F5F7FA] border overflow-hidden flex-shrink-0 cursor-pointer flex items-center justify-center ${
                    dragOver ? "border-[#002B5C] border-dashed bg-[#F5F7FA]" : "border-[#E5E7EB]"
                }`}
            >
                {val ? (
                    <img src={mediaUrl(val)} alt="" className="w-full h-full object-cover" />
                ) : (
                    <UploadCloud size={16} strokeWidth={1.5} className="text-[#4B5563]" />
                )}
                {uploading && (
                    <div className="absolute inset-0 bg-white/75 flex items-center justify-center text-[10px] font-medium text-[#002B5C]">
                        Uploading…
                    </div>
                )}
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFiles(e.target.files)}
                    className="hidden"
                />
            </label>
            <div className="flex-1 min-w-0">
                <div className="overline !text-[10px]">{label}</div>
                <input
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    placeholder="Drag an image onto the thumbnail, or paste a URL"
                    className="mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]"
                />
            </div>
            <button onClick={() => save()} disabled={!changed || saving} className="text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] disabled:opacity-40 flex-shrink-0">
                {saving ? "…" : "Save"}
            </button>
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

function TextSlotRow({ label, value, onSave, multiline }) {
    const [val, setVal] = useState(value || "");
    const [saving, setSaving] = useState(false);
    useEffect(() => setVal(value || ""), [value]);
    const changed = (val || "") !== (value || "");
    const save = async () => {
        setSaving(true);
        try {
            await onSave((val || "").trim());
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="flex items-start gap-3 border border-[#E5E7EB] bg-white p-3">
            <div className="flex-1 min-w-0">
                <div className="overline !text-[10px]">{label}</div>
                {multiline ? (
                    <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3} className="mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                ) : (
                    <input value={val} onChange={(e) => setVal(e.target.value)} className="mt-1 w-full border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]" />
                )}
            </div>
            <button onClick={save} disabled={!changed || saving} className="mt-5 text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA] disabled:opacity-40 flex-shrink-0">
                {saving ? "…" : "Save"}
            </button>
        </div>
    );
}

// Reusable editor for "hero + cards" storefront pages (What We Do, Digital Solutions, Academy…).
function PageCardsEditor({ collectionKey, iconOptions = [], defaults = [] }) {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    const norm = (arr) =>
        arr.map((it) => ({ ...it, bullets: Array.isArray(it.bullets) ? it.bullets.join("\n") : it.bullets || "" }));
    useEffect(() => {
        fetchCollection(collectionKey)
            .then((d) => setItems(norm(d?.items?.length ? d.items : defaults)))
            .catch(() => setItems(norm(defaults)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionKey]);
    if (!items) return null;

    const update = (i, k, v) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
    const move = (i, dir) =>
        setItems((a) => {
            const j = i + dir;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });
    const add = () =>
        setItems((a) => [
            ...a,
            { id: "card-" + Date.now(), icon: iconOptions[0] || "", kicker: "", title: "New card", lede: "", bullets: "", cta_label: "Learn more", cta_to: "/contact", coming_soon: false, image: "" },
        ]);
    const remove = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
    const uploadImg = async (i, fileList) => {
        const file = Array.from(fileList || []).find((x) => x.type.startsWith("image/"));
        if (!file) return;
        try {
            const m = await adminUploadMedia(file);
            update(i, "image", m.url);
            toast.success("Image uploaded — click Save cards.");
        } catch {
            toast.error("Upload failed — object storage (S3) may not be configured.");
        }
    };
    const save = async () => {
        setSaving(true);
        try {
            const payload = items.map((it) => ({
                ...it,
                bullets: String(it.bullets || "").split("\n").map((b) => b.trim()).filter(Boolean),
                coming_soon: !!it.coming_soon,
            }));
            await adminSaveCollection(collectionKey, payload);
            toast.success("Cards saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-[#4B5563]">Reorder with the arrows — order here is the order on the page.</p>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]"><Plus size={12} strokeWidth={1.5} /> Add card</button>
                    <button onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">{saving ? "…" : "Save cards"}</button>
                </div>
            </div>
            <div className="mt-4 space-y-4">
                {items.map((it, i) => (
                    <div key={i} className="border border-[#E5E7EB] bg-white p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="overline !text-[10px] !text-[#002B5C]">#{i + 1}</div>
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
                                title="Drag & drop or click to upload"
                                className="w-28 h-20 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden flex-shrink-0 cursor-pointer flex items-center justify-center"
                            >
                                {it.image ? <img src={mediaUrl(it.image)} alt="" className="w-full h-full object-cover" /> : <UploadCloud size={16} strokeWidth={1.5} className="text-[#4B5563]" />}
                                <input type="file" accept="image/*" onChange={(e) => uploadImg(i, e.target.files)} className="hidden" />
                            </label>
                            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input value={it.kicker || ""} onChange={(e) => update(i, "kicker", e.target.value)} placeholder="Kicker (e.g. 01 · Publishing)" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                                <input value={it.title || ""} onChange={(e) => update(i, "title", e.target.value)} placeholder="Title" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            </div>
                        </div>
                        <textarea value={it.lede || ""} onChange={(e) => update(i, "lede", e.target.value)} placeholder="Description" rows={2} className="mt-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <textarea value={it.bullets || ""} onChange={(e) => update(i, "bullets", e.target.value)} placeholder="Bullet points — one per line" rows={3} className="mt-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {iconOptions.length > 0 && (
                                <select value={it.icon || ""} onChange={(e) => update(i, "icon", e.target.value)} className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]">
                                    {iconOptions.map((ic) => (<option key={ic} value={ic}>{ic}</option>))}
                                </select>
                            )}
                            <input value={it.cta_label || ""} onChange={(e) => update(i, "cta_label", e.target.value)} placeholder="Button label" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            <input value={it.cta_to || ""} onChange={(e) => update(i, "cta_to", e.target.value)} placeholder="Button link (/path)" className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm font-mono outline-none focus:border-[#002B5C]" />
                        </div>
                        <label className="mt-2 inline-flex items-center gap-2 text-sm text-[#4B5563]">
                            <input type="checkbox" checked={!!it.coming_soon} onChange={(e) => update(i, "coming_soon", e.target.checked)} />
                            Show “Coming Soon” badge
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
}

const WWD_CARDS_DEFAULT = [
    { id: "publishing", icon: "BookOpen", kicker: "01 · Publishing", title: "Scholarly & Professional Books", lede: "Our flagship business — authoritative books across Academic, Law, Tax, Business, General, Coffee Table and Curated Works.", bullets: ["500+ titles across 5 publishing programs", "Distribution across India and 18 international markets", "Print, eBook and institutional licensing"], cta_label: "Browse the bookstore", cta_to: "/books", coming_soon: false, image: "" },
    { id: "events", icon: "Calendar", kicker: "02 · Events", title: "Forums, Launches & Conferences", lede: "Book launches, thought-leadership forums and policy roundtables — convening the scholars, practitioners and policymakers shaping India.", bullets: ["Flagship India Law Forum and annual Tax Conclave", "Intimate book launches with senior authors", "Curated meet-and-greet series with Supreme Court jurists"], cta_label: "Partner on an event", cta_to: "/contact", coming_soon: false, image: "" },
    { id: "digital-solutions", icon: "Cpu", kicker: "03 · Digital Solutions", title: "AI-Powered Knowledge Products", lede: "Next-generation digital platforms built on our scholarly content — semantic search, research assistants, subscription databases and institutional APIs.", bullets: ["Semantic search across 500+ legal and tax titles", "AI research copilots for practitioners", "Licensed APIs for law firms, universities and fintechs"], cta_label: "Get early access", cta_to: "/contact", coming_soon: true, image: "" },
    { id: "training", icon: "GraduationCap", kicker: "04 · Training & Certification", title: "Programs for Practitioners", lede: "CPD-accredited training programs, certification courses and in-house workshops — drawing from the same authors that write our books.", bullets: ["Advocate and Chartered Accountant CPD programmes", "In-house workshops for law firms and corporates", "Certification tracks in Tax, Corporate Law and Governance"], cta_label: "See upcoming cohorts", cta_to: "/contact", coming_soon: false, image: "" },
];

// Generic list editor for simple repeating content (features, stats, sections…).
function ListEditor({ collectionKey, defaults = [], fields = [], iconOptions = [], blank = {} }) {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        fetchCollection(collectionKey)
            .then((d) => setItems(d?.items?.length ? d.items : defaults))
            .catch(() => setItems(defaults));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionKey]);
    if (!items) return null;

    const update = (i, k, v) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
    const move = (i, dir) =>
        setItems((a) => {
            const j = i + dir;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });
    const add = () => setItems((a) => [...a, { ...blank }]);
    const remove = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
    const save = async () => {
        setSaving(true);
        try {
            await adminSaveCollection(collectionKey, items);
            toast.success("Saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-[#4B5563]">Order here is the order on the page.</p>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]"><Plus size={12} strokeWidth={1.5} /> Add</button>
                    <button onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">{saving ? "…" : "Save"}</button>
                </div>
            </div>
            <div className="mt-3 space-y-2">
                {items.map((it, i) => (
                    <div key={i} className="border border-[#E5E7EB] bg-white p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="overline !text-[10px] !text-[#002B5C]">#{i + 1}</div>
                            <div className="flex gap-1">
                                <button onClick={() => move(i, -1)} disabled={i === 0} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={12} /></button>
                                <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={12} /></button>
                                <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={12} /></button>
                            </div>
                        </div>
                        {iconOptions.length > 0 && (
                            <select value={it.icon || ""} onChange={(e) => update(i, "icon", e.target.value)} className="mb-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]">
                                {iconOptions.map((ic) => (<option key={ic} value={ic}>{ic}</option>))}
                            </select>
                        )}
                        {fields.map((fl) =>
                            fl.type === "textarea" ? (
                                <textarea key={fl.key} value={it[fl.key] || ""} onChange={(e) => update(i, fl.key, e.target.value)} placeholder={fl.label} rows={2} className="mb-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            ) : (
                                <input key={fl.key} value={it[fl.key] || ""} onChange={(e) => update(i, fl.key, e.target.value)} placeholder={fl.label} className="mb-2 w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                            ),
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

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

const SPEAKER_FIELDS = [
    { key: "name", label: "Name" },
    { key: "role", label: "Role / title" },
    { key: "photo", label: "Photo URL" },
];

function CollectionEditor({ label, collectionKey }) {
    const [items, setItems] = useState([]);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        fetchCollection(collectionKey).then((d) => setItems(d.items || [])).catch(() => {});
    }, [collectionKey]);

    const update = (i, key, val) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
    const add = () => setItems((arr) => [...arr, { name: "", role: "", photo: "" }]);
    const remove = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));
    const move = (i, dir) =>
        setItems((arr) => {
            const j = i + dir;
            if (j < 0 || j >= arr.length) return arr;
            const copy = [...arr];
            [copy[i], copy[j]] = [copy[j], copy[i]];
            return copy;
        });
    const save = async () => {
        setSaving(true);
        try {
            await adminSaveCollection(collectionKey, items);
            toast.success(`${label} saved.`);
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between">
                <div className="overline !text-[10px]">{label} ({items.length})</div>
                <div className="flex gap-2">
                    <button onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1 hover:bg-[#F5F7FA]">
                        <Plus size={12} strokeWidth={1.5} /> Add
                    </button>
                    <button onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">
                        {saving ? "…" : "Save all"}
                    </button>
                </div>
            </div>
            <div className="mt-3 space-y-3">
                {items.map((it, i) => (
                    <div key={i} className="flex items-start gap-3 border border-[#E5E7EB] bg-white p-3">
                        <div className="w-16 h-16 bg-[#F5F7FA] border border-[#E5E7EB] overflow-hidden flex-shrink-0">
                            {it.photo ? <img src={mediaUrl(it.photo)} alt="" className="w-full h-full object-cover" /> : null}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                            {SPEAKER_FIELDS.map((f) => (
                                <input
                                    key={f.key}
                                    value={it[f.key] || ""}
                                    onChange={(e) => update(i, f.key, e.target.value)}
                                    placeholder={f.label}
                                    className="w-full border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]"
                                />
                            ))}
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                            <button onClick={() => move(i, -1)} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA]" aria-label="Move up"><ArrowUp size={12} /></button>
                            <button onClick={() => move(i, 1)} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA]" aria-label="Move down"><ArrowDown size={12} /></button>
                            <button onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={12} /></button>
                        </div>
                    </div>
                ))}
                {items.length === 0 && <p className="text-sm text-[#4B5563]">No entries. Click "Add" to create one.</p>}
            </div>
        </div>
    );
}
