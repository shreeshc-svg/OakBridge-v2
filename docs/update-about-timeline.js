/*
 * Rewrites the About-page timeline on the LIVE site.
 *
 * WHY A SCRIPT AND NOT A CODE CHANGE
 *
 * page_about_milestones is `configured: true` in the database, so
 * resolveCollection() ignores the defaults in About.jsx entirely. Editing the
 * code changes nothing on oakbridge.in. The live copy has to be written
 * through the admin API — this does it in one go instead of ten forms.
 *
 * HOW TO RUN
 *   1. Sign in to https://www.oakbridge.in/admin as a superadmin.
 *   2. Open DevTools (F12) -> Console, on any admin page.
 *   3. Paste this whole file, press Enter.
 *   4. Reload /about and check the timeline.
 *
 * It prints what it will do, does it, then reads the result back so you can see
 * what is actually stored rather than trusting the write.
 *
 * SAFE TO RE-RUN. It replaces the whole list every time, so running it twice
 * gives the same result as running it once. It does NOT touch any other
 * content.
 *
 * One line per point. Two or more lines render as bullets; a single line
 * renders as a paragraph.
 */
(async () => {
  const ITEMS = [
    {
      year: "2017",
      text:
        "Founded on 25 July 2017 by two publishing veterans with over two decades of experience at global publishing companies.\n" +
        "Published our first five titles and hosted a conference on GST.",
    },
    {
      year: "2018",
      text:
        "First full year of operations, with 46 titles across the academic and professional lists.\n" +
        "Conducted a conference on the Insolvency and Bankruptcy Code.",
    },
    {
      year: "2019",
      text:
        "The list crossed 85 titles.\n" +
        "Law, Justice & Judicial Power was released by the President of India, Sh Ram Nath Kovind.\n" +
        "Conducted a conference on arbitration.\n" +
        "Constitutional Supremacy was cited in the Supreme Court of India.",
    },
    { year: "2020", text: "Moved into general books under the CURSIVE imprint." },
    {
      year: "2021",
      text:
        "The list crossed 100 titles.\n" +
        "Accelerating India was released by the Vice President of India, Sh M Venkaiah Naidu.",
    },
    { year: "2022", text: "Growth resumed after Covid, surpassing pre-pandemic revenues." },
    { year: "2023", text: "The catalogue crossed 250 titles." },
    {
      year: "2024",
      text: "Hosted Vidhi Utsav, India's first law and legal literature festival, with 90 speakers and over 800 attendees.",
    },
    {
      year: "2025",
      text:
        "Introduced the India Legal Tech and AI Summit, with 40+ speakers and over 200 attendees.\n" +
        "Partnered with the CTC and published a series of journals in their centenary year.",
    },
    {
      year: "2026",
      text:
        "Launched our new website.\n" +
        "Moved into coffee-table books.\n" +
        "eBook store coming soon.",
    },
  ];

  const token = localStorage.getItem("oakbridge_token");
  if (!token) {
    console.error("Not signed in. Log in to /admin first, then run this again.");
    return;
  }
  const API = "https://api.oakbridge.in/api";

  console.log(`About to write ${ITEMS.length} milestones:`);
  console.table(
    ITEMS.map((i) => ({
      year: i.year,
      points: i.text.split("\n").filter(Boolean).length,
      first: i.text.split("\n")[0].slice(0, 58),
    })),
  );

  const res = await fetch(`${API}/admin/collections/page_about_milestones`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items: ITEMS }),
  });
  if (!res.ok) {
    console.error("Write failed:", res.status, await res.text());
    return;
  }

  // Read it back rather than trusting the write.
  const check = await (await fetch(`${API}/collections/page_about_milestones`)).json();
  const years = (check.items || []).map((i) => i.year).join(", ");
  console.log(
    `%cSaved. ${check.items.length} milestones now live: ${years}`,
    "color:#0a0;font-weight:600",
  );
  console.log("Reload https://www.oakbridge.in/about to see it.");
})();
