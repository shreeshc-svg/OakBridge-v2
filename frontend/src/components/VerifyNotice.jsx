import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Shows only to a signed-in but unverified user: a reminder that email/phone
// verification is required before an order can be placed. Renders nothing
// otherwise. Drop it near any buy / checkout action.
export default function VerifyNotice({ className = "" }) {
    const { user } = useAuth();
    if (!user || user.email_verified !== false) return null;
    return (
        <div
            data-testid="verify-notice"
            className={`flex items-start gap-2 text-xs leading-relaxed text-[#92400E] bg-[#F59E0B]/10 border border-[#F59E0B]/50 px-3 py-2 ${className}`}
        >
            <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[#F59E0B]" />
            <span>
                Verify your email to place an order.{" "}
                <Link to="/account" className="underline font-medium text-[#002B5C]">
                    Verify now
                </Link>
            </span>
        </div>
    );
}
