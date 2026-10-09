import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import NoIndex from "../components/NoIndex";
import { mkUnsubInfo, mkUnsubscribe, formatApiError } from "../lib/api";

/**
 * /unsubscribe?s=<send id>&t=<signature> — the link in every campaign email
 * (backend/marketing.py). Asks before acting, so a mail scanner that "visits"
 * every link cannot unsubscribe someone; the mail app's one-click
 * unsubscribe posts to the API directly and does not come here.
 */
export default function Unsubscribe() {
    const [p] = useSearchParams();
    const s = p.get("s") || "";
    const t = p.get("t") || "";
    const [info, setInfo] = useState(null);
    const [done, setDone] = useState(false);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!s || !t) { setErr("This link is incomplete."); return; }
        mkUnsubInfo(s, t).then(setInfo).catch((e) => setErr(formatApiError(e)));
    }, [s, t]);
    const go = async () => {
        setBusy(true);
        try { await mkUnsubscribe(s, t); setDone(true); } catch (e) { setErr(formatApiError(e)); } finally { setBusy(false); }
    };
    return (
        <div className="max-w-lg mx-auto px-6 py-20 text-center" data-testid="unsubscribe-page">
            <NoIndex title="Unsubscribe" />
            <h1 className="font-serif text-3xl text-[#002B5C]">Email preferences</h1>
            {err && <p className="mt-6 text-[#CC0033]">{err}</p>}
            {!err && !info && <p className="mt-6 text-[#4B5563]">Loading…</p>}
            {info && !done && (
                info.subscribed ? (
                    <>
                        <p className="mt-6 text-[#4B5563]">Stop marketing emails to <b>{info.email}</b>? You will still get emails about orders you place.</p>
                        <button type="button" disabled={busy} onClick={go} data-testid="unsubscribe-confirm"
                            className="mt-8 bg-[#002B5C] text-white px-6 py-3 text-sm font-medium disabled:opacity-50">Unsubscribe</button>
                    </>
                ) : <p className="mt-6 text-[#4B5563]"><b>{info.email}</b> is already unsubscribed. You won't get marketing emails from us.</p>
            )}
            {done && <p className="mt-6 text-[#15803D]" data-testid="unsubscribe-done">Done — you're unsubscribed. Sorry to see you go.</p>}
            <p className="mt-10 text-sm"><Link to="/" className="underline">Back to Oakbridge</Link></p>
        </div>
    );
}
