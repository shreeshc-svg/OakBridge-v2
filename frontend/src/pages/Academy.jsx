import React, { useEffect, useState } from "react";
import { GraduationCap, BadgeCheck, BookOpen, Award } from "lucide-react";
import ComingSoon from "./ComingSoon";
import { fetchSiteContent, fetchCollection } from "../lib/api";

// Icons referenced by name so admin-editable features can pick one.
const ICONS = { GraduationCap, BadgeCheck, BookOpen, Award };

const DEFAULTS = {
    eyebrow: "Oakbridge · Academy",
    headline: "Practitioner training,\ntaught by the",
    accent: "authors you read.",
    body: "The Oakbridge Academy is a new home for CPD-accredited certification programmes and in-house workshops — drawing from the same practitioner-authors who write our reference titles. Cohorts open soon.",
    features_kicker: "What's coming",
    features_headline: "Three formats.\nOne faculty.",
};

const DEFAULT_FEATURES = [
    { icon: "GraduationCap", title: "Certification tracks", text: "Multi-week certification programmes in Tax, Corporate Law, GST and Governance — taught by leading practitioners and our authors." },
    { icon: "BadgeCheck", title: "CPD-accredited programmes", text: "Continuing Professional Development credits for Advocates, Chartered Accountants and Company Secretaries." },
    { icon: "BookOpen", title: "In-house workshops", text: "Bespoke training delivered on-site for law firms, in-house legal teams and corporates — built around your priorities." },
];

const DEFAULT_STATS = [
    { value: "12+", label: "Tracks in development" },
    { value: "CPD", label: "Accredited" },
    { value: "Q4", label: "First cohort target" },
];

export default function Academy() {
    const [site, setSite] = useState({});
    const [features, setFeatures] = useState([]);
    const [stats, setStats] = useState([]);

    useEffect(() => {
        fetchSiteContent().then(setSite).catch(() => {});
        fetchCollection("page_ac_features").then((d) => setFeatures(d?.items || [])).catch(() => {});
        fetchCollection("page_ac_stats").then((d) => setStats(d?.items || [])).catch(() => {});
    }, []);

    const resolvedFeatures = (features.length ? features : DEFAULT_FEATURES).map((f) => ({
        ...f,
        icon: ICONS[f.icon] || GraduationCap,
    }));

    return (
        <ComingSoon
            pageTestId="coming-soon-page"
            eyebrow={site.ac_eyebrow || DEFAULTS.eyebrow}
            headline={site.ac_headline || DEFAULTS.headline}
            headlineAccent={site.ac_accent ?? DEFAULTS.accent}
            body={site.ac_body || DEFAULTS.body}
            waitlistSource="academy-waitlist"
            emailPlaceholder="you@firm.com"
            stats={stats.length ? stats : DEFAULT_STATS}
            featuresKicker={site.ac_features_kicker || DEFAULTS.features_kicker}
            featuresHeadline={site.ac_features_headline || DEFAULTS.features_headline}
            features={resolvedFeatures}
        />
    );
}
