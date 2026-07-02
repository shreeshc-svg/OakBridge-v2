import React from "react";
import { Sparkles, Database, Bot } from "lucide-react";
import ComingSoon from "./ComingSoon";

const FEATURES = [
    { icon: Sparkles, title: "Semantic search", text: "Ask plain-English questions across 500+ of our scholarly titles, with verified citations to the page." },
    { icon: Bot, title: "AI research copilots", text: "Practitioner-grade assistants for Tax, Corporate Law, M&A and GST research — grounded in Oakbridge sources only." },
    { icon: Database, title: "Licensed APIs", text: "Stream our editorial taxonomy, abstracts and commentary into your firm's research stack." },
];

export default function DigitalSolutions() {
    return (
        <ComingSoon
            pageTestId="coming-soon-page"
            eyebrow="Oakbridge · Digital Solutions"
            headline={
                <>
                    AI-powered research,
                    <br />
                    built on the
                </>
            }
            headlineAccent="books you trust."
            body="We're building a new line of digital products on top of Oakbridge's scholarly catalogue — semantic search, research copilots and licensed APIs for law firms, universities and fintechs. Launching soon."
            waitlistSource="digital-solutions-waitlist"
            emailPlaceholder="you@firm.com"
            stats={[
                { value: "500+", label: "Titles indexed" },
                { value: "Q3", label: "Beta launch target" },
                { value: "Q4", label: "General availability" },
            ]}
            featuresKicker="What's coming"
            featuresHeadline={
                <>
                    Three products.
                    <br />
                    One trusted source.
                </>
            }
            features={FEATURES}
        />
    );
}
