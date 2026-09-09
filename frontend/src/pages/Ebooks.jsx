import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen, Tablet } from "lucide-react";
import Seo from "../components/Seo";
import FormatSplitGraphic from "../components/FormatSplitGraphic";
import CloudSyncGraphic from "../components/CloudSyncGraphic";
import OrbitField from "../components/OrbitField";
import { fetchSiteContent, fetchCollection, resolveCollection } from "../lib/api";
import { metaDescription, breadcrumbLd } from "../lib/schema";
import { track } from "../lib/analytics";

/**
 * /ebooks — the same title, two ways to read it.
 *
 * WHY THIS PAGE EXISTS
 *
 * The eBook edition had seven touchpoints across the site and no home. Every
 * one of them was a link OUT, so the only thing a visitor could do with the
 * word "eBook" was leave. This is the page the header now points at: it makes
 * the case, then sends people either to the printed catalogue or to the
 * eReader, and it is the one eBook surface we own.
 *
 * WHY IT COMPARES RATHER THAN SELLS
 *
 * Somebody who has landed here has already decided they want the book. The
 * only open question is which edition, and that question has a real answer
 * either way — print does things a screen cannot and the reverse is just as
 * true. A page that only argued for digital would be answering a question
 * nobody asked, and would read as a push towards the platform whose revenue we
 * cannot yet see on the dashboard.
 *
 * WHY NO PERCENTAGES IN THE COPY
 *
 * There is no discount arithmetic anywhere in this codebase. The printed
 * badge is derived per title from `original_price` vs `price`, and
 * `ebook_price` is uploaded absolutely and only grossed up by GST. "20% off"
 * and "25% off" are conventions in the DATA, true of the titles loaded so far
 * and of nothing structural — so this page describes the shape of the pricing
 * and lets each book's own page state the number.
 */

const DEFAULTS = {
    eyebrow: "Oakbridge · eBooks",
    headline: "One book.\nTwo ways to",
    accent: "read it.",
    body:
        "Every Oakbridge title is set for the page first. A growing number are set for the screen as well — the same text, the same edition, carried differently. Pick whichever suits how you actually read.",
    print_title: "Printed book",
    print_body: "Shipped to you, and yours afterwards.",
    ebook_title: "eBook",
    ebook_body: "Opens on the Oakbridge eReader, minutes after you buy it.",
    cta_kicker: "Not sure which?",
    cta_headline: "Every book's own page lists both prices side by side.",
    /* The book in the illustration. Content rather than code, so the featured
       title can change without a deploy — and it should be one that genuinely
       HAS an eBook, since it is being shown on the eBooks page. */
    art_title: "Climate Justice",
    art_author: "Sudhir Mishra",
    art_chapter: "Chapter One",
    art_pages: "231",
    cloud_kicker: "Anywhere you read",
    cloud_tagline: "Oakbridge, now on the cloud.",
    cloud_body:
        "Buy the eBook once and your library, your highlights and your place in the book follow you — phone on the commute, laptop at the desk, tablet in chambers.",
};

const DEFAULT_PRINT = [
    { title: "Arrives in 3–7 days", text: "Tracked delivery across India" },
    { title: "Yours to keep", text: "Lend it, shelve it, pass it on" },
    { title: "Marked up in pen", text: "Margins, flags and sticky notes" },
    { title: "Never needs charging", text: "Reads in court, in class, on a train with no signal" },
    { title: "Discounted off MRP", text: "On every title in the bookstore" },
];

const DEFAULT_EBOOK = [
    { title: "Reading in minutes", text: "Nothing to deliver, nothing to wait for" },
    { title: "Search every word", text: "Find a section without going through the index" },
    { title: "Highlight and annotate", text: "Your notes stay with the book, on every device" },
    { title: "The whole shelf, carried", text: "Phone, tablet or laptop" },
    { title: "Usually the lower price", text: "Stated on each title's page" },
];

const EREADER_FALLBACK = "https://ebooks.oakbridge.in/";

/** One row in a format column. `align` flips it for the left-hand column. */
function Point({ item, align }) {
    return (
        <li className={align === "right" ? "text-right" : "text-left"}>
            <div className="text-[15px] font-medium text-[#002B5C] leading-snug">{item.title}</div>
            {item.text && <div className="text-[13px] text-[#4B5563] mt-1 leading-relaxed">{item.text}</div>}
        </li>
    );
}

