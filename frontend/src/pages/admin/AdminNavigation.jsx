import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, X, Plus, Eye, EyeOff } from "lucide-react";
import {
    fetchSiteContent,
    adminSetSiteContent,
    fetchCollection,
    adminSaveCollection,
} from "../../lib/api";
import { TextSlotRow, ListEditor } from "../../components/admin/ContentEditors";
import CONTENT_DEFAULTS from "../../lib/contentDefaults";
import { SOCIAL_PLATFORMS, socialIcon, DEFAULT_SOCIALS } from "../../lib/socials";

const DEFAULT_NAV = [
    { to: "/what-we-do", label: "What We Do", hidden: false },
    { to: "/books", label: "Bookstore", hidden: false },
    { to: "/events", label: "Events", hidden: false },
    { to: "/academy", label: "Academy", hidden: false },
    { to: "/digital-solutions", label: "Digital Solutions", hidden: false },
    { to: "/authors", label: "Authors", hidden: false },
    { to: "/media", label: "Media", hidden: false },
    { to: "/about", label: "About", hidden: false },
];

const DEFAULT_FOOTER_COLUMNS = [
    {
        title: "Shop",
        links: [
            { to: "/books?category=law", label: "Law" },
            { to: "/books?category=tax", label: "Taxation" },
            { to: "/books?category=business", label: "Business & Management" },
            { to: "/books?category=academic", label: "Academic" },
            { to: "/books?category=general-reference", label: "General & Reference" },
        ],
    },
    {
        title: "Verticals",
        links: [
            { to: "/what-we-do", label: "Publishing" },
            { to: "/what-we-do#events", label: "Events" },
            { to: "/digital-solutions", label: "Digital Solutions" },
            { to: "/academy", label: "Training & Certification" },
            { to: "/submissions", label: "Author Submissions" },
        ],
    },
    {
        title: "Solutions",
        links: [
            { to: "/solutions/schools", label: "For Schools" },
            { to: "/solutions/higher-ed", label: "For Colleges" },
            { to: "/solutions/educators", label: "For Educators" },
            { to: "/submissions", label: "Author Submissions" },
            { to: "/contact", label: "Contact Sales" },
        ],
    },
    {
        title: "Company",
        links: [
            { to: "/about", label: "Our Story" },
            { to: "/authors", label: "Authors" },
            { to: "/contact", label: "Contact" },
            { to: "/about#careers", label: "Careers" },
            { to: "/about#press", label: "Press" },
        ],
    },
];

const DEFAULT_LEGAL = [
    { to: "/privacy", label: "Privacy" },
    { to: "/terms", label: "Terms" },
    { to: "/shipping-policy", label: "Shipping" },
    { to: "/cookie-policy", label: "Cookies" },
    { to: "/contact", label: "Contact" },
];

/* ------------------------------- Header menu ------------------------------ */

