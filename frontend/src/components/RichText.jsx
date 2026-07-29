import React from "react";

/**
 * Renders a small, safe subset of Markdown.
 *
 * WHY NOT react-markdown
 *
 * It is the obvious answer, and for a big surface it would be the right one.
 * Here it buys a dependency, a bundle-size increase and a sanitiser to
 * configure, to support a fraction of what it does. Job descriptions need
 * headings, bold, bullets and rules — that is the whole requirement.
 *
 * WHY THIS IS SAFE
 *
 * It builds React ELEMENTS, never HTML strings, and never touches
 * dangerouslySetInnerHTML. React escapes every text node, so a description
 * containing <script>alert(1)</script> renders those characters visibly on the
 * page instead of executing. Injection is impossible by construction rather
 * than by filtering, which is the difference between a guarantee and a
 * best-effort. Link hrefs are the one place a string reaches the DOM as a URL,
 * so they are checked against a scheme allowlist — javascript: is a real attack
 * even without raw HTML.
 *
 * SUPPORTED
 *   # / ## / ###      headings
 *   - or * item       bullet list
 *   1. item           numbered list
 *   ---               horizontal rule
 *   **bold**  *italic*  `code`  [text](url)
 *   blank line        new paragraph
 *
 * Anything else renders as the literal text the author typed, which is the
 * right failure mode: nothing disappears silently.
 */

const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;

/** Inline spans: bold, italic, code, links. Returns an array of React nodes. */
function inline(text, keyPrefix = "i") {
    const out = [];
    // One pass, alternation ordered so ** is matched before *.
    const re = /(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;
    let last = 0;
    let m;
    let n = 0;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const tok = m[0];
        const key = `${keyPrefix}-${n++}`;
        if (tok.startsWith("**")) {
            out.push(<strong key={key} className="font-semibold text-[#002B5C]">{tok.slice(2, -2)}</strong>);
        } else if (tok.startsWith("`")) {
            out.push(<code key={key} className="font-mono text-[0.9em] bg-[#F5F7FA] px-1 py-0.5">{tok.slice(1, -1)}</code>);
        } else if (tok.startsWith("[")) {
            const label = tok.slice(1, tok.indexOf("]"));
            const url = tok.slice(tok.indexOf("(") + 1, -1);
            out.push(
                SAFE_URL.test(url) ? (
                    <a
                        key={key}
                        href={url}
                        className="underline hover:text-[#CC0033]"
                        {...(url.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                        {label}
                    </a>
                ) : (
                    // Not a scheme we allow — show the author's literal text
                    // rather than quietly dropping it or rendering the link.
                    <span key={key}>{tok}</span>
                ),
            );
        } else {
            out.push(<em key={key}>{tok.slice(1, -1)}</em>);
        }
        last = m.index + tok.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length ? out : [text];
}

const isBullet = (l) => /^\s*[-*]\s+/.test(l);
const isNumber = (l) => /^\s*\d+[.)]\s+/.test(l);

export default function RichText({ text, className = "" }) {
    if (!text || typeof text !== "string") return null;

    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let para = [];

    const flushPara = () => {
        if (para.length) {
            blocks.push({ type: "p", lines: para });
            para = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
            flushPara();
            continue;
        }
        if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
            flushPara();
            blocks.push({ type: "hr" });
            continue;
        }
        const h = line.match(/^\s*(#{1,3})\s+(.*)$/);
        if (h) {
            flushPara();
            blocks.push({ type: "h", level: h[1].length, text: h[2] });
            continue;
        }
        if (isBullet(line) || isNumber(line)) {
            flushPara();
            const ordered = isNumber(line);
            const items = [];
            while (i < lines.length && (ordered ? isNumber(lines[i]) : isBullet(lines[i]))) {
                items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ""));
                i++;
            }
            i--;
            blocks.push({ type: "list", ordered, items });
            continue;
        }
        para.push(line);
    }
    flushPara();

    const H = { 1: "h3", 2: "h4", 3: "h5" };
    const hCls = {
        1: "font-serif text-xl text-[#002B5C] mt-5 first:mt-0",
        2: "font-serif text-lg text-[#002B5C] mt-5 first:mt-0",
        3: "font-medium text-[#002B5C] mt-4 first:mt-0",
    };

    return (
        <div className={`text-sm text-[#4B5563] leading-relaxed ${className}`}>
            {blocks.map((b, i) => {
                if (b.type === "hr") return <hr key={i} className="my-5 border-[#E5E7EB]" />;
                if (b.type === "h") {
                    return React.createElement(
                        H[b.level],
                        { key: i, className: hCls[b.level] },
                        inline(b.text, `h${i}`),
                    );
                }
                if (b.type === "list") {
                    const Tag = b.ordered ? "ol" : "ul";
                    return (
                        <Tag
                            key={i}
                            className={`mt-2 space-y-1.5 ${b.ordered ? "list-decimal" : "list-disc"} pl-5 marker:text-[#CC0033]`}
                        >
                            {b.items.map((it, j) => (
                                <li key={j}>{inline(it, `l${i}-${j}`)}</li>
                            ))}
                        </Tag>
                    );
                }
                return (
                    <p key={i} className="mt-3 first:mt-0">
                        {b.lines.map((l, j) => (
                            <React.Fragment key={j}>
                                {j > 0 && <br />}
                                {inline(l, `p${i}-${j}`)}
                            </React.Fragment>
                        ))}
                    </p>
                );
            })}
        </div>
    );
}
