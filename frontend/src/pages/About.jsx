import React from "react";
import Seo from "../components/Seo";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

const milestones = [
    { year: "2017", text: "Oakbridge Publishing founded in New Delhi by two veteran publishing professionals with leadership experience at some of the world's most respected publishing houses." },
    { year: "2019", text: "First School list rolled out across 120 schools in four states." },
    { year: "2022", text: "Launch of the Higher Education and Professional lists — including our flagship Law and Tax titles." },
    { year: "2024", text: "Coffee Table & Curated Works imprints added, serving corporations, institutions and estates." },
    { year: "2025", text: "Oakbridge Digital — a companion platform for interactive learning — goes live." },
];

export default function About() {
    return (
        <div data-testid="about-page">
            <Seo
                title="About"
                description="Oakbridge Publishing is an independent scholarly press founded in 2017 by two veteran publishing professionals, producing authoritative law, tax, business and academic titles."
                path="/about"
            />
            <section className="px-6 md:px-12 lg:px-16 pt-20 pb-24 border-b border-[#E5E7EB]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                    <div className="lg:col-span-7">
                        <div className="overline">About Oakbridge</div>
                        <h1 className="font-serif text-5xl md:text-7xl mt-6 text-[#002B5C] leading-[0.95]">
                            A modern press
                            <br />
                            for a <em className="text-[#CC0033]">country</em>
                            <br />
                            being rewritten.
                        </h1>
                    </div>
                    <div className="lg:col-span-5">
                        <p className="text-[#4B5563] leading-relaxed">
                            Oakbridge Publishing was founded in 2017 by two
                            veteran publishing professionals with leadership
                            experience at some of the world's most respected
                            publishing companies. The premise was simple —
                            India deserves its own scholarly voice, published
                            from within, for the students, educators and
                            practitioners who live here. We publish across five
                            imprints: Academic, Professional, General, Coffee
                            Table and Curated Works. Every manuscript is
                            shepherded by editors with decades of international
                            publishing experience.
                        </p>
                        <p className="mt-5 text-[#4B5563] leading-relaxed">
                            We remain a privately-held, independent publisher —
                            which means our editorial choices are made by
                            readers and educators, not shareholders.
                        </p>
                    </div>
                </div>
            </section>

            <section className="px-6 md:px-12 lg:px-16 py-24 bg-[#F5F7FA] border-b border-[#E5E7EB]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                    <div className="lg:col-span-4">
                        <div className="overline">Our Timeline</div>
                        <h2 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight">
                            Eight years, many states,
                            <br />
                            one standard.
                        </h2>
                    </div>
                    <div className="lg:col-span-8">
                        <div className="space-y-0">
                            {milestones.map((m, i) => (
                                <div
                                    key={m.year}
                                    className="grid grid-cols-12 gap-6 py-8 border-t border-[#002B5C]/20"
                                >
                                    <div className="col-span-3 md:col-span-2 font-serif text-3xl text-[#CC0033]">
                                        {m.year}
                                    </div>
                                    <p className="col-span-9 md:col-span-10 text-[#002B5C] leading-relaxed">
                                        {m.text}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section
                id="careers"
                className="px-6 md:px-12 lg:px-16 py-24"
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div>
                        <div className="overline">Careers</div>
                        <h3 className="font-serif text-3xl mt-3 text-[#002B5C]">
                            Join our list.
                        </h3>
                        <p className="text-sm text-[#4B5563] mt-4 leading-relaxed">
                            We hire editors, designers, and field specialists
                            who believe publishing is a craft of public
                            service. Send us your work.
                        </p>
                        <Link
                            to="/contact"
                            className="mt-5 inline-flex items-center gap-1 border-b border-[#002B5C] pb-0.5 text-sm font-medium"
                        >
                            careers@oakbridge.in <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    <div id="press">
                        <div className="overline">Press</div>
                        <h3 className="font-serif text-3xl mt-3 text-[#002B5C]">
                            Media inquiries.
                        </h3>
                        <p className="text-sm text-[#4B5563] mt-4 leading-relaxed">
                            For review copies, interviews with our authors or
                            editorial briefings, reach out to our press team.
                        </p>
                        <Link
                            to="/contact"
                            className="mt-5 inline-flex items-center gap-1 border-b border-[#002B5C] pb-0.5 text-sm font-medium"
                        >
                            press@oakbridge.in <ArrowUpRight size={14} />
                        </Link>
                    </div>
                    <div id="legal">
                        <div className="overline">Legal</div>
                        <h3 className="font-serif text-3xl mt-3 text-[#002B5C]">
                            The fine print.
                        </h3>
                        <p className="text-sm text-[#4B5563] mt-4 leading-relaxed">
                            Oakbridge Publishing Pvt. Ltd. — CIN
                            U22100DL2017PTC000000 · Registered office: 14
                            Hauz Khas Village, New Delhi 110016.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    );
}
