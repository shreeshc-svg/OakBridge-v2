import React from "react";

/**
 * The browser half of the bot screening.
 *
 * Two facts the backend cannot work out on its own: whether a field no human
 * can see was filled in, and how long the form was open before it was sent. A
 * script fills every input it finds and posts immediately; a person does
 * neither.
 *
 * Nothing here inconveniences a real visitor. There is no puzzle, no delay and
 * nothing to read — the honeypot is off-screen and skipped by the keyboard, and
 * the timer is just a subtraction. Turnstile is the layer that catches a bot
 * written specifically against this one; these two catch everything that is not.
 */

/**
 * Hidden from people, offered to scripts.
 *
 * Positioned off-screen rather than `display:none` or `hidden`, because the
 * cruder bots skip anything obviously undisplayed but will happily fill a field
 * they can see in the DOM. aria-hidden and tabIndex -1 keep it away from screen
 * readers and the tab order, so it is invisible to everyone it should be.
 *
 * Named "website" on purpose: form-filling scripts match on common field names,
 * and a contact form asking for a website is unremarkable enough to take.
 */
export function HoneypotField({ value, onChange }) {
    return (
        <div
            aria-hidden="true"
            style={{
                position: "absolute",
                left: "-9999px",
                width: "1px",
                height: "1px",
                overflow: "hidden",
            }}
        >
            <label>
                Website
                <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            </label>
        </div>
    );
}

/**
 * Returns the honeypot state and a `shield()` to spread into the request body.
 *
 * The clock starts when the form mounts, so `form_ms` is the time the visitor
 * actually had it open. Read at submit rather than stored in state, because a
 * value captured on mount would be the same number every time.
 */
export function useFormShield() {
    const startedAt = React.useRef(Date.now());
    const [website, setWebsite] = React.useState("");

    const shield = React.useCallback(
        () => ({ website, form_ms: Date.now() - startedAt.current }),
        [website],
    );

    return { website, setWebsite, shield };
}
