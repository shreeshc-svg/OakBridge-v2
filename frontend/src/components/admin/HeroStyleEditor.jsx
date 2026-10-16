import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminSetSiteContent } from "../../lib/api";
import { HERO_STYLE_DEFAULTS, STAGE_ANIMS, CTA_SHAPES, heroStyle } from "../HeroFullscreen";

/**
 * Admin → Pages → Homepage → "Hero style": the look of the full-screen hero
 * banners, stored as ONE site-content object (`hero_style`) so a colour or
 * animation change is a Save, not a deployment.
 *
 * The storefront re-validates every field (HeroFullscreen.heroStyle), so
 * nothing typed here can break the hero — an unreadable colour simply falls
 * back to its default. The small preview on the right uses the same CSS
 * variables and classes as the live hero, so what you see is what ships.
 *
 * Button WORDING and LINKS stay per banner (the banner list above): each
 * highlight needs its own "Order now" / "Register" text.
 */

const RED_PRESETS = [
    { name: "Oakbridge Crimson", a: "#E8466A", b: "#CC0033", c: "#7A0020" },
    { name: "Deep Burgundy", a: "#A8324A", b: "#7B1E33", c: "#3F0A17" },
    { name: "Oxblood Wine", a: "#8E2A35", b: "#5E1220", c: "#2A060D" },
    { name: "Garnet Glow", a: "#F07A86", b: "#C8243F", c: "#8F1430" },
    { name: "Soft Rose", a: "#FBE3E3", b: "#F3B1B6", c: "#E0727C" },
    { name: "Terracotta Red", a: "#E58A6E", b: "#B5402F", c: "#6E2117" },
];
const IVORY_PRESETS = [
    { name: "Ivory", v: "#FBF8F1" },
    { name: "Cream", v: "#F7F1E3" },
    { name: "Paper white", v: "#FDFCF9" },
    { name: "Warm linen", v: "#F4EEE6" },
];
const HEXRX = /^#[0-9a-f]{6}$/i;

function Color({ label, value, onChange }) {
    const [txt, setTxt] = useState(value);
    useEffect(() => setTxt(value), [value]);
    return (
        <label className="flex items-center gap-2 text-xs text-[#4B5563]">
            <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="w-8 h-8 border border-[#E5E7EB] bg-white p-0.5 cursor-pointer" aria-label={label} />
            <span className="min-w-0">
                <span className="block">{label}</span>
                <input
                    value={txt}
                    onChange={(e) => {
                        setTxt(e.target.value);
                        if (HEXRX.test(e.target.value.trim())) onChange(e.target.value.trim().toUpperCase());
                    }}
                    className="w-20 font-mono text-[11px] border border-[#E5E7EB] px-1 py-0.5"
                    aria-label={`${label} hex`}
                />
            </span>
        </label>
    );
}

