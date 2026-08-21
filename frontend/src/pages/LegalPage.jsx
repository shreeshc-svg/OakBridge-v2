import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Breadcrumbs from "../components/Breadcrumbs";
import Seo from "../components/Seo";
import { fetchLegalPage } from "../lib/api";

// --- minimal, safe markdown renderer (headings, lists, bold, italic, links) ---
const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|_[^_]+_)/g;

function renderInline(text, kp) {
    return text.split(INLINE).map((p, i) => {
        const key = `${kp}-${i}`;
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={key}>{p.slice(2, -2)}</strong>;
        if (/^_[^_]+_$/.test(p)) return <em key={key} className="text-[#4B5563]">{p.slice(1, -1)}</em>;
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (m) {
            const href = m[2];
            if (/^https?:\/\//.test(href)) {
                return (
                    <a key={key} href={href} target="_blank" rel="noreferrer" className="text-[#002B5C] underline">
                        {m[1]}
                    </a>
                );
            }
            return <Link key={key} to={href} className="text-[#002B5C] underline">{m[1]}</Link>;
        }
        return p;
    });
}

function renderMarkdown(md) {
    const lines = (md || "").split("\n");
    const blocks = [];
    let para = [];
    let list = [];
    const flushPara = () => {
        if (para.length) {
            blocks.push(
                <p key={`p-${blocks.length}`} className="mt-4 text-[#4B5563] leading-relaxed">
                    {renderInline(para.join(" "), `p${blocks.length}`)}
                </p>,
            );
            para = [];
        }
    };
    const flushList = () => {
        if (list.length) {
            blocks.push(
                <ul key={`ul-${blocks.length}`} className="mt-4 space-y-2 list-disc pl-6 text-[#4B5563] leading-relaxed">
                    {list.map((li, i) => (
                        <li key={i}>{renderInline(li, `ul${blocks.length}-${i}`)}</li>
                    ))}
                </ul>,
            );
            list = [];
        }
    };
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) {
            flushPara();
            flushList();
            continue;
        }
        if (line.startsWith("### ")) {
            flushPara(); flushList();
            blocks.push(<h3 key={`h3-${blocks.length}`} className="font-serif text-xl mt-8 text-[#002B5C]">{renderInline(line.slice(4), `h3${blocks.length}`)}</h3>);
        } else if (line.startsWith("## ")) {
            flushPara(); flushList();
            blocks.push(<h2 key={`h2-${blocks.length}`} className="font-serif text-2xl mt-10 text-[#002B5C]">{renderInline(line.slice(3), `h2${blocks.length}`)}</h2>);
        } else if (line.startsWith("# ")) {
            flushPara(); flushList();
            blocks.push(<h2 key={`h1-${blocks.length}`} className="font-serif text-2xl mt-10 text-[#002B5C]">{renderInline(line.slice(2), `h1${blocks.length}`)}</h2>);
        } else if (line.startsWith("- ")) {
            flushPara();
            list.push(line.slice(2));
        } else {
            flushList();
            para.push(line.trim());
        }
    }
    flushPara();
    flushList();
    return blocks;
}

export default function LegalPage({ slug }) {
    const { pathname } = useLocation();
    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        setLoading(true);
        setNotFound(false);
        fetchLegalPage(slug)
            .then(setPage)
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [slug]);

    const title = page?.title || "Legal";

    return (
        <div data-testid={`legal-page-${slug}`}>
            <Breadcrumbs items={[{ label: title }]} />
            {/*
                The canonical is the URL we are actually on, not one built from
                the slug.

                It used to be `/${slug}`, and three of the five slugs do not
                match their route: "shipping" serves /shipping-policy, "refund"
                serves /refund-policy, "cookie" serves /cookie-policy. So those
                pages told Google the real version of themselves lived at
                /shipping, /refund and /cookie — URLs that do not exist. Terms
                and privacy happened to match, which is why it went unnoticed.

                Reading the location makes the two impossible to drift apart:
                the canonical is the page, by construction.
            */}
            <Seo
                title={title}
                description={`${title} — Oakbridge Publishing.`}
                path={pathname}
            />
            <section className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 pt-16 pb-24 max-w-3xl">
                <div className="overline">Legal</div>
                <h1 className="font-serif text-4xl md:text-5xl mt-3 text-[#002B5C] leading-tight">
                    {title}
                </h1>
                {loading && <p className="mt-8 font-mono text-xs text-[#4B5563]">Loading…</p>}
                {notFound && (
                    <p className="mt-8 text-[#4B5563]">
                        This page isn’t available. <Link to="/" className="text-[#002B5C] underline">Back to home</Link>.
                    </p>
                )}
                {page && <div className="mt-6">{renderMarkdown(page.content)}</div>}
            </section>
        </div>
    );
}
