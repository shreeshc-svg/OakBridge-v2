import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { fetchSettings, adminSetSetting, fetchBooks } from "../../lib/api";

const SORT_VALUES = [
    { value: "featured", label: "Featured" },
    { value: "price_asc", label: "Price — Low to High" },
    { value: "price_desc", label: "Price — High to Low" },
    { value: "title", label: "Title A–Z" },
    { value: "rating_desc", label: "Top Rated" },
    { value: "newest", label: "Newest" },
];
const FILTER_KEYS = [
    { key: "bestseller", label: "Bestsellers" },
    { key: "new_release", label: "New Releases" },
];
const DEFAULT_SORTS = [
    { value: "featured", label: "Featured" },
    { value: "price_asc", label: "Price — Low to High" },
    { value: "price_desc", label: "Price — High to Low" },
    { value: "title", label: "Title A–Z" },
];
const DEFAULT_FILTERS = [
    { key: "bestseller", label: "Bestsellers", enabled: true },
    { key: "new_release", label: "New Releases", enabled: true },
];

const move = (arr, i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
};

export default function AdminPLP() {
    const [sorts, setSorts] = useState(null);
    const [filters, setFilters] = useState(null);
    const [picks, setPicks] = useState(null);
    const [books, setBooks] = useState([]);
    const [carEnabled, setCarEnabled] = useState(true);
    const [carSpeed, setCarSpeed] = useState(40); // px/sec
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings()
            .then((s) => {
                setSorts(
                    Array.isArray(s?.plp_sort_options) && s.plp_sort_options.length
                        ? s.plp_sort_options
                        : DEFAULT_SORTS,
                );
                setFilters(Array.isArray(s?.plp_filters) ? s.plp_filters : DEFAULT_FILTERS);
                setPicks(Array.isArray(s?.home_bestsellers) ? s.home_bestsellers : []);
                setCarEnabled(s?.home_bestsellers_enabled !== false);
                setCarSpeed(Number(s?.home_bestsellers_speed) || 40);
            })
            .catch(() => {
                setSorts(DEFAULT_SORTS);
                setFilters(DEFAULT_FILTERS);
                setPicks([]);
            });
        fetchBooks({ limit: 500 }).then(setBooks).catch(() => {});
    }, []);

    if (!sorts || !filters || picks === null) {
        return <div className="font-mono text-xs text-[#4B5563]">Loading…</div>;
    }

    const setSort = (i, patch) =>
        setSorts((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    const addSort = () => {
        const used = new Set(sorts.map((r) => r.value));
        const next = SORT_VALUES.find((o) => !used.has(o.value)) || SORT_VALUES[0];
        setSorts((cur) => [...cur, { value: next.value, label: next.label }]);
    };
    const removeSort = (i) => setSorts((cur) => cur.filter((_, idx) => idx !== i));

    const setFilter = (i, patch) =>
        setFilters((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    const addFilter = () => {
        const used = new Set(filters.map((r) => r.key));
        const next = FILTER_KEYS.find((o) => !used.has(o.key));
        if (!next) {
            toast.info("All supported filters are already added.");
            return;
        }
        setFilters((cur) => [...cur, { key: next.key, label: next.label, enabled: true }]);
    };
    const removeFilter = (i) => setFilters((cur) => cur.filter((_, idx) => idx !== i));

    const bookById = new Map(books.map((b) => [b.id, b]));
    const available = books.filter((b) => !picks.includes(b.id));
    const addPick = (id) => {
        if (id && !picks.includes(id)) setPicks((cur) => [...cur, id]);
    };
    const removePick = (i) => setPicks((cur) => cur.filter((_, idx) => idx !== i));

    const save = async () => {
        setSaving(true);
        try {
            const cleanSorts = sorts
                .filter((r) => r.value)
                .map((r) => ({ value: r.value, label: String(r.label || r.value).trim() }));
            const cleanFilters = filters
                .filter((r) => r.key)
                .map((r) => ({
                    key: r.key,
                    label: String(r.label || r.key).trim(),
                    enabled: r.enabled !== false,
                }));
            await adminSetSetting("plp_sort_options", cleanSorts);
            await adminSetSetting("plp_filters", cleanFilters);
            await adminSetSetting("home_bestsellers", picks);
            await adminSetSetting("home_bestsellers_enabled", carEnabled);
            await adminSetSetting("home_bestsellers_speed", Number(carSpeed) || 40);
            toast.success("Bookstore page saved — live on the storefront.");
        } catch {
            toast.error("Could not save. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const rowBox = "border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#002B5C]";
    const iconBtn = "p-2 border border-[#E5E7EB] hover:border-[#002B5C] disabled:opacity-30 disabled:hover:border-[#E5E7EB]";

    return (
        <div data-testid="admin-plp-page">
            <div className="overline">Page editor</div>
            <h1 className="font-serif text-4xl md:text-5xl mt-2 text-[#002B5C]">Bookstore (PLP)</h1>
            <p className="text-sm text-[#4B5563] mt-3 max-w-2xl">
                Control the homepage bestsellers carousel, and the sort menu and filter toggles on
                the Bookstore listing. Add, remove, reorder — changes go live on save.
            </p>

            <section className="mt-10 max-w-3xl space-y-8">
                {/* ---- BESTSELLERS CAROUSEL ---- */}
                <div className="border border-[#E5E7EB] bg-white p-6">
                    <h2 className="font-serif text-xl text-[#002B5C]">Bestsellers carousel (homepage)</h2>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        The endless auto-scrolling “What leaders are reading” row on the homepage.
                        Pick the books and set their order. Leave empty to auto-fill from bestseller flags.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                        <label className="flex items-center gap-2 text-sm text-[#002B5C]">
                            <input
                                type="checkbox"
                                checked={carEnabled}
                                onChange={(e) => setCarEnabled(e.target.checked)}
                                data-testid="plp-carousel-enabled"
                                className="accent-[#002B5C] w-4 h-4"
                            />
                            Show carousel on homepage
                        </label>
                        <label className="flex items-center gap-3 text-sm text-[#4B5563]">
                            Scroll speed
                            <input
                                type="range"
                                min="10"
                                max="120"
                                step="5"
                                value={carSpeed}
                                onChange={(e) => setCarSpeed(Number(e.target.value))}
                                data-testid="plp-carousel-speed"
                                className="accent-[#002B5C]"
                            />
                            <span className="font-mono text-xs w-16 text-[#002B5C]">{carSpeed} px/s</span>
                        </label>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                        <select
                            data-testid="plp-bestseller-picker"
                            defaultValue=""
                            onChange={(e) => {
                                addPick(e.target.value);
                                e.target.value = "";
                            }}
                            className={rowBox + " flex-1"}
                        >
                            <option value="" disabled>
                                {available.length ? "Add a book…" : "All books added"}
                            </option>
                            {available.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.title} — {b.author}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="mt-4 space-y-2">
                        {picks.map((id, i) => {
                            const b = bookById.get(id);
                            return (
                                <div key={id} className="flex items-center gap-2">
                                    <div className="flex flex-col">
                                        <button onClick={() => setPicks((c) => move(c, i, -1))} disabled={i === 0} className={iconBtn + " !py-0.5"} aria-label="Move up">
                                            <ArrowUp size={12} strokeWidth={1.5} />
                                        </button>
                                        <button onClick={() => setPicks((c) => move(c, i, 1))} disabled={i === picks.length - 1} className={iconBtn + " !py-0.5"} aria-label="Move down">
                                            <ArrowDown size={12} strokeWidth={1.5} />
                                        </button>
                                    </div>
                                    <div className="flex-1 border border-[#E5E7EB] px-3 py-2 text-sm text-[#002B5C]">
                                        <span className="font-mono text-[10px] text-[#4B5563] mr-2">{i + 1}.</span>
                                        {b ? `${b.title} — ${b.author}` : id}
                                    </div>
                                    <button onClick={() => removePick(i)} className={iconBtn + " text-[#CC0033]"} aria-label="Remove">
                                        <Trash2 size={14} strokeWidth={1.5} />
                                    </button>
                                </div>
                            );
                        })}
                        {picks.length === 0 && (
                            <p className="text-sm text-[#4B5563]">
                                No books selected — the carousel auto-fills from bestseller flags.
                            </p>
                        )}
                    </div>
                </div>

                {/* ---- SORT OPTIONS ---- */}
                <div className="border border-[#E5E7EB] bg-white p-6">
                    <div className="flex items-center justify-between">
                        <h2 className="font-serif text-xl text-[#002B5C]">Sort options</h2>
                        <button onClick={addSort} data-testid="plp-add-sort" className="inline-flex items-center gap-1.5 text-sm border border-[#002B5C] text-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA]">
                            <Plus size={14} strokeWidth={1.5} /> Add sort
                        </button>
                    </div>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        Order here = order in the dropdown. The first option is the default sort.
                    </p>
                    <div className="mt-4 space-y-3">
                        {sorts.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="flex flex-col">
                                    <button onClick={() => setSorts((c) => move(c, i, -1))} disabled={i === 0} className={iconBtn + " !py-0.5"} aria-label="Move up">
                                        <ArrowUp size={12} strokeWidth={1.5} />
                                    </button>
                                    <button onClick={() => setSorts((c) => move(c, i, 1))} disabled={i === sorts.length - 1} className={iconBtn + " !py-0.5"} aria-label="Move down">
                                        <ArrowDown size={12} strokeWidth={1.5} />
                                    </button>
                                </div>
                                <select value={r.value} onChange={(e) => setSort(i, { value: e.target.value })} data-testid={`plp-sort-value-${i}`} className={rowBox + " w-48"}>
                                    {SORT_VALUES.map((o) => (
                                        <option key={o.value} value={o.value}>{o.value}</option>
                                    ))}
                                </select>
                                <input value={r.label ?? ""} onChange={(e) => setSort(i, { label: e.target.value })} data-testid={`plp-sort-label-${i}`} placeholder="Label shown to shoppers" className={rowBox + " flex-1"} />
                                <button onClick={() => removeSort(i)} className={iconBtn + " text-[#CC0033]"} aria-label="Remove">
                                    <Trash2 size={14} strokeWidth={1.5} />
                                </button>
                            </div>
                        ))}
                        {sorts.length === 0 && <p className="text-sm text-[#4B5563]">No sort options — add at least one.</p>}
                    </div>
                </div>

                {/* ---- FILTERS ---- */}
                <div className="border border-[#E5E7EB] bg-white p-6">
                    <div className="flex items-center justify-between">
                        <h2 className="font-serif text-xl text-[#002B5C]">Filter toggles</h2>
                        <button onClick={addFilter} data-testid="plp-add-filter" className="inline-flex items-center gap-1.5 text-sm border border-[#002B5C] text-[#002B5C] px-3 py-1.5 hover:bg-[#F5F7FA]">
                            <Plus size={14} strokeWidth={1.5} /> Add filter
                        </button>
                    </div>
                    <p className="text-[11px] text-[#4B5563] mt-1">
                        The collection checkboxes in the filter sidebar. Uncheck “Shown” to hide one
                        without deleting it. (Category filters are automatic from your taxonomy.)
                    </p>
                    <div className="mt-4 space-y-3">
                        {filters.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="flex flex-col">
                                    <button onClick={() => setFilters((c) => move(c, i, -1))} disabled={i === 0} className={iconBtn + " !py-0.5"} aria-label="Move up">
                                        <ArrowUp size={12} strokeWidth={1.5} />
                                    </button>
                                    <button onClick={() => setFilters((c) => move(c, i, 1))} disabled={i === filters.length - 1} className={iconBtn + " !py-0.5"} aria-label="Move down">
                                        <ArrowDown size={12} strokeWidth={1.5} />
                                    </button>
                                </div>
                                <select value={r.key} onChange={(e) => setFilter(i, { key: e.target.value })} data-testid={`plp-filter-key-${i}`} className={rowBox + " w-48"}>
                                    {FILTER_KEYS.map((o) => (
                                        <option key={o.key} value={o.key}>{o.key}</option>
                                    ))}
                                </select>
                                <input value={r.label ?? ""} onChange={(e) => setFilter(i, { label: e.target.value })} data-testid={`plp-filter-label-${i}`} placeholder="Label shown to shoppers" className={rowBox + " flex-1"} />
                                <label className="flex items-center gap-1.5 text-xs text-[#4B5563] whitespace-nowrap px-1">
                                    <input type="checkbox" checked={r.enabled !== false} onChange={(e) => setFilter(i, { enabled: e.target.checked })} data-testid={`plp-filter-enabled-${i}`} className="accent-[#002B5C]" />
                                    Shown
                                </label>
                                <button onClick={() => removeFilter(i)} className={iconBtn + " text-[#CC0033]"} aria-label="Remove">
                                    <Trash2 size={14} strokeWidth={1.5} />
                                </button>
                            </div>
                        ))}
                        {filters.length === 0 && <p className="text-sm text-[#4B5563]">No filter toggles configured.</p>}
                    </div>
                </div>

                <button onClick={save} disabled={saving} data-testid="plp-save" className="bg-[#002B5C] text-white px-6 py-3 text-sm font-medium hover:bg-[#001F42] disabled:opacity-60">
                    {saving ? "Saving…" : "Save bookstore page"}
                </button>
            </section>
        </div>
    );
}