export default function HeroStyleEditor({ value }) {
    const [st, setSt] = useState(() => heroStyle(value));
    const [saving, setSaving] = useState(false);
    useEffect(() => setSt(heroStyle(value)), [value]);
    const set = (k, v) => setSt((s) => ({ ...s, [k]: v }));

    const save = async () => {
        setSaving(true);
        try {
            await adminSetSiteContent("hero_style", st);
            toast.success("Hero style saved — live on the site.");
        } catch {
            toast.error("Could not save.");
        } finally {
            setSaving(false);
        }
    };

    const vars = {
        "--hx-bg": st.bg, "--st-a": st.stage_a, "--st-b": st.stage_b, "--st-c": st.stage_c, "--st-dur": `${st.stage_speed}s`,
        "--cta-bg": st.cta_bg, "--cta-fg": st.cta_fg, "--cta2": st.cta2, "--cta-r": CTA_SHAPES[st.cta_shape],
        "--w": "70px",
    };

    return (
        <div className="border border-[#E5E7EB] bg-[#F5F7FA] p-4 mb-4" data-testid="hero-style-editor">
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <div className="font-serif text-lg text-[#002B5C]">Hero style</div>
                    <p className="text-[11px] text-[#4B5563] mt-0.5 max-w-xl">
                        Colours, the red backdrop behind the book and its animation, and the button styling for the
                        full-screen hero banners. Button wording and links are set per banner below.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={() => setSt(heroStyle(HERO_STYLE_DEFAULTS))} className="text-xs border border-[#E5E7EB] bg-white px-3 py-1 hover:bg-[#F5F7FA]">
                        Reset to defaults
                    </button>
                    <button type="button" onClick={save} disabled={saving} data-testid="hero-style-save" className="text-xs font-medium border border-[#002B5C] bg-white px-3 py-1 hover:bg-[#F5F7FA] disabled:opacity-40">
                        {saving ? "…" : "Save hero style"}
                    </button>
                </div>
            </div>

            <div className="mt-4 grid lg:grid-cols-[1fr_260px] gap-5">
                <div className="space-y-5">
                    {/* Theme + background */}
                    <div>
                        <div className="overline !text-[10px] mb-2">Theme</div>
                        <div className="flex flex-wrap gap-4 items-center">
                            {[["light", "Light (ivory)"], ["dark", "Dark (navy, particles)"]].map(([k, l]) => (
                                <label key={k} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                    <input type="radio" name="hx-theme" checked={st.theme === k} onChange={() => set("theme", k)} /> {l}
                                </label>
                            ))}
                        </div>
                        {st.theme === "light" && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                {IVORY_PRESETS.map((p) => (
                                    <button key={p.v} type="button" onClick={() => set("bg", p.v)} title={p.name}
                                        className={`flex items-center gap-1.5 text-xs border px-2 py-1 bg-white ${st.bg === p.v ? "border-[#002B5C]" : "border-[#E5E7EB]"}`}>
                                        <i className="inline-block w-4 h-4 border border-[#E5E7EB]" style={{ background: p.v }} /> {p.name}
                                    </button>
                                ))}
                                <Color label="Custom" value={st.bg} onChange={(v) => set("bg", v)} />
                            </div>
                        )}
                        <div className="mt-3"><Color label="Highlighted headline words (*stars*)" value={st.em} onChange={(v) => set("em", v)} /></div>
                    </div>

                    {/* Book backdrop */}
                    <div>
                        <div className="overline !text-[10px] mb-2">Backdrop behind the book {st.theme === "dark" && <span className="normal-case tracking-normal text-[#CC0033]">(light theme only)</span>}</div>
                        <div className="flex flex-wrap gap-2">
                            {RED_PRESETS.map((p) => {
                                const on = st.stage_a === p.a && st.stage_b === p.b && st.stage_c === p.c;
                                return (
                                    <button key={p.name} type="button" onClick={() => setSt((s) => ({ ...s, stage_a: p.a, stage_b: p.b, stage_c: p.c }))}
                                        className={`flex items-center gap-1.5 text-xs border px-2 py-1 bg-white ${on ? "border-[#002B5C]" : "border-[#E5E7EB]"}`}>
                                        <i className="inline-block w-5 h-5 rounded-full" style={{ background: `radial-gradient(circle at 35% 30%, ${p.a}, ${p.b} 45%, ${p.c})` }} />
                                        {p.name}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4">
                            <Color label="Highlight" value={st.stage_a} onChange={(v) => set("stage_a", v)} />
                            <Color label="Base" value={st.stage_b} onChange={(v) => set("stage_b", v)} />
                            <Color label="Edge" value={st.stage_c} onChange={(v) => set("stage_c", v)} />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                            <span className="text-xs text-[#4B5563]">Animation</span>
                            {STAGE_ANIMS.map((a) => (
                                <label key={a} className="flex items-center gap-1.5 cursor-pointer capitalize">
                                    <input type="radio" name="hx-anim" checked={st.stage_anim === a} onChange={() => set("stage_anim", a)} /> {a}
                                </label>
                            ))}
                        </div>
                        {st.stage_anim !== "none" && (
                            <label className="mt-2 flex items-center gap-3 text-xs text-[#4B5563]">
                                Speed — one cycle every {st.stage_speed}s
                                <input type="range" min="3" max="30" step="1" value={st.stage_speed} onChange={(e) => set("stage_speed", Number(e.target.value))} />
                            </label>
                        )}
                    </div>

                    {/* Buttons */}
                    <div>
                        <div className="overline !text-[10px] mb-2">Buttons</div>
                        <div className="flex flex-wrap gap-4">
                            <Color label="Main button" value={st.cta_bg} onChange={(v) => set("cta_bg", v)} />
                            <Color label="Main button text" value={st.cta_fg} onChange={(v) => set("cta_fg", v)} />
                            <Color label="Second button (outline)" value={st.cta2} onChange={(v) => set("cta2", v)} />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                            <span className="text-xs text-[#4B5563]">Shape</span>
                            {Object.keys(CTA_SHAPES).map((k) => (
                                <label key={k} className="flex items-center gap-1.5 cursor-pointer capitalize">
                                    <input type="radio" name="hx-shape" checked={st.cta_shape === k} onChange={() => set("cta_shape", k)} /> {k}
                                </label>
                            ))}
                            <label className="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" checked={st.cta_shine} onChange={(e) => set("cta_shine", e.target.checked)} /> Light sweep on the main button
                            </label>
                        </div>
                    </div>
                </div>

                {/* Live preview — same classes and variables as the real hero. */}
                <div
                    className={`hx-hero hx-light hx-stage-${st.stage_anim} ${st.cta_shine ? "" : "hx-noshine"} !h-auto !min-h-0 border border-[#E5E7EB] p-4`}
                    style={{ ...vars, ...(st.theme === "dark" ? { background: "#06142b" } : {}) }}
                    aria-hidden="true"
                >
                    <div className="hx-slide is-on !static">
                        <div className="text-[13px] font-bold leading-tight" style={{ color: st.theme === "dark" ? "#fff" : "#002B5C" }}>
                            Practical Guide to the <span style={{ color: st.em }}>DPDP Act</span>
                        </div>
                        <div className="relative h-[150px] grid place-items-center my-2" style={{ "--w": "70px" }}>
                            {st.theme === "light" && <div className="hx-glow" style={{ position: "absolute", zIndex: 0 }} />}
                            <div className="relative w-[64px] h-[96px] bg-[#0d1420] shadow-xl" />
                        </div>
                        <div className="flex gap-2">
                            <span className="hx-btn hx-btn-primary !text-[11px] !px-3 !py-2">Order now →</span>
                            <span className="hx-btn hx-btn-ghost !text-[11px] !px-3 !py-2" style={st.theme === "dark" ? { color: "#fff" } : undefined}>More</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
