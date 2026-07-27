import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Play, X, Download, ArrowUpRight } from "lucide-react";
import Seo from "../components/Seo";
import { fetchSiteContent, fetchCollection, fetchSettings, mediaUrl } from "../lib/api";
import { hiddenSet } from "../lib/sections";

/**
 * Media & Gallery.
 *
 * Every section is admin-driven and self-hiding: a section with no items simply
 * doesn't render, so the page never shows an empty shelf while the team is still
 * uploading. Collections used:
 *   media_hero · media_recent · media_albums · media_gallery · media_videos
 *   media_socials · media_downloads
 * Headings, the upcoming event and the closing CTA come from site content.
 */

const renderRich = (text, color = "#F59E0B") =>
    String(text || "")
        .split(/(\*[^*]+\*)/g)
        .map((p, i) =>
            p.length > 2 && p.startsWith("*") && p.endsWith("*") ? (
                <em key={i} className="not-italic" style={{ color }}>{p.slice(1, -1)}</em>
            ) : (
                <React.Fragment key={i}>{p}</React.Fragment>
            ),
        );

const on = (items) => (Array.isArray(items) ? items.filter((i) => i && i.enabled !== false) : []);

/**
 * Admin-entered links may be internal ("/events") or external ("https://…").
 * React Router's Link treats an absolute URL as a relative path and mangles it,
 * so anything with a scheme gets a plain anchor instead.
 */
function SmartLink({ to, children, className }) {
    if (!to) return null;
    const external = /^(https?:|mailto:|tel:)/i.test(to);
    return external ? (
        <a href={to} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
    ) : (
        <Link to={to} className={className}>{children}</Link>
    );
}

/** YouTube/Vimeo → embed URL + poster fallback. */
function videoEmbed(url) {
    const u = String(url || "");
    let m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return { embed: `https://www.youtube.com/embed/${m[1]}?autoplay=1`, thumb: `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` };
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return { embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, thumb: null };
    return { embed: null, thumb: null };
}

