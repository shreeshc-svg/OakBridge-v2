// Oakbridge — restore the four "What We Do" verticals (Publishing, Events,
// Digital Solutions, Academy) with Coming-Soon on the two upcoming ones.
// Run in the browser console while logged into Admin on
// https://oak-bridge-v2.vercel.app (or api.oakbridge.in).
(async () => {
  const API = window.location.hostname.includes("oakbridge.in")
    ? "https://api.oakbridge.in" : "https://oakbridge-v2.onrender.com";
  const token = localStorage.getItem("oakbridge_token");
  if (!token) { alert("Not logged in as admin — open Admin, sign in, then re-run."); return; }
  const items = [
    {
      id: "publishing", icon: "BookOpen", kicker: "01 · Publishing",
      title: "Scholarly & Professional Books",
      lede: "Our flagship business — authoritative books across Academic, Law, Tax, Business, General, Coffee Table and Curated Works.",
      bullets: [
        "200+ titles across 5 publishing programs",
        "Distribution across India and 18 international markets",
        "Print, eBook and institutional licensing",
      ],
      cta_label: "Browse the bookstore", cta_to: "/books", coming_soon: false,
      image: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85",
    },
    {
      id: "events", icon: "Calendar", kicker: "02 · Events",
      title: "Forums, Launches & Conferences",
      lede: "Book launches, thought-leadership forums and policy roundtables — convening the scholars, practitioners and policymakers shaping India.",
      bullets: [
        "Flagship India Legal Tech & AI Summit and Vidhi Utsav",
        "Intimate book launches with senior authors",
        "Curated meet-and-greet series with Supreme Court jurists",
      ],
      cta_label: "Partner on an event", cta_to: "/contact", coming_soon: false,
      image: "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1400&q=80",
    },
    {
      id: "digital-solutions", icon: "Cpu", kicker: "03 · Digital Solutions",
      title: "AI-Powered Knowledge Products",
      lede: "Next-generation digital platforms built on our scholarly content — semantic search, research assistants, subscription databases and institutional APIs.",
      bullets: [
        "Semantic search across our full legal and tax list",
        "AI research copilots for practitioners",
        "Licensed APIs for law firms, universities and Corporate & Judiciary",
      ],
      cta_label: "Get early access", cta_to: "/digital-solutions", coming_soon: true,
      image: "https://images.unsplash.com/photo-1551033406-611cf9a28f67?auto=format&fit=crop&w=1400&q=80",
    },
    {
      id: "training", icon: "GraduationCap", kicker: "04 · Academy",
      title: "Training & Certification",
      lede: "Training programmes, certification courses and in-house workshops — drawing from the same authors and subject-matter experts that write our books.",
      bullets: [
        "Programmes for Advocates and Chartered Accountants",
        "In-house workshops for law firms and corporates",
        "Certification tracks in Tax, Corporate Law and Governance",
      ],
      cta_label: "Get early access", cta_to: "/academy", coming_soon: true,
      image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80",
    },
  ];
  const res = await fetch(API + "/api/admin/collections/page_verticals", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ items }),
  });
  console.log("status", res.status, await res.text());
  alert(res.ok ? "Restored 4 What-We-Do verticals ✔ (Digital & Academy = Coming Soon). Refresh /what-we-do." : "Failed — status " + res.status);
})();
