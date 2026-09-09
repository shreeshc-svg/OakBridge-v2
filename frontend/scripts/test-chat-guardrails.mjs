/**
 * The website assistant: one name, and a prompt-leak guard that still matches it.
 *
 *     node frontend/scripts/test-chat-guardrails.mjs
 *
 * WHY THIS EXISTS
 *
 * `_PROMPT_LEAK_MARKERS` in backend/features.py catches a reply in which the
 * model has quoted its own system prompt back at a visitor, and one of those
 * markers is a literal quotation of the prompt's opening line — currently
 * `You are "Asterisk"`. Rename the assistant in the prompt and forget the
 * marker, and nothing breaks loudly: the endpoint keeps working, every test
 * keeps passing, and the guard simply stops recognising a leak. That is the
 * failure nobody notices until a customer is reading the system prompt.
 *
 * The rename that prompted this file found the assistant already going by two
 * names at once — "Asterisk" in the chat greeting, "Oaky" in the nudge bubble,
 * the header label and the backend persona.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(HERE, "..", "src");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const features = readFileSync(join(ROOT, "backend", "features.py"), "utf8");
const widget = readFileSync(join(SRC, "components", "ChatWidget.jsx"), "utf8");

console.log("-- the guard quotes the prompt it is guarding --");
const persona = features.match(/"You are \\"([A-Za-z]+)\\", the assistant on the Oakbridge/);
check(Boolean(persona), "the system prompt names the assistant in the expected shape");
const NAME = persona ? persona[1] : null;
const markers = features.match(/_PROMPT_LEAK_MARKERS = \(([^)]*)\)/);
check(Boolean(markers), "_PROMPT_LEAK_MARKERS exists");
check(Boolean(NAME) && markers[1].includes(`You are "${NAME}"`),
      `the leak marker quotes the prompt's own opening verbatim — prompt says "${NAME}", markers say ${markers ? markers[1].trim() : "?"}`);

console.log("\n-- the assistant has exactly one name --");
const names = new Set();
for (const src of [features, widget]) {
    for (const m of src.matchAll(/I'?m ([A-Z][a-z]+),/g)) names.add(m[1]);
    for (const m of src.matchAll(/You are \\?"([A-Za-z]+)\\?"/g)) names.add(m[1]);
}
check(names.size === 1, `one name across the greeting, the nudge and the backend persona — found ${[...names].join(", ")}`);
check(NAME && widget.includes(`>${NAME}</div>`), `and the chat header is labelled with it`);
check(!/\bOaky\b/.test(features) && !/\bOaky\b/.test(widget),
      "no trace of the previous name left in either file");

console.log("\n-- the other markers are still there --");
for (const marker of ["ANTI-MISUSE", "CUSTOMER ORDERS (", "RELEVANT BOOKS ("]) {
    check(markers[1].includes(marker), `${marker} is still a leak marker`);
    check(features.includes(marker), `and still actually appears in the prompt it guards`);
}

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
