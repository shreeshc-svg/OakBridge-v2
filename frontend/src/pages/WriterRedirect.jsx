import React, { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { fetchAuthors } from "../lib/api";
import NotFound from "./NotFound";

/**
 * /writer/<slug> — the OLD site's author URL, kept alive for the rankings it
 * still holds.
 *
 * WHY THIS EXISTS
 *
 * Google ranks https://www.oakbridge.in/writer/somesh-upadhyay at position 8
 * for "somesh upadhyay ias" (260 searches a month) and it was, in September
 * 2026, the single highest-traffic landing page on the site. There is no
 * /writer/ route in this app, so every one of those visitors met the 404 page.
 * The equivalent page — /authors/somesh-upadhyay — exists and is good.
 *
 * WHY IT IS AN ALLOWLIST AND NOT A PATTERN REDIRECT
 *
 * The obvious fix is one line in vercel.json: /writer/:slug* -> /authors/:slug*.
 * It is not safe here. The pre-cutover oakbridge.in was COMPROMISED and had
 * spam pages injected under its own URL space; a pattern redirect would accept
 * any /writer/... path an attacker has already built links to and forward its
 * signals into this site. So a slug redirects only if it names a real author in
 * the live roster, and anything else gets the ordinary 404.
 *
 * The allowlist maintains itself: it IS the author table, read at request time,
 * so an author added tomorrow is covered without anyone editing a list.
 *
 * WHY A CLIENT-SIDE REDIRECT
 *
 * Vercel serves the SPA shell for every unknown path, so there is no server in
 * front of this to issue a 301 — the app is the first thing that sees the URL.
 * Google executes JS and follows a replace-navigation, and treats a consistent
 * one as a permanent redirect, but it IS weaker than a real 301. If these
 * rankings turn out to matter more than they look, the stronger version is a
 * generated block of explicit per-slug redirects in vercel.json, which stays an
 * allowlist and gains a true 301.
 *
 * `replace` matters: without it the dead URL stays in history and Back lands
 * the visitor straight back on it.
 */
export default function WriterRedirect() {
    const { id } = useParams();
    const [known, setKnown] = useState(null); // null = still checking

    useEffect(() => {
        let live = true;
        fetchAuthors()
            .then((rows) => {
                if (!live) return;
                const slug = String(id || "").toLowerCase();
                const hit = (Array.isArray(rows) ? rows : []).some(
                    (a) => String(a?.id || "").toLowerCase() === slug,
                );
                setKnown(hit);
            })
            /* A failed roster fetch must not invent a redirect. Falling through
               to the 404 is the honest answer, and it is also the safe one —
               the allowlist is the entire security property here. */
            .catch(() => live && setKnown(false));
        return () => {
            live = false;
        };
    }, [id]);

    if (known === null) {
        return (
            <div className="px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40 py-32 text-center text-sm font-mono text-[#4B5563]">
                Loading…
            </div>
        );
    }
    if (known) return <Navigate to={`/authors/${id}`} replace />;
    return <NotFound />;
}
