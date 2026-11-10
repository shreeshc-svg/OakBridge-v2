import { useEffect, useState } from "react";
import { hrmMe } from "./api";
import { isPrerender } from "./runtime";

/**
 * "Is this signed-in person in the HRM?" — for the shortcut buttons (admin
 * sidebar, account menu, My Account). Asked once per page load and shared;
 * the HRM itself still checks everything on every request. Never during the
 * prerender (no one is signed in there, and the markup must not differ).
 */
let cached = null;      // Promise<boolean> for the current token
let cachedFor = null;

export function useHrmAccess(user) {
    const [ok, setOk] = useState(false);
    useEffect(() => {
        if (!user || isPrerender()) { setOk(false); return undefined; }
        if (cachedFor !== user.id || !cached) {
            cachedFor = user.id;
            cached = hrmMe().then(() => true).catch(() => false);
        }
        let live = true;
        cached.then((v) => live && setOk(v));
        return () => { live = false; };
    }, [user]);
    return ok;
}
