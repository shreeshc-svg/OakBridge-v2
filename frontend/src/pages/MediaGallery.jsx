import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { X, Play, Image as ImageIcon } from "lucide-react";
import { fetchCollection, fetchSiteContent, fetchSettings, mediaUrl } from "../lib/api";
import { hiddenSet } from "../lib/sections";

function renderRich(text) {
    return String(text || "")
        .split(/(\*[^*]+\*)/g)
        .map((p, i) =>
            p.length > 2 && p.startsWith("*") && p.endsWith("*") ? (
                <em key={i} className="text-[#CC0033] not-italic">{p.slice(1, -1)}</em>
            ) : (
                <React.Fragment key={i}>{p}</React.Fragment>
            ),
        );
}

// Turn a YouTube/Vimeo URL into an embeddable src + a thumbnail (YouTube only).
function parseVideo(url) {
    const u = url || "";
    let m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) return { embed: `https://www.youtube.com/embed/${m[1]}?autoplay=1`, thumb: `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` };
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return { embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, thumb: null };
    return { embed: u, thumb: null };
}

// The gallery is split into two titled sections. Each media item carries a
// `section` key ("launches" default, or "presentations"); titles are editable
// via site content (media_launches_title / media_presentations_title).
const MEDIA_SECTIONS = [
    { key: "launches", title: "Book Launches", slot: "media_launches_title" },
    { key: "presentations", title: "Book Presentations", slot: "media_presentations_title" },
    { key: "events", title: "Events", slot: "media_events_title" },
];

export default function MediaGallery() {
    const [items, setItems] = useState([]);
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState({});
    const [active, setActive] = useState(null); // item open in lightbox

    useEffect(() => {
        fetchCollection("media_gallery")
            .then((d) => setItems((d?.items || []).filter((x) => x && x.enabled !== false && x.url)))
            .catch(() => {});
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
    }, []);

    const hidden = hiddenSet(settings);

    useEffect(() => {
        if (!active) return undefined;
        const onKey = (e) => e.key === "Escape" && setActive(null);
        window.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    }, [active]);

    const tile = (it, i) => {
        const isVideo = it.type === "video";
        const vid = isVideo ? parseVideo(it.url) : null;
        const img = isVideo ? (vid.thumb || mediaUrl(it.poster) || it.poster) : (mediaUrl(it.url) || it.url);
        // Consistent tile size across the whole grid (uniform 4:3 tiles).
        return (
            <button
                key={it.id || i}
                onClick={() => setActive(it)}
                data-testid={`media-tile-${it.id || i}`}
                className="group relative overflow-hidden bg-[#002B5C]"
                style={{ aspectRatio: "4 / 3" }}
            >
                {img ? (
                    <img src={img} alt={it.title || ""} loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-white/40">
                        {isVideo ? <Play size={40} strokeWidth={1} /> : <ImageIcon size={40} strokeWidth={1} />}
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#002B5C]/90 via-[#002B5C]/10 to-transparent" />
                {isVideo && (
                    <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-14 h-14 rounded-full bg-white/90 group-hover:bg-[#F59E0B] flex items-center justify-center transition-colors">
                            <Play size={20} strokeWidth={2} className="text-[#002B5C] ml-0.5" />
                        </span>
                    </span>
                )}
                {(it.title || it.caption) && (
                    <span className="absolute inset-x-0 bottom-0 p-4 text-left">
                        {it.title && <span className="block text-white font-serif text-lg leading-tight">{it.title}</span>}
                        {it.caption && <span className="block text-white/70 text-xs font-mono uppercase tracking-widest mt-1">{it.caption}</span>}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div data-testid="media-gallery-page">
            <Breadcrumbs items={[{ label: "Media & Gallery" }]} />
            <Seo title="Media & Gallery" description="Photos and video from Oakbridge Publishing's events, launches and forums." path="/media" />

            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-20 pb-12 border-b border-[#E5E7EB]">
                <div className="overline">{site.media_overline || "Media & Gallery"}</div>
                <h1 className="font-serif text-5xl md:text-7xl mt-4 text-[#002B5C] leading-[0.95] max-w-3xl whitespace-pre-line">
                    {renderRich(site.media_title || "Moments from the *Oakbridge* stage.")}
                </h1>
                <p className="mt-6 max-w-2xl text-[#4B5563] leading-relaxed whitespace-pre-line">
                    {site.media_body ||
                        "Photographs and film from our launches, forums and summits — the people and ideas shaping law, policy and scholarship in India."}
                </p>
            </section>

            {!hidden.has("media.gallery") && (
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-14 space-y-16">
                {items.length === 0 ? (
                    <div className="border border-dashed border-[#E5E7EB] p-16 text-center text-[#4B5563]">
                        <ImageIcon size={28} strokeWidth={1.5} className="mx-auto text-[#E5E7EB]" />
                        <p className="mt-3 text-sm">Our gallery is being curated. Check back soon.</p>
                    </div>
                ) : (
                    MEDIA_SECTIONS.map((sec) => {
                        const list = items.filter((it) => (it.section || "launches") === sec.key);
                        if (list.length === 0) return null;
                        return (
                            <div key={sec.key} data-testid={`media-section-${sec.key}`}>
                                <h2 className="font-serif text-3xl md:text-4xl text-[#002B5C] mb-6">
                                    {site[sec.slot] || sec.title}
                                </h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                                    {list.map(tile)}
                                </div>
                            </div>
                        );
                    })
                )}
            </section>
            )}

            {active && createPortal(
                <div className="fixed inset-0 z-[100] h-[100dvh] bg-[#002B5C]/95 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" onClick={() => setActive(null)}>
                    <div className="flex justify-end p-4 flex-shrink-0">
                        <button onClick={() => setActive(null)} aria-label="Close" className="p-2 text-white/70 hover:text-white">
                            <X size={24} strokeWidth={1.5} />
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 flex items-center justify-center px-4 pb-8" onClick={(e) => e.stopPropagation()}>
                        {active.type === "video" ? (
                            <div className="w-full max-w-4xl aspect-video">
                                <iframe src={parseVideo(active.url).embed} title={active.title || "Video"} className="w-full h-full" allow="autoplay; encrypted-media; fullscreen" allowFullScreen frameBorder="0" />
                            </div>
                        ) : (
                            <img src={mediaUrl(active.url) || active.url} alt={active.title || ""} className="max-w-full max-h-full object-contain" />
                        )}
                    </div>
                    {(active.title || active.caption) && (
                        <div className="flex-shrink-0 text-center pb-8 px-4">
                            {active.title && <div className="font-serif text-white text-lg">{active.title}</div>}
                            {active.caption && <div className="font-mono text-white/60 text-xs uppercase tracking-widest mt-1">{active.caption}</div>}
                        </div>
                    )}
                </div>,
                document.body,
            )}
        </div>
    );
}
