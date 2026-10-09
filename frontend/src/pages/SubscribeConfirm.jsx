import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import NoIndex from "../components/NoIndex";
import { mkConfirm, formatApiError } from "../lib/api";

/** /subscribe/confirm?c=<contact>&t=<signature> — double opt-in (marketing.py). */
export default function SubscribeConfirm() {
    const [p] = useSearchParams();
    const [state, setState] = useState("working");
    const [err, setErr] = useState("");
    useEffect(() => {
        const c = p.get("c");
        const t = p.get("t");
        if (!c || !t) { setState("error"); setErr("This link is incomplete."); return; }
        mkConfirm(c, t)
            .then((r) => setState(r.status === "subscribed" ? "ok" : "already-out"))
            .catch((e) => { setState("error"); setErr(formatApiError(e)); });
    }, [p]);
    return (
        <div className="max-w-lg mx-auto px-6 py-20 text-center" data-testid="subscribe-confirm-page">
            <NoIndex title="Confirm subscription" />
            <h1 className="font-serif text-3xl text-[#002B5C]">Subscription</h1>
            {state === "working" && <p className="mt-6 text-[#4B5563]">Confirming…</p>}
            {state === "ok" && <p className="mt-6 text-[#15803D]">You're subscribed. Thank you — we'll write when there's something worth reading.</p>}
            {state === "already-out" && <p className="mt-6 text-[#4B5563]">This address unsubscribed earlier, so we left it unsubscribed.</p>}
            {state === "error" && <p className="mt-6 text-[#CC0033]">{err}</p>}
            <p className="mt-10 text-sm"><Link to="/books" className="underline">Browse the bookstore</Link></p>
        </div>
    );
}
