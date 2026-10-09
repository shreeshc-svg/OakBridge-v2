import React, { useMemo, useState } from "react";

/**
 * Dependency-free SVG charts for Admin → Marketing.
 *
 * No chart library is in the bundle, and adding one (~90 KB) for four simple
 * charts would cost every admin page load. These render crisp at any width
 * (viewBox + preserveAspectRatio="none" on the plot, real text for labels)
 * and show values on hover.
 */
const NAVY = "#002B5C";
export const COLORS = { sent: "#002B5C", opened: "#38bdf8", clicked: "#F59E0B", bounced: "#CC0033", revenue: "#15803D",
    read: "#22c55e", new: "#002B5C", unsubs: "#CC0033" };

export const pct = (x, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
export const inr = (x) => `₹${Number(x || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function daysBetween(days) {
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

/** Multi-series line chart over the last `days` days. */
export function LineChart({ series = {}, keys = [], days = 30, height = 220, labels = {} }) {
    const [hover, setHover] = useState(null);
    const xs = useMemo(() => daysBetween(days), [days]);
    const max = Math.max(1, ...xs.flatMap((d) => keys.map((k) => series[d]?.[k] || 0)));
    const W = 600;
    const H = 200;
    const px = (i) => (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * W);
    const py = (v) => H - (v / max) * (H - 10);
    return (
        <div className="relative" style={{ height }}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[85%]"
                onMouseLeave={() => setHover(null)}
                onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setHover(Math.round(((e.clientX - r.left) / r.width) * (xs.length - 1)));
                }}>
                {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1="0" x2={W} y1={py(max * g)} y2={py(max * g)} stroke="#E5E7EB" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
                {keys.map((k) => (
                    <polyline key={k} fill="none" stroke={COLORS[k] || NAVY} strokeWidth="2" vectorEffect="non-scaling-stroke"
                        points={xs.map((d, i) => `${px(i)},${py(series[d]?.[k] || 0)}`).join(" ")} />
                ))}
                {hover != null && <line x1={px(hover)} x2={px(hover)} y1="0" y2={H} stroke="#9CA3AF" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
            </svg>
            <div className="flex justify-between text-[10px] text-[#6B7280] mt-1"><span>{xs[0]}</span><span>{xs[xs.length - 1]}</span></div>
            <div className="flex flex-wrap gap-3 text-xs mt-1">
                {keys.map((k) => <span key={k} className="inline-flex items-center gap-1"><i className="inline-block w-3 h-[3px]" style={{ background: COLORS[k] || NAVY }} />{labels[k] || k}</span>)}
            </div>
            {hover != null && xs[hover] && (
                <div className="absolute top-0 right-0 bg-white border border-[#E5E7EB] shadow-sm text-xs px-2 py-1 pointer-events-none">
                    <b>{xs[hover]}</b>{keys.map((k) => <div key={k}>{labels[k] || k}: {k === "revenue" ? inr(series[xs[hover]]?.[k]) : series[xs[hover]]?.[k] || 0}</div>)}
                </div>
            )}
        </div>
    );
}

/** Vertical bars per day; optional second series drawn as negative (e.g. unsubscribes). */
export function BarChart({ up = {}, down = {}, days = 30, height = 160, upLabel = "", downLabel = "" }) {
    const xs = useMemo(() => daysBetween(days), [days]);
    const max = Math.max(1, ...xs.map((d) => Math.max(up[d] || 0, down[d] || 0)));
    const [hover, setHover] = useState(null);
    return (
        <div style={{ height }} className="relative">
            <div className="flex items-stretch gap-[2px] h-[80%]">
                {xs.map((d) => (
                    <div key={d} className="flex-1 flex flex-col justify-center" onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
                        <div className="flex-1 flex items-end"><div className="w-full" style={{ height: `${((up[d] || 0) / max) * 100}%`, background: COLORS.new }} /></div>
                        <div className="flex-1 flex items-start border-t border-[#E5E7EB]"><div className="w-full" style={{ height: `${((down[d] || 0) / max) * 100}%`, background: COLORS.unsubs }} /></div>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs mt-2">
                <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3" style={{ background: COLORS.new }} />{upLabel}</span>
                {downLabel && <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3" style={{ background: COLORS.unsubs }} />{downLabel}</span>}
            </div>
            {hover && <div className="absolute top-0 right-0 bg-white border border-[#E5E7EB] text-xs px-2 py-1">{hover}: +{up[hover] || 0}{downLabel ? ` / −${down[hover] || 0}` : ""}</div>}
        </div>
    );
}

/** Horizontal funnel with step-to-step conversion. */
export function Funnel({ steps = [] }) {
    const top = Math.max(1, steps[0]?.count || 0);
    const tones = ["#002B5C", "#1e4b85", "#38bdf8", "#F59E0B", "#fb923c", "#15803D"];
    return (
        <div className="space-y-2" data-testid="mk-funnel">
            {steps.map((s, i) => (
                <div key={s.step} className="flex items-center gap-3 text-sm">
                    <div className="w-20 shrink-0 text-[#4B5563]">{s.step}</div>
                    <div className="flex-1 bg-[#F5F7FA] h-7 relative">
                        <div className="h-7" style={{ width: `${Math.max(1.5, (s.count / top) * 100)}%`, background: tones[i % tones.length] }} />
                        {/* White on a wide dark bar, navy beside a short or light one —
                            mix-blend-difference turned the digits peach/red on the tones. */}
                        <span className={`absolute top-1/2 -translate-y-1/2 text-xs font-semibold ${(s.count / top) >= 0.35 && i < 2 ? "left-2 text-white" : "text-[#002B5C]"}`}
                            style={(s.count / top) >= 0.35 && i < 2 ? undefined : { left: `calc(${Math.max(1.5, (s.count / top) * 100)}% + 6px)` }}>
                            {Number(s.count || 0).toLocaleString("en-IN")}
                        </span>
                    </div>
                    <div className="w-16 text-right text-xs text-[#4B5563]">{s.from_prev == null ? "" : pct(s.from_prev)}</div>
                </div>
            ))}
            <div className="text-[11px] text-[#6B7280]">Right column: conversion from the step above.</div>
        </div>
    );
}

/** Donut for a status breakdown. */
export function Donut({ data = {}, colors = {}, size = 140, label = "" }) {
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
    let acc = 0;
    const R = 50;
    const C = 2 * Math.PI * R;
    return (
        <div className="flex items-center gap-4">
            <svg width={size} height={size} viewBox="0 0 120 120" aria-label={label}>
                <circle cx="60" cy="60" r={R} fill="none" stroke="#F3F4F6" strokeWidth="16" />
                {entries.map(([k, v]) => {
                    const len = (v / total) * C;
                    const el = <circle key={k} cx="60" cy="60" r={R} fill="none" stroke={colors[k] || "#9CA3AF"} strokeWidth="16"
                        strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" />;
                    acc += len;
                    return el;
                })}
                <text x="60" y="64" textAnchor="middle" fontSize="16" fontWeight="700" fill={NAVY}>{total === 1 && !entries.length ? 0 : total}</text>
            </svg>
            <ul className="text-xs space-y-1">
                {entries.map(([k, v]) => <li key={k} className="flex items-center gap-2"><i className="inline-block w-3 h-3" style={{ background: colors[k] || "#9CA3AF" }} />{k}: <b>{v}</b> ({pct(v / total, 0)})</li>)}
            </ul>
        </div>
    );
}

/** KPI card; `warn` turns the value red (e.g. bounce rate over the limit). */
export function Kpi({ label, value, sub, warn, testid }) {
    return (
        <div className="bg-white border border-[#E5E7EB] p-4" data-testid={testid}>
            <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">{label}</div>
            <div className={`font-serif text-2xl mt-1 ${warn ? "text-[#CC0033]" : "text-[#002B5C]"}`}>{value}</div>
            {sub && <div className="text-xs text-[#6B7280] mt-0.5">{sub}</div>}
        </div>
    );
}
