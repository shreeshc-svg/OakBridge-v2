import React, { useEffect, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { fetchSiteContent, fetchSettings, fetchCollection, resolveCollection, mediaUrl } from "../lib/api";
import { hiddenSet } from "../lib/sections";
import TimelineRoad, { MilestoneList } from "../components/about/TimelineRoad";
import { breadcrumbLd } from "../lib/schema";

/**
 * Renders admin-editable copy. Text wrapped in *asterisks* is shown in the
 * accent red, so headline highlights stay editable from the admin.
 */
function renderRich(text) {
    const parts = String(text || "").split(/(\*[^*]+\*)/g);
    return parts.map((p, i) =>
        p.length > 2 && p.startsWith("*") && p.endsWith("*") ? (
            <em key={i} className="text-[#CC0033] not-italic">
                {p.slice(1, -1)}
            </em>
        ) : (
            <React.Fragment key={i}>{p}</React.Fragment>
        ),
    );
}

const DEFAULTS = {
    overline: "About Oakbridge",
    title: "A modern press\nfor a *country*\nbeing rewritten.",
    body1: "Oakbridge Publishing was founded in 2017 by two veteran publishing professionals with leadership experience at some of the world's most respected publishing companies. The premise was simple — India deserves its own scholarly voice, published from within, for the students, educators and practitioners who live here. We publish across five imprints: Academic, Professional, General, Coffee Table and Curated Works. Every manuscript is shepherded by editors with decades of international publishing experience.",
    body2: "We remain a privately-held, independent publisher — which means our editorial choices are made by readers and educators, not shareholders.",
    timeline_overline: "Our Timeline",
    timeline_title: "Eight years, many states,\none standard.",
};

/*
 * One line per point. The renderer turns two or more lines into bullets and
 * leaves a single line as a paragraph.
 *
 * NOTE: these are the built-in defaults, which the live site does NOT use —
 * page_about_milestones is `configured` in the database, so resolveCollection
 * ignores everything here. They matter for a fresh environment and as the
 * reference copy; changing the live timeline means editing it in
 * Admin → Pages → About, or running the update script.
 */
const DEFAULT_MILESTONES = [
    {
        year: "2017",
        text:
            "Founded on 25 July 2017 by two publishing veterans with over two decades of experience at global publishing companies.\n" +
            "Published our first five titles and hosted a conference on GST.",
    },
    {
        year: "2018",
        text:
            "First full year of operations, with 46 titles across the academic and professional lists.\n" +
            "Conducted a conference on the Insolvency and Bankruptcy Code.",
    },
    {
        year: "2019",
        text:
            "The list crossed 85 titles.\n" +
            "Law, Justice & Judicial Power was released by the President of India, Sh Ram Nath Kovind.\n" +
            "Conducted a conference on arbitration.\n" +
            "Constitutional Supremacy was cited in the Supreme Court of India.",
    },
    { year: "2020", text: "Moved into general books under the CURSIVE imprint." },
    {
        year: "2021",
        text:
            "The list crossed 100 titles.\n" +
            "Accelerating India was released by the Vice President of India, Sh M Venkaiah Naidu.",
    },
    { year: "2022", text: "Growth resumed after Covid, surpassing pre-pandemic revenues." },
    { year: "2023", text: "The catalogue crossed 250 titles." },
    { year: "2024", text: "Hosted Vidhi Utsav, India's first law and legal literature festival, with 90 speakers and over 800 attendees." },
    {
        year: "2025",
        text:
            "Introduced the India Legal Tech and AI Summit, with 40+ speakers and over 200 attendees.\n" +
            "Partnered with the CTC and published a series of journals in their centenary year.",
    },
    {
        year: "2026",
        text:
            "Launched our new website.\n" +
            "Moved into coffee-table books.\n" +
            "eBook store coming soon.",
    },
];

const DEFAULT_COLUMNS = [
    { id: "careers", overline: "Careers", title: "Join our list.", text: "We hire editors, designers, and field specialists who believe publishing is a craft of public service. See our open roles and apply.", link_label: "View open roles", link_to: "/careers" },
    { id: "press", overline: "Press", title: "Media inquiries.", text: "For review copies, interviews with our authors or editorial briefings, reach out to our press team.", link_label: "press@oakbridge.in", link_to: "/contact" },
];

const DEFAULT_TEAM = [
    {
        id: "shreesh-chandra",
        name: "Shreesh Chandra",
        role: "Founder, Director",
        photo: "/team/shreesh-chandra.jpg",
        bio: "Shreesh has over 25 years of experience cutting across the publishing and education industry. Having started his publishing career with McGraw Hill Education, he has worked with leading publishing companies like Macmillan, Wolters Kluwer and LexisNexis. In between his stints at publishing outfits, he also has the credit of setting up the franchise business for Hughes Escorts Communication Limited and Triumphant Institute of Management Education. With well-rounded experience in leadership roles across Sales, Marketing, Product and Solutions Development, he enjoys the reputation of setting up new businesses and turning around old ones.\n\nHaving won various international awards for his contributions at work, he has been instrumental in the growth journey of most organisations he has worked for. Shreesh holds an executive MBA from IIM Bangalore.",
    },
    {
        id: "vikesh-dhyani",
        name: "Vikesh Dhyani",
        role: "Co-Founder, Director",
        photo: "/team/vikesh-dhyani.jpg",
        bio: "Vikesh Dhyani has worked in various strategic and operational sales, marketing, product and business development roles with three of the world's largest higher and professional education, learning and analytic research solution companies over the last 25 years. Vikesh started his career with McGraw-Hill Education in sales and went on to head marketing for Pearson before joining LexisNexis/RELX Group to lead Marketing and Innovation functions.\n\nHe is a customer-centric leader, passionate about building strategic win-win partnerships, driving market and business transformation and improving customer experience. He has been instrumental in securing several awards and global accolades for business by leveraging content and technology with robust omni-channel marketing. Vikesh has done his Executive Management Program from IIM Bangalore and is a certified Pragmatic Marketing Professional. He also hosts two podcasts, 'iAspire' and 'Marketing Demystified', on YouTube.",
    },
];

export default function About() {
    const [site, setSite] = useState({});
    const [settings, setSettings] = useState(null);
    const [milestonesData, setMilestonesData] = useState(null);
    const [columnsData, setColumnsData] = useState(null);
    const [teamData, setTeamData] = useState(null);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchSettings().then(setSettings).catch(() => {});
        fetchCollection("page_about_milestones").then(setMilestonesData).catch(() => {});
        fetchCollection("page_about_columns").then(setColumnsData).catch(() => {});
        fetchCollection("page_about_team").then(setTeamData).catch(() => {});
    }, []);

    const c = {
        overline: site.about_overline || DEFAULTS.overline,
        title: site.about_title || DEFAULTS.title,
        body1: site.about_body1 || DEFAULTS.body1,
        body2: site.about_body2 ?? DEFAULTS.body2,
        timeline_overline: site.about_timeline_overline || DEFAULTS.timeline_overline,
        timeline_title: site.about_timeline_title || DEFAULTS.timeline_title,
    };
    const hidden = hiddenSet(settings);
    const items = resolveCollection(milestonesData, DEFAULT_MILESTONES);
    const cols = resolveCollection(columnsData, DEFAULT_COLUMNS);
    const people = resolveCollection(teamData, DEFAULT_TEAM);

    return (
        <div data-testid="about-page">
            <Breadcrumbs items={[{ label: "About" }]} />
            <Seo
                title="About"
                description="An independent scholarly press founded in 2017 by two publishing veterans, producing authoritative law, tax, business and academic titles."
                path="/about"
                jsonLd={breadcrumbLd([{ name: "About" }])}
            />
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-12 pb-14 md:pt-20 md:pb-24 border-b border-[#E5E7EB]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-10">
                    <div className="lg:col-span-7">
                        <div className="overline">{c.overline}</div>
                        <h1 className="font-serif text-5xl md:text-7xl mt-6 text-[#002B5C] leading-[0.95] whitespace-pre-line">
                            {renderRich(c.title)}
                        </h1>
                    </div>
                    <div className="lg:col-span-5">
                        <p className="text-[#4B5563] leading-relaxed whitespace-pre-line">{c.body1}</p>
                        {c.body2 && (
                            <p className="mt-5 text-[#4B5563] leading-relaxed whitespace-pre-line">{c.body2}</p>
                        )}
                    </div>
                </div>
            </section>

            {/* Hideable from Admin → Pages → Section visibility, through the
                same hidden_sections setting every other page already uses.
                About was simply never listed in SECTION_REGISTRY. */}
            {!hidden.has("about.timeline") && (
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-14 md:py-24 bg-[#F5F7FA] border-b border-[#E5E7EB]">
                {/* The heading sits ABOVE the grid rather than in the left
                    column. It has to: the spine can only line up with the years
                    if it starts level with the first row, and a heading in that
                    column pushed it 270px down — which is why the dots matched
                    nothing. Moving it out also gives it the full width it wants
                    at 5xl. */}
                <div className="max-w-2xl mb-8 md:mb-14">
                    <div className="overline">{c.timeline_overline}</div>
                    <h2 className="font-serif text-3xl md:text-5xl mt-2 md:mt-3 text-[#002B5C] leading-tight whitespace-pre-line">
                        {renderRich(c.timeline_title)}
                    </h2>
                </div>
                {/* lg and up: the climb, which shows nine years in one frame.
                    Below that: the list, unchanged. A 1120-wide mountain does
                    not survive a 375px screen, and a miniature of it would be
                    worse than the list at both reading and looking. */}
                <div className="hidden lg:block">
                    <TimelineRoad items={items} />
                </div>

                {/* Same component the road falls back to, so the two renderings
                    of this history can never drift apart. */}
                <div className="lg:hidden">
                    <MilestoneList items={items} />
                </div>
            </section>
            )}

            {people.length > 0 && (
                <section
                    id="team"
                    data-testid="about-management-team"
                    className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-14 md:py-24 border-b border-[#E5E7EB]"
                >
                    <div className="max-w-3xl mb-8 md:mb-16">
                        <div className="overline">{site.about_team_overline || "Our Management Team"}</div>
                        <h2 className="font-serif text-3xl md:text-5xl mt-3 md:mt-4 text-[#002B5C] leading-[1.05] whitespace-pre-line">
                            {renderRich(site.about_team_title || "The people behind\nthe imprint.")}
                        </h2>
                    </div>
                    <div className="space-y-16">
                        {people.map((p, i) => (
                            <div
                                key={p.id || i}
                                data-testid={`team-member-${p.id || i}`}
                                className={`grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-10 items-start ${i % 2 === 1 ? "lg:[&>div:first-child]:order-2" : ""}`}
                            >
                                <div className="lg:col-span-4">
                                    <div className="aspect-square overflow-hidden bg-[#F5F7FA] border border-[#E5E7EB] max-w-[280px] sm:max-w-[340px] lg:max-w-none mx-auto lg:mx-0">
                                        {p.photo ? (
                                            <img
                                                src={mediaUrl(p.photo) || p.photo}
                                                alt={p.name}
                                                loading="lazy"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : null}
                                    </div>
                                </div>
                                <div className="lg:col-span-8">
                                    <h3 className="font-serif text-3xl md:text-4xl text-[#002B5C] leading-tight">
                                        {p.name}
                                    </h3>
                                    <div className="overline !text-[10px] !text-[#CC0033] mt-2">{p.role}</div>
                                    <p className="mt-5 text-[#4B5563] leading-relaxed whitespace-pre-line">
                                        {p.bio}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <section id="careers" className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-14 md:py-24">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 max-w-4xl">
                    {cols.map((col, i) => (
                        <div key={col.id || i} id={col.id || undefined}>
                            <div className="overline">{col.overline}</div>
                            <h3 className="font-serif text-3xl mt-3 text-[#002B5C]">{col.title}</h3>
                            <p className="text-sm text-[#4B5563] mt-4 leading-relaxed whitespace-pre-line">
                                {col.text}
                            </p>
                            {col.link_label && (
                                <Link
                                    to={col.link_to || "/contact"}
                                    className="mt-5 inline-flex items-center gap-1 border-b border-[#002B5C] pb-0.5 text-sm font-medium"
                                >
                                    {col.link_label} <ArrowUpRight size={14} />
                                </Link>
                            )}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
