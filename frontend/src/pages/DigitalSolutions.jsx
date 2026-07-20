import React, { useEffect, useState } from "react";
import { Sparkles, Database, Bot, Cpu } from "lucide-react";
import ComingSoon from "./ComingSoon";
import { fetchSiteContent, fetchCollection } from "../lib/api";

// Icons referenced by name so admin-editable features can pick one.
const ICONS = { Sparkles, Database, Bot, Cpu };

const DEFAULTS = {
    eyebrow: "Oakbridge · Digital Solutions",
    headline: "AI-powered research,\nbuilt on the",
    accent: "books you trust.",
    body: "We're building a new line of digital products on top of Oakbridge's scholarly catalogue — semantic search, research copilots and licensed APIs for law firms, universities and fintechs. Launching soon.",
    features_kicker: "What's coming",
    features_headline: "Three products.\nOne trusted source.",
};

const DEFAULT_FEATURES = [
    { icon: "Sparkles", title: "Semantic search", text: "Ask plain-English questions across 500+ of our scholarly titles, with verified citations to the page." },
    { icon: "Bot", title: "AI research copilots", text: "Practitioner-grade assistants for Tax, Corporate Law, M&A and GST research — grounded in Oakbridge sources only." },
    { icon: "Database", title: "Licensed APIs", text: "Stream our editorial taxonomy, abstracts and commentary into your firm's research stack." },
];

const DEFAULT_STATS = [
    { value: "500+", label: "Titles indexed" },
    { value: "Q3", label: "Beta launch target" },
    { value: "Q4", label: "General availability" },
];

export default function DigitalSolutions() {
    const [site, setSite] = useState({});
    const [features, setFeatures] = useState([]);
    const [stats, setStats] = useState([]);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchCollection("page_ds_features").then((d) => setFeatures(d?.items || [])).catch(() => {});
        fetchCollection("page_ds_stats").then((d) => setStats(d?.items || [])).catch(() => {});
    }, []);

    const resolvedFeatures = (features.length ? features : DEFAULT_FEATURES).map((f) => ({
        ...f,
        icon: ICONS[f.icon] || Sparkles,
    }));

    return (
        <ComingSoon
            pageTestId="coming-soon-page"
            eyebrow={site.ds_eyebrow || DEFAULTS.eyebrow}
            headline={site.ds_headline || DEFAULTS.headline}
            headlineAccent={site.ds_accent ?? DEFAULTS.accent}
            body={site.ds_body || DEFAULTS.body}
            waitlistSource="digital-solutions-waitlist"
            emailPlaceholder="you@firm.com"
            stats={stats.length ? stats : DEFAULT_STATS}
            featuresKicker={site.ds_features_kicker || DEFAULTS.features_kicker}
            featuresHeadline={site.ds_features_headline || DEFAULTS.features_headline}
            features={resolvedFeatures}
        />
    );
}