function HeaderNavEditor() {
    const [items, setItems] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        fetchCollection("site_nav")
            .then((d) => setItems(d?.items?.length ? d.items : DEFAULT_NAV))
            .catch(() => setItems(DEFAULT_NAV));
    }, []);
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
    const add = () => setItems((a) => [...a, { label: "New link", to: "/", hidden: false }]);
    const remove = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
    const save = async () => {
        setSaving(true);
        try {
            const payload = items
                .map((it) => ({ label: (it.label || "").trim(), to: (it.to || "").trim(), hidden: !!it.hidden }))
                .filter((it) => it.label && it.to);
            await adminSaveCollection("site_nav", payload);
            toast.success("Header menu saved — live on the site.");
        } catch {
            toast.error("Could not save the header menu.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-[#E5E7EB] bg-white p-6" data-testid="header-nav-editor">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="font-serif text-xl text-[#002B5C]">Header menu</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Rename, reorder, hide or add the links in the top menu. Use internal paths like{" "}
                        <span className="font-mono">/about</span>. Order here = order on the site.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1.5 hover:bg-[#F5F7FA]">
                        <Plus size={12} strokeWidth={1.5} /> Add link
                    </button>
                    <button type="button" onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA] disabled:opacity-40">
                        {saving ? "…" : "Save menu"}
                    </button>
                </div>
            </div>
            <div className="mt-4 space-y-2">
                {items.map((it, i) => (
                    <div key={i} className={`flex items-center gap-2 border border-[#E5E7EB] p-2 ${it.hidden ? "bg-[#F5F7FA] opacity-70" : "bg-white"}`}>
                        <div className="flex flex-col">
                            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="border border-[#E5E7EB] p-0.5 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move up"><ArrowUp size={11} /></button>
                            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="border border-[#E5E7EB] p-0.5 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move down"><ArrowDown size={11} /></button>
                        </div>
                        <input value={it.label || ""} onChange={(e) => update(i, "label", e.target.value)} placeholder="Label" className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]" />
                        <input value={it.to || ""} onChange={(e) => update(i, "to", e.target.value)} placeholder="/path" className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm font-mono outline-none focus:border-[#002B5C]" />
                        <button type="button" onClick={() => update(i, "hidden", !it.hidden)} title={it.hidden ? "Hidden — click to show" : "Visible — click to hide"} className="border border-[#E5E7EB] p-1.5 hover:bg-[#F5F7FA]">
                            {it.hidden ? <EyeOff size={14} strokeWidth={1.5} className="text-[#4B5563]" /> : <Eye size={14} strokeWidth={1.5} className="text-[#002B5C]" />}
                        </button>
                        <button type="button" onClick={() => remove(i)} className="border border-[#CC0033] text-[#CC0033] p-1.5 hover:bg-[#CC0033]/5" aria-label="Remove"><X size={14} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ---------------------------- Footer social links -------------------------- */

function FooterSocialsEditor() {
    const [rows, setRows] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchCollection("site_footer_socials")
            .then((d) => setRows(d?.items?.length ? d.items : DEFAULT_SOCIALS))
            .catch(() => setRows(DEFAULT_SOCIALS));
    }, []);
    if (!rows) return null;

    const set = (i, patch) => setRows((a) => a.map((r, x) => (x === i ? { ...r, ...patch } : r)));
    const add = () => setRows((a) => [...a, { platform: "linkedin", url: "", enabled: true }]);
    const remove = (i) => setRows((a) => a.filter((_, x) => x !== i));
    const move = (i, dir) =>
        setRows((a) => {
            const j = i + dir;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });

    const save = async () => {
        setSaving(true);
        try {
            /*
             * Saved with the URL trimmed but NOT dropped when empty.
             *
             * A blank row is a platform the admin has set up and not yet found
             * the address for; discarding it on save would delete their work
             * and make the editor feel like it was fighting them. The footer
             * decides what to show — an entry without a URL renders nothing —
             * so an incomplete row is harmless here and useful to keep.
             */
            const payload = rows
                .map((r) => ({
                    platform: String(r.platform || "").trim().toLowerCase(),
                    url: String(r.url || "").trim(),
                    enabled: r.enabled !== false,
                }))
                .filter((r) => r.platform);
            await adminSaveCollection("site_footer_socials", payload);
            toast.success("Social links saved — live on the site.");
        } catch {
            toast.error("Could not save the social links.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-[#E5E7EB] bg-white p-6" data-testid="footer-socials-editor">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="font-serif text-xl text-[#002B5C]">Footer social links</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Shown under the newsletter sign-up. A row with no address stays hidden on
                        the site, so you can add the platform now and paste the link later.
                    </p>
                </div>
                <button
                    onClick={save}
                    disabled={saving}
                    data-testid="save-footer-socials"
                    className="text-sm bg-[#002B5C] text-white px-4 py-1.5 hover:bg-[#001F42] disabled:opacity-60"
                >
                    {saving ? "Saving…" : "Save changes"}
                </button>
            </div>

            <div className="mt-5 space-y-2">
                {rows.map((r, i) => {
                    const Icon = socialIcon(r.platform);
                    const known = SOCIAL_PLATFORMS.find((p) => p.key === r.platform);
                    return (
                        <div
                            key={i}
                            data-testid={`footer-social-row-${i}`}
                            className={`flex flex-wrap items-center gap-2 border border-[#E5E7EB] p-2 ${
                                r.enabled === false ? "bg-[#F5F7FA] opacity-60" : "bg-white"
                            }`}
                        >
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center border border-[#E5E7EB] text-[#002B5C]">
                                <Icon size={15} strokeWidth={1.5} />
                            </span>
                            <select
                                value={r.platform}
                                onChange={(e) => set(i, { platform: e.target.value })}
                                data-testid={`footer-social-platform-${i}`}
                                className="border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm"
                            >
                                {SOCIAL_PLATFORMS.map((p) => (
                                    <option key={p.key} value={p.key}>
                                        {p.label}
                                    </option>
                                ))}
                                {/* Keeps a platform we do not know about selectable
                                    instead of silently rewriting it to LinkedIn. */}
                                {!known && <option value={r.platform}>{r.platform || "(custom)"}</option>}
                            </select>
                            <input
                                value={r.url || ""}
                                onChange={(e) => set(i, { url: e.target.value })}
                                placeholder={known?.hint || "https://…"}
                                data-testid={`footer-social-url-${i}`}
                                className="min-w-[200px] flex-1 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#002B5C]"
                            />
                            <button
                                onClick={() => set(i, { enabled: r.enabled === false })}
                                aria-label={r.enabled === false ? "Show this link" : "Hide this link"}
                                title={
                                    r.enabled === false
                                        ? "Hidden — click to show"
                                        : "Visible — click to hide"
                                }
                                className="border border-[#E5E7EB] p-1.5 text-[#4B5563] hover:text-[#002B5C]"
                            >
                                {r.enabled === false ? (
                                    <EyeOff size={15} strokeWidth={1.5} />
                                ) : (
                                    <Eye size={15} strokeWidth={1.5} />
                                )}
                            </button>
                            <button
                                onClick={() => move(i, -1)}
                                aria-label="Move up"
                                className="border border-[#E5E7EB] p-1.5 text-[#4B5563] hover:text-[#002B5C]"
                            >
                                <ArrowUp size={15} strokeWidth={1.5} />
                            </button>
                            <button
                                onClick={() => move(i, 1)}
                                aria-label="Move down"
                                className="border border-[#E5E7EB] p-1.5 text-[#4B5563] hover:text-[#002B5C]"
                            >
                                <ArrowDown size={15} strokeWidth={1.5} />
                            </button>
                            <button
                                onClick={() => remove(i)}
                                aria-label="Remove this link"
                                className="border border-[#CC0033] p-1.5 text-[#CC0033] hover:bg-[#CC0033]/5"
                            >
                                <X size={15} strokeWidth={1.5} />
                            </button>
                        </div>
                    );
                })}
            </div>

            <button
                onClick={add}
                data-testid="add-footer-social"
                className="mt-3 inline-flex items-center gap-1.5 border border-[#002B5C] text-[#002B5C] px-3 py-1.5 text-sm hover:bg-[#F5F7FA]"
            >
                <Plus size={14} strokeWidth={1.5} /> Add a platform
            </button>
        </div>
    );
}

/* ---------------------------- Footer link columns -------------------------- */

function FooterColumnsEditor() {
    const [cols, setCols] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        fetchCollection("site_footer_columns")
            .then((d) => setCols(d?.items?.length ? d.items : DEFAULT_FOOTER_COLUMNS))
            .catch(() => setCols(DEFAULT_FOOTER_COLUMNS));
    }, []);
    if (!cols) return null;

    const setCol = (ci, patch) => setCols((a) => a.map((c, i) => (i === ci ? { ...c, ...patch } : c)));
    const moveCol = (ci, dir) =>
        setCols((a) => {
            const j = ci + dir;
            if (j < 0 || j >= a.length) return a;
            const c = [...a];
            [c[ci], c[j]] = [c[j], c[ci]];
            return c;
        });
    const addCol = () => setCols((a) => [...a, { title: "New column", links: [] }]);
    const removeCol = (ci) => setCols((a) => a.filter((_, i) => i !== ci));

    const setLink = (ci, li, k, v) =>
        setCol(ci, { links: (cols[ci].links || []).map((l, i) => (i === li ? { ...l, [k]: v } : l)) });
    const addLink = (ci) => setCol(ci, { links: [...(cols[ci].links || []), { label: "", to: "/" }] });
    const removeLink = (ci, li) => setCol(ci, { links: (cols[ci].links || []).filter((_, i) => i !== li) });
    const moveLink = (ci, li, dir) => {
        const links = [...(cols[ci].links || [])];
        const j = li + dir;
        if (j < 0 || j >= links.length) return;
        [links[li], links[j]] = [links[j], links[li]];
        setCol(ci, { links });
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload = cols
                .map((c) => ({
                    title: (c.title || "").trim(),
                    links: (c.links || [])
                        .map((l) => ({ label: (l.label || "").trim(), to: (l.to || "").trim() }))
                        .filter((l) => l.label && l.to),
                }))
                .filter((c) => c.title);
            await adminSaveCollection("site_footer_columns", payload);
            toast.success("Footer links saved — live on the site.");
        } catch {
            toast.error("Could not save the footer links.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-[#E5E7EB] bg-white p-6" data-testid="footer-columns-editor">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="font-serif text-xl text-[#002B5C]">Footer link columns</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        The four columns of links in the footer. Category links look like{" "}
                        <span className="font-mono">/books?category=law</span> — keep the category slug exact or the link will return nothing.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={addCol} className="inline-flex items-center gap-1 text-xs border border-[#E5E7EB] px-3 py-1.5 hover:bg-[#F5F7FA]">
                        <Plus size={12} strokeWidth={1.5} /> Add column
                    </button>
                    <button type="button" onClick={save} disabled={saving} className="text-xs font-medium border border-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA] disabled:opacity-40">
                        {saving ? "…" : "Save footer links"}
                    </button>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {cols.map((col, ci) => (
                    <div key={ci} className="border border-[#E5E7EB] p-4">
                        <div className="flex items-center gap-2">
                            <input
                                value={col.title || ""}
                                onChange={(e) => setCol(ci, { title: e.target.value })}
                                placeholder="Column title"
                                className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm font-medium outline-none focus:border-[#002B5C]"
                            />
                            <button type="button" onClick={() => moveCol(ci, -1)} disabled={ci === 0} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move column up"><ArrowUp size={12} /></button>
                            <button type="button" onClick={() => moveCol(ci, 1)} disabled={ci === cols.length - 1} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move column down"><ArrowDown size={12} /></button>
                            <button type="button" onClick={() => removeCol(ci)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove column"><X size={12} /></button>
                        </div>
                        <div className="mt-3 space-y-2">
                            {(col.links || []).map((l, li) => (
                                <div key={li} className="flex items-center gap-1.5">
                                    <input value={l.label || ""} onChange={(e) => setLink(ci, li, "label", e.target.value)} placeholder="Label" className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1 text-xs outline-none focus:border-[#002B5C]" />
                                    <input value={l.to || ""} onChange={(e) => setLink(ci, li, "to", e.target.value)} placeholder="/path" className="flex-1 min-w-0 border border-[#E5E7EB] bg-white px-2 py-1 text-xs font-mono outline-none focus:border-[#002B5C]" />
                                    <button type="button" onClick={() => moveLink(ci, li, -1)} disabled={li === 0} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move link up"><ArrowUp size={10} /></button>
                                    <button type="button" onClick={() => moveLink(ci, li, 1)} disabled={li === (col.links || []).length - 1} className="border border-[#E5E7EB] p-1 hover:bg-[#F5F7FA] disabled:opacity-30" aria-label="Move link down"><ArrowDown size={10} /></button>
                                    <button type="button" onClick={() => removeLink(ci, li)} className="border border-[#CC0033] text-[#CC0033] p-1 hover:bg-[#CC0033]/5" aria-label="Remove link"><X size={10} /></button>
                                </div>
                            ))}
                            <button type="button" onClick={() => addLink(ci)} className="inline-flex items-center gap-1 text-[11px] border border-[#E5E7EB] px-2 py-1 hover:bg-[#F5F7FA]">
                                <Plus size={10} strokeWidth={1.5} /> Add link
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ---------------------------------- Page ---------------------------------- */

export default function AdminNavigation() {
    const [site, setSite] = useState({});
    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
    }, []);
    const saveSite = async (key, value) => {
        await adminSetSiteContent(key, value);
        setSite((s) => ({ ...s, [key]: value }));
        toast.success("Saved — live on the site.");
    };

    return (
        <div data-testid="admin-navigation-page">
            <div className="overline">Content</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Navigation</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                The links and copy that wrap every page — the header menu, footer columns,
                newsletter block and the bottom bar. Page content itself lives under Pages.
            </p>

            <section className="mt-10 max-w-4xl space-y-8">
                <HeaderNavEditor />

                <FooterColumnsEditor />

                <FooterSocialsEditor />

                <div className="border border-[#E5E7EB] bg-white p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Footer brand &amp; newsletter</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        The left-hand block of the footer, including the newsletter sign-up.
                    </p>
                    <div className="mt-4 space-y-3">
                        <TextSlotRow label="Small label (e.g. Est. 2017 · New Delhi)" value={site.footer_est} defaultValue={CONTENT_DEFAULTS.footer_est} onSave={(v) => saveSite("footer_est", v)} />
                        <TextSlotRow label="Tagline (line breaks allowed)" value={site.footer_tagline} defaultValue={CONTENT_DEFAULTS.footer_tagline} onSave={(v) => saveSite("footer_tagline", v)} multiline />
                        <TextSlotRow label="Description paragraph" value={site.footer_blurb} defaultValue={CONTENT_DEFAULTS.footer_blurb} onSave={(v) => saveSite("footer_blurb", v)} multiline />
                        <TextSlotRow label="Newsletter — email placeholder" value={site.footer_news_placeholder} defaultValue={CONTENT_DEFAULTS.footer_news_placeholder} onSave={(v) => saveSite("footer_news_placeholder", v)} />
                        <TextSlotRow label="Newsletter — button label" value={site.footer_news_button} defaultValue={CONTENT_DEFAULTS.footer_news_button} onSave={(v) => saveSite("footer_news_button", v)} />
                        <TextSlotRow label="Newsletter — success message" value={site.footer_news_success} defaultValue={CONTENT_DEFAULTS.footer_news_success} onSave={(v) => saveSite("footer_news_success", v)} />
                    </div>
                </div>

                <div className="border border-[#E5E7EB] bg-white p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Footer bottom bar</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        The copyright line and the row of legal links. The year is added automatically.
                    </p>
                    <div className="mt-4 space-y-3">
                        <TextSlotRow label="Copyright line (after the year)" value={site.footer_copyright} defaultValue={CONTENT_DEFAULTS.footer_copyright} onSave={(v) => saveSite("footer_copyright", v)} />
                    </div>
                    <div className="overline !text-[10px] mb-2 mt-6">Legal links</div>
                    <ListEditor
                        collectionKey="site_footer_legal"
                        defaults={DEFAULT_LEGAL}
                        fields={[{ key: "label", label: "Label" }, { key: "to", label: "/path" }]}
                        blank={{ label: "", to: "/" }}
                    />
                </div>
            </section>
        </div>
    );
}
