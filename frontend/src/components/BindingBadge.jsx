import React from "react";
import { bindingTag, bindingOf } from "../lib/binding";

/*
 * "HB" / "PB" as a small badge IN FRONT of a title (lib/binding.js).
 *
 * Not a suffix on the title text: in a table cell the title is cut to fit,
 * and a "(HB)" at the end of "Justice M N Venkatachaliah - The Man & The
 * Judge" was the first thing cut off — on exactly the books where it
 * matters. In front, it is always on screen.
 *
 * `binding` when the row has it; otherwise looked up by `bookId` from the
 * map the warehouse book list filled.
 */
export default function BindingBadge({ binding, bookId, className = "" }) {
    const tag = bindingTag(binding !== undefined && binding !== null ? binding : bindingOf(bookId));
    if (!tag) return null;
    const hard = tag.startsWith("HB");
    return (
        <span
            title={hard ? "Hardback" : tag === "PB" ? "Paperback" : tag}
            data-testid="binding-badge"
            className={`inline-block align-middle mr-1.5 px-1.5 py-px text-[10px] font-mono font-semibold tracking-wider leading-4 border ${
                hard ? "border-[#002B5C] bg-[#002B5C] text-white" : "border-[#002B5C] text-[#002B5C] bg-white"
            } ${className}`}
        >
            {tag}
        </span>
    );
}
