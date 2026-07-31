import React from "react";
import { Link } from "react-router-dom";

/**
 * "We're hiring" line for the sign-in and sign-up panels.
 *
 * Not everyone who lands on /login or /register is a customer. Some have heard
 * Oakbridge is hiring and are looking for a way in; the auth pages are where
 * that search often ends, because they are what a logged-out visitor gets
 * pushed to.
 *
 * ONE COMPONENT, TWO PAGES. The same seven words and the same divider on both
 * screens — written once so they cannot drift into two slightly different
 * sentences, which is what happens to copy that gets pasted.
 *
 * NO LIVE JOB COUNT, DELIBERATELY. "1 position open" reads better than "see
 * open roles", but it costs a request to fetch the careers collection on a page
 * whose entire job is to authenticate someone quickly — and it needs a
 * zero-openings branch to avoid advertising a hiring page with nothing on it.
 * The wording below is true either way, and /careers already handles an empty
 * list gracefully ("We don't have specific openings posted at the moment — but
 * we still welcome good people"), so the link is never a broken promise.
 */
export default function CareersNudge({ className = "" }) {
    return (
        <div className={`mt-8 pt-6 border-t border-[#E5E7EB] ${className}`}>
            <p className="text-sm text-[#4B5563]">
                Not here to shop? We&rsquo;re hiring.{" "}
                <Link
                    to="/careers"
                    data-testid="careers-nudge-link"
                    className="text-[#002B5C] border-b border-[#002B5C] hover:text-[#CC0033] hover:border-[#CC0033] pb-0.5"
                >
                    See open roles at Oakbridge
                </Link>
            </p>
        </div>
    );
}
