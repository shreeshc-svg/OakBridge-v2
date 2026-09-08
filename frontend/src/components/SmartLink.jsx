import React from "react";
import { Link } from "react-router-dom";

/**
 * A link whose target was typed by an admin, not by a developer.
 *
 * Admin-entered links may be internal ("/events") or external
 * ("https://ebooks.oakbridge.in/..."). React Router's <Link> treats an absolute
 * URL as a relative path and mangles it into "/books/https:/example.com", so
 * anything carrying a scheme gets a plain anchor instead.
 *
 * Renders nothing at all when `to` is empty, which is what lets a caller write
 * <SmartLink to={maybeUndefined}> without guarding every call site.
 */
export default function SmartLink({ to, children, className, ...rest }) {
    if (!to) return null;
    const external = /^(https?:|mailto:|tel:)/i.test(to);
    return external ? (
        <a href={to} target="_blank" rel="noopener noreferrer" className={className} {...rest}>
            {children}
        </a>
    ) : (
        <Link to={to} className={className} {...rest}>
            {children}
        </Link>
    );
}
