import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { fetchSiteContent, adminSetSiteContent } from "../../lib/api";
import { TextSlotRow } from "../../components/admin/ContentEditors";
import MediaListEditor from "../../components/admin/MediaListEditor";

/**
 * Media & Gallery page editor — every section of /media in one screen.
 *
 * Each block maps to one collection or a handful of site-content slots. Sections
 * with no items disappear from the public page, so an empty block here is a
 * deliberate "not ready yet" rather than a broken layout.
 */

const IMG_HINT = "Landscape images work best. Upload, or paste a URL.";

function Block({ n, title, help, children, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="border border-[#E5E7EB] bg-white">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F5F7FA]"
            >
                <span className="min-w-0">
                    <span className="font-mono text-[10px] text-[#4B5563] mr-2">{String(n).padStart(2, "0")}</span>
                    <span className="font-serif text-lg text-[#002B5C]">{title}</span>
                    {help && <span className="block text-[11px] text-[#4B5563] mt-1">{help}</span>}
                </span>
                <span className="font-mono text-xs text-[#4B5563] flex-shrink-0">{open ? "−" : "+"}</span>
            </button>
            {open && <div className="px-5 pb-5 border-t border-[#E5E7EB] pt-5">{children}</div>}
        </section>
    );
}

export default function AdminMediaGallery() {
    const [site, setSite] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {}).finally(() => setLoading(false));
    }, []);

    const save = async (key, value) => {
        await adminSetSiteContent(key, value);
        setSite((s) => ({ ...s, [key]: value }));
        toast.success("Saved — live on the site.");
    };
    const row = (label, key, dflt, multiline = false) => (
        <TextSlotRow label={label} value={site[key]} defaultValue={dflt} multiline={multiline}
            onSave={(v) => save(key, v)} />
    );

    if (loading) return <p className="font-mono text-xs text-[#4B5563]">Loading…</p>;

    return (
        <div data-testid="admin-media-gallery-page">
            <div className="overline">Page editor</div>
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <h1 className="font-serif text-4xl mt-2 text-[#002B5C]">Media &amp; Gallery</h1>
                <a href="/media" target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-xs font-medium border border-[#002B5C] px-4 py-2 hover:bg-[#F5F7FA]">
                    View page <ExternalLink size={12} strokeWidth={1.5} />
                </a>
            </div>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Every section below is optional — one with nothing in it simply doesn't appear on
                the page, so you can build this up as photos and files come in.
            </p>

            <div className="mt-8 space-y-3 max-w-4xl">
                <Block n={1} title="Hero carousel" help="Full-width banners at the top. Swipes on mobile." defaultOpen>
                    <div className="space-y-3 mb-5">
                        {row("Overline", "media_overline", "Media & Gallery")}
                        {row("Headline (line breaks + *highlight*)", "media_title", "Capturing stories\nbeyond the *page.*", true)}
                        {row("Intro paragraph (hidden on phones)", "media_body", "Moments from our publishing journey — literary events, book launches, author interactions and community celebrations.", true)}
                    </div>
                    <MediaListEditor
                        collectionKey="media_hero"
                        addLabel="Add banner"
                        max={6}
                        help={`Banners rotate every 6 seconds. ${IMG_HINT} Wide images (about 2000×900) look best — keep the lower third free, the headline sits there.`}
                        fields={[
                            { key: "image", label: "Banner image", type: "image" },
                            { key: "alt", label: "Alt text (for screen readers)" },
                        ]}
                    />
                </Block>

                <Block n={2} title="Upcoming event" help="The large panel below the hero. Leave the title blank to hide it.">
                    <div className="space-y-3">
                        {row("Overline", "media_up_overline", "Upcoming")}
                        {row("Date / location line", "media_up_date", "12 SEP 2026 · NEW DELHI")}
                        {row("Event title", "media_up_title", "")}
                        {row("Short description", "media_up_body", "", true)}
                        {row("Image", "media_up_image", "")}
                        {row("Link (e.g. /events)", "media_up_link", "/events")}
                        {row("Link label", "media_up_link_label", "Event details →")}
                    </div>
                </Block>

                <Block n={3} title="Recent events" help="The list beside the upcoming event.">
                    <div className="space-y-3 mb-5">
                        {row("Heading", "media_recent_title", "Recent events")}
                        {row("Footer link (e.g. /events)", "media_recent_link", "/events")}
                        {row("Footer link label", "media_recent_link_label", "All events →")}
                    </div>
                    <MediaListEditor
                        collectionKey="media_recent"
                        addLabel="Add event"
                        fields={[
                            { key: "date", label: "Date (e.g. 23 JUL 2026)" },
                            { key: "title", label: "Title" },
                            { key: "subtitle", label: "Subtitle" },
                            { key: "image", label: "Thumbnail", type: "image" },
                        ]}
                    />
                </Block>

                <Block n={4} title="Explore by occasion" help="Album cards in a carousel. Add as many as you like.">
                    <div className="space-y-3 mb-5">
                        {row("Overline", "media_albums_overline", "Explore by occasion")}
                        {row("Heading", "media_albums_title", "Browse the albums.")}
                    </div>
                    <MediaListEditor
                        collectionKey="media_albums"
                        addLabel="Add album"
                        help={`Cards scroll horizontally. ${IMG_HINT}`}
                        fields={[
                            { key: "title", label: "Album name" },
                            { key: "caption", label: "Caption (e.g. 120 photos)" },
                            { key: "image", label: "Cover image", type: "image" },
                            { key: "link", label: "Link (optional)" },
                        ]}
                    />
                </Block>

                <Block n={5} title="Darkroom photo gallery" help="The mosaic wall. Click a tile on the site to open it full size.">
                    <div className="space-y-3 mb-5">
                        {row("Overline", "media_gallery_overline", "Photo gallery")}
                        {row("Heading", "media_gallery_title", "Moments from Oakbridge's Darkroom.")}
                    </div>
                    <MediaListEditor
                        collectionKey="media_gallery"
                        addLabel="Add photo"
                        help="Every 7th photo is shown double-size, so the wall stays interesting. Order matters."
                        fields={[
                            { key: "url", label: "Photo", type: "image" },
                            { key: "title", label: "Caption (optional)" },
                        ]}
                    />
                </Block>

                <Block n={6} title="Watch the room — videos" help="Two carousels: book launches and testimonials.">
                    <div className="space-y-3 mb-5">
                        {row("Overline", "media_videos_overline", "Video highlights")}
                        {row("Heading", "media_videos_title", "Watch the room.")}
                        {row("First group label", "media_vid_g1_label", "Book launch highlights")}
                        {row("Second group label", "media_vid_g2_label", "Testimonials")}
                    </div>
                    <MediaListEditor
                        collectionKey="media_videos"
                        addLabel="Add video"
                        help="Paste a YouTube or Vimeo link — the thumbnail is pulled automatically for YouTube. Choose which group it belongs to."
                        blank={{ group: "launch" }}
                        fields={[
                            {
                                key: "group", label: "Group", type: "select",
                                options: [
                                    { value: "launch", label: "Book launch highlights" },
                                    { value: "testimonial", label: "Testimonials" },
                                ],
                            },
                            { key: "title", label: "Title" },
                            { key: "url", label: "YouTube / Vimeo link" },
                            { key: "caption", label: "Caption", type: "textarea" },
                            { key: "poster", label: "Custom thumbnail (optional)", type: "image" },
                        ]}
                    />
                </Block>

                <Block n={7} title="From our socials" help="A row of hand-picked posts. Not a live feed.">
                    <div className="space-y-3 mb-5">
                        {row("Overline", "media_social_overline", "From our socials")}
                        {row("Heading", "media_social_title", "Follow the journey.")}
                        {row("Handle shown", "media_social_handle", "@oakbridgepublishing")}
                        {row("Profile URL", "media_social_url", "")}
                    </div>
                    <MediaListEditor
                        collectionKey="media_socials"
                        addLabel="Add post"
                        help="Square images look best. Link each one to the actual post if you like."
                        fields={[
                            { key: "image", label: "Post image", type: "image" },
                            { key: "link", label: "Post URL (optional)" },
                        ]}
                    />
                </Block>

                <Block n={8} title="Downloads" help="Company profile, price lists, press releases.">
                    <div className="space-y-3 mb-5">
                        {row("Overline", "media_dl_overline", "Downloads")}
                        {row("Heading", "media_dl_title", "Company resources.")}
                    </div>
                    <MediaListEditor
                        collectionKey="media_downloads"
                        addLabel="Add download"
                        help="Upload a PDF, ZIP, Word or Excel file (max 25 MB). Anyone with the link can download it — don't put anything confidential here."
                        fields={[
                            { key: "label", label: "Shown as" },
                            { key: "file", label: "File", type: "file" },
                            { key: "format", label: "Format badge (auto-filled)" },
                        ]}
                    />
                </Block>

                <Block n={9} title="Media enquiry panel" help="The navy box at the foot of the page. Blank title hides it.">
                    <div className="space-y-3">
                        {row("Overline", "media_cta_overline", "Media enquiries")}
                        {row("Heading", "media_cta_title", "Interested in covering our events?")}
                        {row("Body", "media_cta_body", "We'd love to work with you — for press passes, interviews and partnerships.", true)}
                        {row("Button 1 label", "media_cta_btn1_label", "Become a media partner")}
                        {row("Button 1 link", "media_cta_btn1_link", "/contact")}
                        {row("Button 2 label", "media_cta_btn2_label", "Contact us")}
                        {row("Button 2 link", "media_cta_btn2_link", "/contact")}
                    </div>
                </Block>
            </div>

            <p className="text-[11px] text-[#4B5563] mt-6 max-w-2xl">
                To hide a whole section without deleting its content, use Admin → Pages → section
                visibility (keys: media.upcoming, media.albums, media.gallery, media.videos,
                media.socials, media.downloads).
            </p>
        </div>
    );
}
