import { Linkedin, Instagram, Facebook, Youtube, Twitter, Globe } from "lucide-react";

/**
 * The social platforms the footer knows how to draw.
 *
 * ONE LIST, IMPORTED BY BOTH SIDES. The footer renders from it and the admin
 * editor offers it, so a platform cannot exist in one and not the other — the
 * same drift that left the Spam page invisible for weeks, where the sidebar and
 * the permissions list each knew about a section the other did not.
 *
 * `Globe` is the fallback rather than a missing icon, because an admin may add
 * a platform we have not listed here — Threads, Bluesky, a Substack — and a
 * link with no icon at all in a row of icons reads as broken. A generic globe
 * reads as "a website", which is true.
 */
export const SOCIAL_PLATFORMS = [
    { key: "linkedin", label: "LinkedIn", icon: Linkedin, hint: "https://www.linkedin.com/company/…" },
    { key: "instagram", label: "Instagram", icon: Instagram, hint: "https://www.instagram.com/…" },
    { key: "facebook", label: "Facebook", icon: Facebook, hint: "https://www.facebook.com/…" },
    { key: "youtube", label: "YouTube", icon: Youtube, hint: "https://www.youtube.com/@…" },
    { key: "twitter", label: "X (Twitter)", icon: Twitter, hint: "https://x.com/…" },
];

export const socialIcon = (key) =>
    SOCIAL_PLATFORMS.find((p) => p.key === String(key || "").toLowerCase())?.icon || Globe;

export const socialLabel = (key) =>
    SOCIAL_PLATFORMS.find((p) => p.key === String(key || "").toLowerCase())?.label ||
    String(key || "Link");

/**
 * What the footer shows before anyone has been to the admin.
 *
 * Deliberately blank URLs. The footer skips any entry without one, so the three
 * rows sit waiting in the editor and nothing appears on the live site until a
 * real address is pasted in — better than shipping a placeholder link that
 * takes a customer to a 404 on someone else's website.
 */
export const DEFAULT_SOCIALS = [
    { platform: "linkedin", url: "", enabled: true },
    { platform: "instagram", url: "", enabled: true },
    { platform: "facebook", url: "", enabled: true },
];

/** Only entries an admin has enabled AND given a real address. */
export const visibleSocials = (items) =>
    (Array.isArray(items) ? items : [])
        .filter((s) => s && s.enabled !== false && String(s.url || "").trim())
        .map((s) => ({
            platform: String(s.platform || "").toLowerCase(),
            url: String(s.url).trim(),
        }));