/* ------------------------------------------------------------------ hero -- */
function HeroCarousel({ slides, site }) {
    const [i, setI] = useState(0);
    const n = slides.length;
    const touch = useRef(null);
    const reduce = useRef(
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    useEffect(() => {
        if (n <= 1 || reduce.current) return undefined;
        const t = setInterval(() => setI((k) => (k + 1) % n), 6000);
        return () => clearInterval(t);
    }, [n]);

    return (
        <section
            data-testid="media-hero"
            className="relative bg-[#0d2340] overflow-hidden"
            onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
                if (touch.current == null || n <= 1) return;
                const dx = e.changedTouches[0].clientX - touch.current;
                if (Math.abs(dx) > 45) setI((k) => (k + (dx < 0 ? 1 : -1) + n) % n);
                touch.current = null;
            }}
        >
            <div
                className="flex transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${i * 100}%)` }}
            >
                {(n ? slides : [{ id: "fallback" }]).map((s, k) => (
                    <div key={s.id || k} className="flex-[0_0_100%] min-w-full">
                        {s.image ? (
                            <img
                                src={mediaUrl(s.image) || s.image}
                                alt={s.alt || ""}
                                loading={k === 0 ? "eager" : "lazy"}
                                className="w-full object-cover h-[300px] sm:h-[420px] lg:h-[520px]"
                            />
                        ) : (
                            <div className="w-full h-[300px] sm:h-[420px] lg:h-[520px] bg-[#0d2340]" />
                        )}
                    </div>
                ))}
            </div>

            <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#002B5C]/95 via-[#002B5C]/30 to-transparent" />

            <div className="absolute left-0 right-0 bottom-0 px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pb-16 md:pb-20">
                <div className="overline !text-white/60">{site.media_overline || "Media & Gallery"}</div>
                <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl text-white mt-3 leading-tight max-w-[16ch] whitespace-pre-line">
                    {renderRich(site.media_title || "Capturing stories\nbeyond the *page.*")}
                </h1>
                {site.media_body && (
                    <p className="hidden md:block text-white/75 max-w-2xl mt-5 leading-relaxed">
                        {site.media_body}
                    </p>
                )}
            </div>

            {n > 1 && (
                <>
                    <button onClick={() => setI((k) => (k - 1 + n) % n)} aria-label="Previous banner"
                        className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center border border-white/40 bg-white/15 text-white hover:bg-white/30">
                        <ChevronLeft size={20} strokeWidth={1.5} />
                    </button>
                    <button onClick={() => setI((k) => (k + 1) % n)} aria-label="Next banner"
                        className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center border border-white/40 bg-white/15 text-white hover:bg-white/30">
                        <ChevronRight size={20} strokeWidth={1.5} />
                    </button>
                    <div className="absolute bottom-5 left-0 right-0 flex justify-center gap-2">
                        {slides.map((s, k) => (
                            <button key={s.id || k} onClick={() => setI(k)} aria-label={`Banner ${k + 1}`}
                                className={`h-[3px] w-7 ${k === i ? "bg-[#F59E0B]" : "bg-white/35"}`} />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

/* ------------------------------------------------------------------ rail -- */
function Rail({ children, testId }) {
    const ref = useRef(null);
    const [ends, setEnds] = useState({ start: true, end: false });

    const sync = () => {
        const el = ref.current;
        if (!el) return;
        setEnds({
            start: el.scrollLeft <= 2,
            end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 2,
        });
    };
    useEffect(() => {
        sync();
        window.addEventListener("resize", sync);
        return () => window.removeEventListener("resize", sync);
    }, [children]);

    const page = (dir) => {
        const el = ref.current;
        if (!el) return;
        const first = el.firstElementChild;
        const step = first ? first.getBoundingClientRect().width + 20 : el.clientWidth * 0.8;
        el.scrollBy({ left: dir * step, behavior: "smooth" });
    };

    return (
        <div className="relative">
            <div
                ref={ref}
                onScroll={sync}
                data-testid={testId}
                className="flex gap-5 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {React.Children.map(children, (c) => (
                    <div className="snap-start flex-[0_0_82%] sm:flex-[0_0_46%] lg:flex-[0_0_31%] 2xl:flex-[0_0_23.5%]">
                        {c}
                    </div>
                ))}
            </div>
            <div className="hidden md:flex gap-2 mt-4">
                <button onClick={() => page(-1)} disabled={ends.start} aria-label="Previous"
                    className="w-9 h-9 border border-[#E5E7EB] bg-white hover:border-[#002B5C] disabled:opacity-30 flex items-center justify-center">
                    <ChevronLeft size={16} strokeWidth={1.5} />
                </button>
                <button onClick={() => page(1)} disabled={ends.end} aria-label="Next"
                    className="w-9 h-9 border border-[#E5E7EB] bg-white hover:border-[#002B5C] disabled:opacity-30 flex items-center justify-center">
                    <ChevronRight size={16} strokeWidth={1.5} />
                </button>
            </div>
        </div>
    );
}

const SectionHead = ({ overline, title }) => (
    <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
            <div className="overline">{overline}</div>
            <h2 className="font-serif text-3xl md:text-4xl mt-2.5 text-[#002B5C] leading-tight whitespace-pre-line">
                {renderRich(title, "#CC0033")}
            </h2>
        </div>
    </div>
);

/* ------------------------------------------------------------------ page -- */
export default function MediaGallery() {
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState(null);
    const [hero, setHero] = useState([]);
    const [recent, setRecent] = useState([]);
    const [albums, setAlbums] = useState([]);
    const [photos, setPhotos] = useState([]);
    const [videos, setVideos] = useState([]);
    const [socials, setSocials] = useState([]);
    const [downloads, setDownloads] = useState([]);
    const [lightbox, setLightbox] = useState(null);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
        const grab = (key, set) => fetchCollection(key).then((d) => set(on(d?.items))).catch(() => {});
        grab("media_hero", setHero);
        grab("media_recent", setRecent);
        grab("media_albums", setAlbums);
        grab("media_gallery", setPhotos);
        grab("media_videos", setVideos);
        grab("media_socials", setSocials);
        grab("media_downloads", setDownloads);
    }, []);

    useEffect(() => {
        if (!lightbox) return undefined;
        const esc = (e) => e.key === "Escape" && setLightbox(null);
        document.addEventListener("keydown", esc);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", esc);
            document.body.style.overflow = "";
        };
    }, [lightbox]);

    const hidden = hiddenSet(settings);
    const show = (k) => !hidden.has(`media.${k}`);

    const videoGroups = useMemo(() => {
        const g1 = videos.filter((v) => (v.group || "launch") === "launch");
        const g2 = videos.filter((v) => v.group === "testimonial");
        return [
            { key: "launch", label: site.media_vid_g1_label || "Book launch highlights", items: g1 },
            { key: "testimonial", label: site.media_vid_g2_label || "Testimonials", items: g2 },
        ].filter((g) => g.items.length);
    }, [videos, site]);

    const hasUpcoming = Boolean(site.media_up_title || site.media_up_image);
    const PAD = "px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40";

    return (
        <div data-testid="media-gallery-page">
            <Seo
                title="Media & Gallery"
                description={site.media_body || "Photos and video from Oakbridge Publishing's events, launches and forums."}
                path="/media"
            />

            <HeroCarousel slides={hero} site={site} />

            {/* ---------- upcoming + recent ---------- */}
            {show("upcoming") && (hasUpcoming || recent.length > 0) && (
                <section className={`${PAD} py-16 md:py-20 bg-[#F5F7FA] border-b border-[#E5E7EB]`}>
                    <div className="grid lg:grid-cols-[1.75fr_1fr] gap-10">
                        {hasUpcoming && (
                            <div className="grid md:grid-cols-[1.15fr_1fr] gap-8" data-testid="media-upcoming">
                                <div>
                                    <div className="overline !text-[#CC0033]">{site.media_up_overline || "Upcoming"}</div>
                                    {site.media_up_image && (
                                        <img src={mediaUrl(site.media_up_image) || site.media_up_image} alt=""
                                            className="w-full h-[260px] md:h-[340px] object-cover mt-4" loading="lazy" />
                                    )}
                                </div>
                                <div>
                                    {site.media_up_date && (
                                        <div className="font-mono text-[11px] tracking-widest text-[#CC0033]">{site.media_up_date}</div>
                                    )}
                                    <h2 className="font-serif text-2xl md:text-3xl text-[#002B5C] mt-3 leading-tight">{site.media_up_title}</h2>
                                    {site.media_up_body && (
                                        <p className="text-[#4B5563] leading-relaxed mt-4 max-w-prose">{site.media_up_body}</p>
                                    )}
                                    {site.media_up_link && (
                                        <SmartLink to={site.media_up_link} className="inline-block mt-6 font-mono text-[11px] uppercase tracking-widest text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]">
                                            {site.media_up_link_label || "Event details →"}
                                        </SmartLink>
                                    )}
                                </div>
                            </div>
                        )}

                        {recent.length > 0 && (
                            <aside className="border border-[#E5E7EB] bg-white p-6" data-testid="media-recent">
                                <div className="overline">{site.media_recent_title || "Recent events"}</div>
                                <div className="mt-4">
                                    {recent.map((r, i) => (
                                        <div key={r.id || i} className={`flex gap-4 py-4 ${i < recent.length - 1 ? "border-b border-[#E5E7EB]" : ""}`}>
                                            {r.image && (
                                                <img src={mediaUrl(r.image) || r.image} alt="" loading="lazy"
                                                    className="w-[70px] h-[70px] object-cover flex-shrink-0" />
                                            )}
                                            <div className="min-w-0">
                                                {r.date && <div className="font-mono text-[10px] text-[#4B5563]">{r.date}</div>}
                                                <div className="font-medium text-[#002B5C] mt-1">{r.title}</div>
                                                {r.subtitle && <div className="text-[13px] text-[#4B5563]">{r.subtitle}</div>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {site.media_recent_link && (
                                    <SmartLink to={site.media_recent_link} className="inline-block mt-4 font-mono text-[11px] uppercase tracking-widest text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]">
                                        {site.media_recent_link_label || "All events →"}
                                    </SmartLink>
                                )}
                            </aside>
                        )}
                    </div>
                </section>
            )}

            {/* ---------- albums ---------- */}
            {show("albums") && albums.length > 0 && (
                <section className={`${PAD} py-16 md:py-20`} data-testid="media-albums">
                    <SectionHead
                        overline={site.media_albums_overline || "Explore by occasion"}
                        title={site.media_albums_title || "Browse the albums."}
                    />
                    <div className="mt-9">
                        <Rail testId="media-albums-rail">
                            {albums.map((a, i) => {
                                const inner = (
                                    <>
                                        {a.image && (
                                            <img src={mediaUrl(a.image) || a.image} alt="" loading="lazy"
                                                className="w-full h-[150px] object-cover" />
                                        )}
                                        <div className="p-4">
                                            <div className="font-medium text-[#002B5C]">{a.title}</div>
                                            {a.caption && <div className="font-mono text-[11px] text-[#4B5563] mt-1">{a.caption}</div>}
                                        </div>
                                    </>
                                );
                                return a.link ? (
                                    <SmartLink key={a.id || i} to={a.link} className="block border border-[#E5E7EB] bg-white hover:border-[#002B5C] transition-colors">{inner}</SmartLink>
                                ) : (
                                    <div key={a.id || i} className="border border-[#E5E7EB] bg-white">{inner}</div>
                                );
                            })}
                        </Rail>
                    </div>
                </section>
            )}

            {/* ---------- darkroom mosaic ---------- */}
            {show("gallery") && photos.length > 0 && (
                <section className={`${PAD} py-16 md:py-20 bg-[#F5F7FA] border-y border-[#E5E7EB]`} data-testid="media-darkroom">
                    <SectionHead
                        overline={site.media_gallery_overline || "Photo gallery"}
                        title={site.media_gallery_title || "Moments from Oakbridge's Darkroom."}
                    />
                    <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-[150px] gap-3 mt-9">
                        {photos.map((p, i) => (
                            <button
                                key={p.id || i}
                                onClick={() => setLightbox(p)}
                                data-testid={`darkroom-tile-${i}`}
                                className={`group relative overflow-hidden bg-[#002B5C] ${i % 7 === 0 ? "col-span-2 row-span-2" : ""}`}
                            >
                                <img src={mediaUrl(p.url) || p.url} alt={p.title || ""} loading="lazy"
                                    className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                                {p.title && (
                                    <span className="absolute inset-x-0 bottom-0 p-3 text-left bg-gradient-to-t from-black/70 to-transparent">
                                        <span className="block text-white font-serif text-sm leading-tight">{p.title}</span>
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {/* ---------- videos ---------- */}
            {show("videos") && videoGroups.length > 0 && (
                <section className={`${PAD} py-16 md:py-20`} data-testid="media-videos">
                    <SectionHead
                        overline={site.media_videos_overline || "Video highlights"}
                        title={site.media_videos_title || "Watch the room."}
                    />
                    {videoGroups.map((g) => (
                        <div key={g.key} className="mt-10">
                            <div className="overline !text-[#CC0033]">{g.label}</div>
                            <div className="mt-4">
                                <Rail testId={`media-videos-${g.key}`}>
                                    {g.items.map((v, i) => {
                                        const { thumb } = videoEmbed(v.url);
                                        const poster = v.poster || thumb;
                                        return (
                                            <button key={v.id || i} onClick={() => setLightbox({ ...v, isVideo: true })} className="text-left w-full">
                                                <span className="relative block bg-[#002B5C] h-[190px] overflow-hidden">
                                                    {poster && (
                                                        <img src={mediaUrl(poster) || poster} alt="" loading="lazy"
                                                            className="absolute inset-0 w-full h-full object-cover opacity-85" />
                                                    )}
                                                    <span className="absolute inset-0 flex items-center justify-center">
                                                        <span className="w-12 h-12 rounded-full bg-[#002B5C]/90 flex items-center justify-center">
                                                            <Play size={16} className="text-white ml-0.5" />
                                                        </span>
                                                    </span>
                                                </span>
                                                <span className="block font-medium text-[#002B5C] mt-3.5">{v.title}</span>
                                                {v.caption && <span className="block text-[13px] text-[#4B5563] mt-1">{v.caption}</span>}
                                            </button>
                                        );
                                    })}
                                </Rail>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {/* ---------- socials ---------- */}
            {show("socials") && socials.length > 0 && (
                <section className={`${PAD} py-16 md:py-20 bg-[#F5F7FA] border-t border-[#E5E7EB]`} data-testid="media-socials">
                    <div className="flex items-end justify-between gap-6 flex-wrap">
                        <div>
                            <div className="overline">{site.media_social_overline || "From our socials"}</div>
                            <h2 className="font-serif text-2xl md:text-3xl mt-2.5 text-[#002B5C]">
                                {site.media_social_title || "Follow the journey."}
                            </h2>
                        </div>
                        {site.media_social_url && (
                            <a href={site.media_social_url} target="_blank" rel="noopener noreferrer"
                                className="font-mono text-[11px] uppercase tracking-widest text-[#002B5C] border-b border-[#002B5C] pb-0.5 hover:text-[#CC0033] hover:border-[#CC0033]">
                                {site.media_social_handle || "Follow us"} <ArrowUpRight size={12} className="inline" />
                            </a>
                        )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-8">
                        {socials.map((s, i) => {
                            const img = (
                                <img src={mediaUrl(s.image) || s.image} alt="" loading="lazy"
                                    className="w-full aspect-square object-cover hover:opacity-90 transition-opacity" />
                            );
                            return s.link ? (
                                <a key={s.id || i} href={s.link} target="_blank" rel="noopener noreferrer">{img}</a>
                            ) : (
                                <div key={s.id || i}>{img}</div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ---------- downloads + CTA ---------- */}
            {show("downloads") && (downloads.length > 0 || site.media_cta_title) && (
                <section className={`${PAD} py-16 md:py-20`}>
                    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8">
                        {downloads.length > 0 && (
                            <div data-testid="media-downloads">
                                <div className="overline">{site.media_dl_overline || "Downloads"}</div>
                                <h2 className="font-serif text-2xl md:text-3xl mt-2.5 text-[#002B5C]">
                                    {site.media_dl_title || "Company resources."}
                                </h2>
                                <div className="mt-7 border-t border-[#E5E7EB]">
                                    {downloads.map((d, i) => (
                                        <a key={d.id || i} href={mediaUrl(d.file) || d.file} target="_blank" rel="noopener noreferrer"
                                            className="flex items-center justify-between gap-4 py-4 border-b border-[#E5E7EB] group">
                                            <span className="text-[#002B5C] group-hover:text-[#CC0033]">{d.label}</span>
                                            <span className="font-mono text-[11px] text-[#4B5563] flex items-center gap-1.5 flex-shrink-0">
                                                {d.format || "FILE"} <Download size={13} strokeWidth={1.5} />
                                            </span>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}

                        {site.media_cta_title && (
                            <aside className="bg-[#002B5C] text-white p-8 md:p-10" data-testid="media-cta">
                                <div className="overline !text-[#F59E0B]">{site.media_cta_overline || "Media enquiries"}</div>
                                <h2 className="font-serif text-2xl text-white mt-3.5 leading-tight">{site.media_cta_title}</h2>
                                {site.media_cta_body && <p className="text-white/75 leading-relaxed mt-4">{site.media_cta_body}</p>}
                                <div className="flex flex-col gap-3 mt-7">
                                    {site.media_cta_btn1_label && (
                                        <SmartLink to={site.media_cta_btn1_link || "/contact"} className="border border-white/55 text-white text-center py-3 text-sm font-medium hover:bg-white/10">
                                            {site.media_cta_btn1_label}
                                        </SmartLink>
                                    )}
                                    {site.media_cta_btn2_label && (
                                        <SmartLink to={site.media_cta_btn2_link || "/contact"} className="bg-[#CC0033] text-white text-center py-3 text-sm font-medium hover:bg-[#a80029]">
                                            {site.media_cta_btn2_label}
                                        </SmartLink>
                                    )}
                                </div>
                            </aside>
                        )}
                    </div>
                </section>
            )}

            {/* ---------- lightbox ---------- */}
            {lightbox && (
                <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
                    <button onClick={() => setLightbox(null)} aria-label="Close" className="absolute top-5 right-5 text-white/80 hover:text-white">
                        <X size={26} strokeWidth={1.5} />
                    </button>
                    <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
                        {lightbox.isVideo ? (
                            videoEmbed(lightbox.url).embed ? (
                                <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                                    <iframe src={videoEmbed(lightbox.url).embed} title={lightbox.title || "Video"} allow="autoplay; fullscreen"
                                        allowFullScreen className="absolute inset-0 w-full h-full" />
                                </div>
                            ) : (
                                <p className="text-white text-center">This video link can't be embedded.</p>
                            )
                        ) : (
                            <img src={mediaUrl(lightbox.url) || lightbox.url} alt={lightbox.title || ""} className="w-full max-h-[85vh] object-contain" />
                        )}
                        {(lightbox.title || lightbox.caption) && (
                            <div className="text-center mt-4">
                                {lightbox.title && <div className="text-white font-serif text-lg">{lightbox.title}</div>}
                                {lightbox.caption && <div className="text-white/60 text-sm mt-1">{lightbox.caption}</div>}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
