import React from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";

/** One-click way into the HRM (Nov 2026: "make it easier" — staff shouldn't
 *  have to know the /hrm address). Shown only when useHrmAccess() says yes. */
export default function HrmShortcut({ variant = "dark", onClick, className = "" }) {
    const cls = variant === "dark"
        ? "bg-[#F5B841] text-[#002B5C] hover:bg-[#FFD27A]"
        : "bg-[#002B5C] text-white hover:bg-[#0B4A8B]";
    return (
        <Link to="/hrm" onClick={onClick} data-testid="hrm-shortcut"
            className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${cls} ${className}`}>
            <Users size={16} aria-hidden="true" /> My HRM — leave, goals, holidays
        </Link>
    );
}
