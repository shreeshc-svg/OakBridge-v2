import React from "react";
import { GraduationCap, BadgeCheck, BookOpen } from "lucide-react";
import ComingSoon from "./ComingSoon";

const FEATURES = [
    { icon: GraduationCap, title: "Certification tracks", text: "Multi-week certification programmes in Tax, Corporate Law, GST and Governance — taught by leading practitioners and our authors." },
    { icon: BadgeCheck, title: "CPD-accredited programmes", text: "Continuing Professional Development credits for Advocates, Chartered Accountants and Company Secretaries." },
    { icon: BookOpen, title: "In-house workshops", text: "Bespoke training delivered on-site for law firms, in-house legal teams and corporates — built around your priorities." },
];

export default function Academy() {
    return (
        <ComingSoon
            pageTestId="coming-soon-page"
            eyebrow="Oakbridge · Academy"
            headline={
                <>
                    Practitioner training,
                    <br />
                    taught by the
                </>
            }
            headlineAccent="authors you read."
            body="The Oakbridge Academy is a new home for CPD-accredited certification programmes and in-house workshops — drawing from the same practitioner-authors who write our reference titles. Cohorts open soon."
            waitlistSource="academy-waitlist"
            emailPlaceholder="you@firm.com"
            stats={[
                { value: "12+", label: "Tracks in development" },
                { value: "CPD", label: "Accredited" },
                { value: "Q4", label: "First cohort target" },
            ]}
            featuresKicker="What's coming"
            featuresHeadline={
                <>
                    Three formats.
                    <br />
                    One faculty.
                </>
            }
            features={FEATURES}
        />
    );
}