export default function Ebooks() {
    const [site, setSite] = useState({});
    const [printData, setPrintData] = useState(null);
    const [ebookData, setEbookData] = useState(null);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchCollection("page_eb_print").then(setPrintData).catch(() => {});
        fetchCollection("page_eb_ebook").then(setEbookData).catch(() => {});
    }, []);

    // The same master switch every other eBook surface reads, written the same
    // way on purpose — one switch turns off the CTAs on the homepage band, the
    // bookstore strip, the book page and this.
    const ebooksOn = String(site?.ebook_enabled ?? "on").toLowerCase() !== "off";
    const readerUrl = (site?.ebook_url ?? EREADER_FALLBACK).trim();
    const canGoToReader = ebooksOn && Boolean(readerUrl);

    const txt = (key) => site?.[`eb_${key}`] || DEFAULTS[key];
    const printPoints = resolveCollection(printData, DEFAULT_PRINT).filter((i) => i && i.title);
    const ebookPoints = resolveCollection(ebookData, DEFAULT_EBOOK).filter((i) => i && i.title);

    /*
     * Motion is a content decision, not a code one — a launch week may want the
     * page still. `?? "on"` so an install that has never touched the switch
     * behaves as designed rather than as switched off.
     */
    const isOn = (v, fallback = "on") => String(v ?? fallback).toLowerCase() !== "off";
    const animate = isOn(site?.eb_anim_enabled);
    const portal = animate && isOn(site?.eb_portal_enabled);
    /* Seconds in, CSS time out. A blank or unparseable value falls back to the
       design value rather than to 0s, which would freeze every drawing on its
       first keyframe. */
    const secs = (v, fallback) => {
        const n = Number(String(v ?? "").trim());
        return `${Number.isFinite(n) && n > 0 ? n : fallback}s`;
    };
    const rhythm = {
        "--fg-beat": secs(site?.eb_anim_beat, 2.6),
        "--fg-flight": secs(site?.eb_anim_flight, 5.2),
    };

    const onLeave = () => track("ebook_cta_clicked", { placement: "ebooks_page", url: readerUrl });

    return (
        <div data-testid="ebooks-page" className="flex flex-col">
            <Seo
                title="eBooks — Read Oakbridge Titles on Any Device"
                description={metaDescription(
                    "Oakbridge law, tax and academic titles in print and as eBooks. Compare the two editions — delivery, annotation, search and price — then read on the Oakbridge eReader.",
                )}
                path="/ebooks"
                jsonLd={breadcrumbLd([{ name: "eBooks" }])}
            />

            {/* ============== HERO ============== */}
            <section className="relative overflow-hidden border-b border-[#E5E7EB] bg-[#002B5C] text-white">
                {/* Same wash as the Coming Soon template, so a new page still
                    looks like it came from this site. */}
                <div
                    aria-hidden="true"
                    className="absolute inset-0 opacity-[0.08]"
                    style={{
                        background:
                            "radial-gradient(circle at 20% 20%, #F59E0B 0%, transparent 45%), radial-gradient(circle at 80% 70%, #CC0033 0%, transparent 45%)",
                    }}
                />
                <div className="relative px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-20 md:py-28 max-w-5xl">
                    <div className="overline !text-[#F59E0B]">{txt("eyebrow")}</div>
                    <h1
                        className="font-serif text-5xl md:text-6xl lg:text-7xl mt-6 leading-[0.95] whitespace-pre-line fade-up"
                        style={{ animationDelay: "80ms" }}
                    >
                        {txt("headline")}{" "}
                        <em className="text-[#F59E0B] not-italic">{site?.eb_accent ?? DEFAULTS.accent}</em>
                    </h1>
                    <p
                        className="text-base md:text-lg text-white/80 mt-7 max-w-2xl leading-relaxed fade-up"
                        style={{ animationDelay: "160ms" }}
                    >
                        {txt("body")}
                    </p>
                </div>
            </section>

            {/* ============== THE COMPARISON ============== */}
            <section
                data-testid="ebooks-compare"
                className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16 md:py-24"
            >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-start max-w-7xl mx-auto">
                    {/* ---- printed ----
                        Three columns of four made the middle one too narrow for
                        a book, a flight of type and a device to sit side by
                        side at any readable size. The bullet lists are short
                        phrases and lose nothing at a quarter of the width; the
                        drawing gains half the page. */}
                    <div className="lg:col-span-3 lg:pt-10">
                        <div className="flex items-center gap-2.5 lg:justify-end">
                            <BookOpen size={18} strokeWidth={1.5} className="text-[#CC0033] lg:order-2" />
                            <h2 className="font-serif text-2xl md:text-3xl text-[#002B5C] lg:order-1">
                                {txt("print_title")}
                            </h2>
                        </div>
                        <p className="text-sm text-[#4B5563] mt-2 lg:text-right leading-relaxed">
                            {txt("print_body")}
                        </p>
                        <ul className="mt-7 space-y-5">
                            {printPoints.map((item, i) => (
                                <Point key={item.id || i} item={item} align="right" />
                            ))}
                        </ul>
                        <div className="mt-8 lg:flex lg:justify-end">
                            <Link
                                to="/books"
                                data-testid="ebooks-browse-print"
                                className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors"
                            >
                                Browse the Bookstore
                                <ArrowUpRight size={14} strokeWidth={1.5} />
                            </Link>
                        </div>
                    </div>

                    {/* ---- the graphic ----
                        First on a phone, where it is the thing that explains the
                        page before any of the reading does. Between the columns
                        on a desktop, where it is the shared spine. */}
                    <div className="lg:col-span-6 order-first lg:order-none relative" style={rhythm}>
                        {/* Painted before its siblings, so it sits behind them
                            without needing a stacking context. Desktop only —
                            on a phone this column is full width and the copy
                            runs straight through the middle of it. */}
                        {portal && <OrbitField className="hidden lg:block" />}
                        <FormatSplitGraphic
                            animate={animate}
                            title={txt("art_title")}
                            author={txt("art_author")}
                            chapter={txt("art_chapter")}
                            pages={txt("art_pages")}
                        />

                        {/* Two bullet columns are taller than one wide drawing,
                            which left a long empty run down the middle of the
                            page on desktop. This fills it with the half of the
                            argument the columns only assert in words. */}
                        <div className="mt-10 lg:mt-12">
                            <CloudSyncGraphic animate={animate} />
                            <div className="mt-5 text-center max-w-sm mx-auto">
                                <div className="overline !text-[10px] !text-[#0A7D55]">
                                    {txt("cloud_kicker")}
                                </div>
                                <p className="font-serif text-xl md:text-2xl text-[#002B5C] mt-2 leading-tight">
                                    {txt("cloud_tagline")}
                                </p>
                                <p className="text-[13px] text-[#4B5563] mt-2.5 leading-relaxed">
                                    {txt("cloud_body")}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ---- digital ---- */}
                    <div className="lg:col-span-3 lg:pt-10">
                        <div className="flex items-center gap-2.5">
                            <Tablet size={18} strokeWidth={1.5} className="text-[#0A7D55]" />
                            <h2 className="font-serif text-2xl md:text-3xl text-[#002B5C]">
                                {txt("ebook_title")}
                            </h2>
                        </div>
                        <p className="text-sm text-[#4B5563] mt-2 leading-relaxed">{txt("ebook_body")}</p>
                        <ul className="mt-7 space-y-5">
                            {ebookPoints.map((item, i) => (
                                <Point key={item.id || i} item={item} align="left" />
                            ))}
                        </ul>
                        <div className="mt-8">
                            {canGoToReader ? (
                                <a
                                    href={readerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={onLeave}
                                    data-testid="ebooks-reader-link"
                                    className="inline-flex items-center gap-2 bg-[#0A7D55] text-white px-6 py-3 text-sm font-medium hover:bg-[#086645] transition-colors"
                                >
                                    Open the eReader
                                    <ArrowUpRight size={14} strokeWidth={1.5} />
                                </a>
                            ) : (
                                /* The master switch is off, or the destination
                                   was cleared in admin. Say so rather than
                                   rendering a button that goes nowhere. */
                                <span
                                    data-testid="ebooks-reader-off"
                                    className="inline-flex items-center font-mono text-[10px] uppercase tracking-widest text-[#4B5563] border border-[#E5E7EB] px-3 py-3"
                                >
                                    eReader opening soon
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* ============== CLOSING STRIP ============== */}
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-16 bg-[#F5F7FA] border-t border-[#E5E7EB]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 max-w-7xl mx-auto">
                    <div>
                        <div className="overline">{txt("cta_kicker")}</div>
                        <h2 className="font-serif text-2xl md:text-3xl mt-2 text-[#002B5C] max-w-2xl leading-tight">
                            {txt("cta_headline")}
                        </h2>
                    </div>
                    <Link
                        to="/books"
                        data-testid="ebooks-cta-books"
                        className="inline-flex items-center gap-2 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] transition-colors flex-shrink-0 self-start md:self-auto"
                    >
                        Browse all titles
                        <ArrowUpRight size={14} strokeWidth={1.5} />
                    </Link>
                </div>
            </section>
        </div>
    );
}
