import { useEffect, useState } from "react";

/*
 * HB / PB after a book's title on every warehouse screen (Nov 2026):
 * Hardback / Paperback (PB, not SB — the house calls it Paperback).
 *
 * The same title can be on the shelf twice — "Justice M N Venkatachaliah -
 * The Man & The Judge" is a Paperback (9788169999199) AND a Hardback
 * (9788194991120) — and a carton packed with the wrong one is a wrong
 * delivery. So wherever the warehouse sees a book it reads
 * "… The Man & The Judge (HB)".
 *
 * Added at the DATA BOUNDARY, not per screen: lib/api.js passes the warehouse
 * book lists through tagBooks(), so every picker, every byId[...] lookup and
 * every toast built from them already carries the tag. Titles the server
 * sends inside other objects (inbox lines, owed rows, order items) carry a
 * book id instead, and go through titleFor(title, bookId), which reads the
 * id -> binding map filled by those same lists. useBindings() at the top of
 * the warehouse screens makes sure that map is loaded and re-renders once
 * it is.
 *
 * The book's real title is never changed — only what is shown. `plain_title`
 * keeps the original on tagged rows.
 */

export function bindingTag(binding) {
    const b = String(binding || "").toLowerCase();
    if (!b) return "";
    // Dust jacket or not, it's a hardback: HB (house rule, 19 Nov 2026).
    if (/hard|case|cloth/.test(b)) return "HB";
    if (/soft|paper/.test(b)) return "PB";
    if (/spiral/.test(b)) return "Spiral";
    return "";
}

export function withBinding(title, binding) {
    const t = String(title || "");
    const tag = bindingTag(binding);
    if (!tag || !t || t.endsWith(`(${tag})`)) return t;
    return `${t} (${tag})`;
}

const MAP = {};
const listeners = new Set();
let loading = null;

export function rememberBindings(books) {
    let changed = false;
    for (const b of books || []) {
        if (b && b.id && b.binding !== undefined && MAP[b.id] !== (b.binding || "")) {
            MAP[b.id] = b.binding || "";
            changed = true;
        }
    }
    if (changed) listeners.forEach((f) => f());
}

/** Rows with id/title/binding -> same rows, title tagged (plain_title kept). */
export function tagBooks(rows) {
    if (!Array.isArray(rows)) return rows;
    rememberBindings(rows);
    return rows.map((b) => (b && b.title ? { ...b, plain_title: b.plain_title || b.title, title: withBinding(b.title, b.binding) } : b));
}

/** The binding remembered for a book id ("" when unknown). */
export const bindingOf = (bookId) => (bookId ? MAP[bookId] || "" : "");

/** A title the server sent next to a book id (inbox lines, owed rows, order items). */
export const titleFor = (title, bookId) => withBinding(title, bookId ? MAP[bookId] : "");

/** Load the id -> binding map once (via the given list loader) and re-render when it arrives. */
export function useBindings(load) {
    const [, tick] = useState(0);
    useEffect(() => {
        const f = () => tick((n) => n + 1);
        listeners.add(f);
        if (!Object.keys(MAP).length && load && !loading) {
            loading = Promise.resolve(load()).catch(() => {}).finally(() => { loading = null; });
        }
        return () => listeners.delete(f);
    }, [load]);
    return titleFor;
}
