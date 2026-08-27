/**
 * Consent: what was actually agreed to, per purpose.
 *
 *     node frontend/scripts/test-consent.mjs
 *
 * The failure mode here is not a crash. It is a visitor who said no, or who
 * said yes to something narrower, and gets tracked anyway — which is the thing
 * the banner exists to prevent, and which nobody would notice from the outside.
 *
 * localStorage is stubbed so the real module runs unmodified.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

// Must exist before the module is imported: readConsent touches it at call time,
// but a stray top-level read would otherwise throw on import.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const consent = await import(pathToFileURL(join(SRC, "lib", "consent.js")).href);
const { CONSENT_KEY, POLICY_VERSION, NONE, ALL, readConsent, writeConsent, allows } = consent;

let failed = 0;
const check = (cond, label) => {
    console.log((cond ? "ok   " : "FAIL "), label);
    if (!cond) failed++;
};
const reset = (raw) => {
    store.clear();
    if (raw !== undefined) store.set(CONSENT_KEY, raw);
};

console.log("-- no choice yet --");
reset();
check(readConsent() === null, "nothing stored means undecided, so the banner shows");
check(allows("analytics") === false, "and nothing is allowed in the meantime");
check(allows("essential") === true, "except the essentials, which are not a choice");

console.log("\n-- writing a choice --");
reset();
const saved = writeConsent({ analytics: true, replay: false, marketing: false });
check(saved.analytics === true && saved.replay === false, "what was chosen is what is stored");
check(saved.essential === true, "essential is always recorded as on");
check(saved.version === POLICY_VERSION, "stamped with the policy version it answered");
check(typeof saved.at === "string" && saved.at.includes("T"), "and when it was given");
check(allows("analytics") === true && allows("marketing") === false,
      "and it reads back per category");

console.log("\n-- replay cannot outlive analytics --");
reset();
const sneaky = writeConsent({ analytics: false, replay: true, marketing: false });
check(sneaky.replay === false,
      "recording without analytics is refused — same library, and a recording with no events is a video of nothing");
reset();
const both = writeConsent({ analytics: true, replay: true });
check(both.replay === true, "but allowed when analytics is on");

console.log("\n-- accept all and reject all --");
reset();
check(writeConsent(ALL).marketing === true, "accept all turns everything on");
reset();
const none = writeConsent(NONE);
check(none.analytics === false && none.replay === false && none.marketing === false,
      "reject all turns everything off");
check(none.essential === true, "and still leaves the essentials, which never were a choice");

console.log("\n-- a new purpose is not covered by an old yes --");
reset(JSON.stringify({ analytics: true, replay: true, marketing: true, version: POLICY_VERSION - 1 }));
check(readConsent() === null,
      "a choice made against an older policy version is treated as no choice, so the banner asks again");
check(allows("replay") === false, "and nothing runs on the strength of it in the meantime");

console.log("\n-- the format this replaced --");
reset("accepted");
const legacy = readConsent();
check(legacy.analytics === true, "an old plain 'accepted' still covers analytics — that is what it was asked about");
check(legacy.replay === false && legacy.marketing === false,
      "but NOT recording or marketing, which did not exist when it was given");
reset("declined");
check(readConsent().analytics === false, "an old 'declined' stays a no");

console.log("\n-- rubbish in storage --");
for (const bad of ["{", "null", "[]", '"yes"', "", "{\"analytics\":true}"]) {
    reset(bad);
    const r = readConsent();
    check(r === null || r.version === POLICY_VERSION,
          `${JSON.stringify(bad)} is either rejected or a valid current choice, never a silent yes`);
}
reset('{"analytics":true,"version":' + POLICY_VERSION + "}");
check(readConsent().analytics === true, "a well-formed current choice is honoured");
check(readConsent().marketing === false, "with missing keys defaulting to off, never on");

console.log("\n-- what the shipped files do --");
const analytics = readFileSync(join(SRC, "lib", "analytics.js"), "utf8");
const banner = readFileSync(join(SRC, "components", "CookieConsent.jsx"), "utf8");
const footer = readFileSync(join(SRC, "components", "Footer.jsx"), "utf8");

check(!analytics.includes('=== "accepted"'),
      "analytics no longer reads the old single-switch value");
check(analytics.includes("readConsent()?.analytics"),
      "it asks the consent module, so there is one definition of 'agreed'");
check(analytics.includes("disable_session_recording: !allowReplay"),
      "recording is disabled unless separately consented");
check(analytics.includes("maskAllInputs: true") && analytics.includes('maskTextSelector: "*"'),
      "and when it runs, everything typed AND everything printed is masked");

check(banner.includes('data-testid="cookie-accept"') && banner.includes('data-testid="cookie-decline"'),
      "the banner offers accept and reject");
check(banner.includes('data-testid="cookie-customise"'), "and a per-category choice");
// The dark pattern regulators actually name is a decline that looks weaker than
// the accept. Both carry the identical filled-navy class string.
// AFTER the testid, not before: className follows data-testid in this file, so
// slicing backwards read the neighbouring button and passed while the decline
// was styled as a grey whisper.
const accepts = banner.split('data-testid="cookie-accept"').pop().slice(0, 300);
const declines = banner.split('data-testid="cookie-decline"').pop().slice(0, 300);
const filled = (s) => s.includes("bg-[#002B5C] text-white");
check(filled(accepts) && filled(declines),
      "and draws them with the same weight — a whispered decline is the dark pattern that gets named");
check(!banner.includes("defaultChecked"), "nothing is pre-ticked");
check(banner.includes("oakbridge:cookie-preferences") && footer.includes("oakbridge:cookie-preferences"),
      "the footer can reopen the choices, so withdrawing is as easy as agreeing");
check(banner.includes("stopAnalytics()"),
      "and turning it off bites immediately rather than on the next page load");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
