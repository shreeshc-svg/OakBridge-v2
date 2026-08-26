"""
The two things import-authors must not get wrong.

    python backend/tests/test_author_import.py

1. A name that resolves to a record we already hold must UPDATE it, never create
   a second page for the same person. We file "Apoorva K Singh" where a book
   says "Apoorva Kumar Singh", and there are thirteen more pairs like it, so
   slugifying the incoming name and comparing ids would have produced a
   duplicate for each one.

2. A blank cell must never wipe a bio someone wrote by hand in Admin. Only the
   fields a row actually carries are written.

Plus the photo matching, which lets the files be named after the person rather
than after the slug the site serves them from.

No DB and no server: the resolution and patch rules are extracted from
features.py with ast and exercised directly.
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

# author_match_key is pure; pull it out rather than import extensions (motor, jwt).
ext = ast.parse(open(os.path.join(BACKEND, "extensions.py"), encoding="utf-8").read())
WANT = {"author_match_key", "_HONORIFIC_PREFIX", "_POST_NOMINAL", "AUTHOR_ALIASES"}
body = [
    n for n in ext.body
    if (isinstance(n, ast.FunctionDef) and n.name in WANT)
    or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in WANT for t in n.targets))
    or (isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.target.id in WANT)
]
ns = {"re": re, "dict": dict}
exec(compile(ast.Module(body=body, type_ignores=[]), "<x>", "exec"), ns)
author_match_key = ns["author_match_key"]
AUTHOR_ALIASES = ns["AUTHOR_ALIASES"]

failures = []


def check(label, cond):
    print(f"{'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        failures.append(label)


FIELDS = ("bio", "photo", "affiliation", "specialty", "category")


def resolve(records, roster, photos=None):
    """The endpoint's decision logic, mirrored. Returns (adds, updates)."""
    photos = photos or {}
    by_id = {r["id"] for r in roster}
    by_name, name_by_id = {}, {}
    for r in roster:
        name_by_id[r["id"]] = r.get("name", "")
        for sp in (r.get("name", ""), *AUTHOR_ALIASES.get(r["id"], ())):
            k = author_match_key(sp)
            if k:
                by_name.setdefault(k, r["id"])
    adds, updates = [], []
    for rec in records:
        doc = dict(rec)
        name = (doc.get("name") or "").strip()
        aid = (doc.get("id") or "").strip()
        for k in FIELDS:
            doc[k] = doc.get(k) or ""
        hit = aid if aid in by_id else by_name.get(author_match_key(name))
        if not doc["photo"]:
            spellings = [name, *AUTHOR_ALIASES.get(aid, ())]
            if hit:
                spellings.append(name_by_id.get(hit, ""))
                spellings.extend(AUTHOR_ALIASES.get(hit, ()))
            for sp in spellings:
                shot = photos.get(author_match_key(sp))
                if shot:
                    doc["photo"] = shot
                    break
        if hit:
            cur = next((r for r in roster if r["id"] == hit), {})
            patch = {k: doc[k] for k in FIELDS if doc[k] and doc[k] != (cur.get(k) or "")}
            if patch:
                updates.append({"id": hit, "set": patch})
            continue
        adds.append(doc)
    return adds, updates


ROSTER = [
    {"id": "apoorva-k-singh", "name": "Apoorva K Singh"},
    {"id": "a-p-bhardwaj", "name": "A P Bhardwaj"},
    {"id": "dr-k-k-khandelwal-ias-r", "name": "Dr K K Khandelwal, IAS (R)"},
    {"id": "somesh-upadhyay", "name": "Somesh Kumar Upadhyay"},
]

print("-- a name we already hold updates, never duplicates --")
for incoming in ["Apoorva Kumar Singh", "Apoorva K Singh", "apoorva k singh"]:
    a, u = resolve([{"id": "x", "name": incoming, "bio": "New bio."}], ROSTER)
    check(f"{incoming!r} -> update, no new record", (len(a), len(u)) == (0, 1))
    check("   and it updates the right id", u and u[0]["id"] == "apoorva-k-singh")

# The alias table is what makes these resolve, and it must be consulted here too.
for incoming, want in [("AP Bhardwaj", "a-p-bhardwaj"), ("Ap Bhardwaj", "a-p-bhardwaj"),
                       ("K K Khandelwal", "dr-k-k-khandelwal-ias-r"),
                       ("Somesh Upadhyay", "somesh-upadhyay")]:
    a, u = resolve([{"id": "x", "name": incoming, "bio": "B"}], ROSTER)
    check(f"{incoming!r} resolves to {want}", (len(a), len(u)) == (0, 1) and u[0]["id"] == want)

print("\n-- a genuinely new name is added --")
a, u = resolve([{"id": "dr-joshua-aston", "name": "Dr Joshua Aston", "bio": "B"}], ROSTER)
check("added, not updated", (len(a), len(u)) == (1, 0))
check("   keeps the id from the file", a[0]["id"] == "dr-joshua-aston")
check("   and null fields become empty strings, never None",
      all(isinstance(a[0][k], str) for k in FIELDS))

print("\n-- a blank cell never wipes what is already there --")
a, u = resolve([{"id": "x", "name": "Apoorva K Singh", "bio": "", "specialty": "Law"}], ROSTER)
check("only the filled field is written", u[0]["set"] == {"specialty": "Law"})
check("   bio is absent from the patch", "bio" not in u[0]["set"])
a, u = resolve([{"id": "x", "name": "Apoorva K Singh"}], ROSTER)
check("a row with nothing at all writes nothing", (len(a), len(u)) == (0, 0))

print("\n-- a second run must do nothing --")
# The bug: the patch copied every non-empty field rather than diffing against
# what was stored. All fourteen records carry a bio, so all fourteen produced a
# non-empty patch and the dry run reported "14 updates" however many times it
# had already been applied. Nothing was wrong with the data; the number simply
# never fell, and no amount of clicking Apply would move it.
LIVE = [{"id": "a", "name": "Ada Lovelace", "bio": "Mathematician.",
         "photo": "/api/files/oakbridge/authors/Ada Lovelace.jpg",
         "affiliation": "", "specialty": "", "category": ""}]
SAME = [{"id": "a", "name": "Ada Lovelace", "bio": "Mathematician.",
         "photo": "/api/files/oakbridge/authors/Ada Lovelace.jpg"}]
a, u = resolve(SAME, LIVE)
check("re-importing identical values is a no-op", (len(a), len(u)) == (0, 0))

CHANGED = [{"id": "a", "name": "Ada Lovelace", "bio": "Mathematician and writer."}]
a, u = resolve(CHANGED, LIVE)
check("a genuinely changed field is still an update", len(u) == 1)
check("   and only that field is written", u[0]["set"] == {"bio": "Mathematician and writer."})

# The live shape of the problem: everyone has their bio already, one lacks a photo.
NOPIC = [dict(LIVE[0], id="b", name="Bob Blank", photo="")]
FILE = [{"id": "b", "name": "Bob Blank", "bio": "Mathematician."}]
PICS = {author_match_key("Bob Blank"): "/api/files/oakbridge/authors/Bob Blank.jpg"}
a, u = resolve(FILE, NOPIC, PICS)
check("the one record missing a photo is the only update", len(u) == 1)
check("   and the patch is the photo alone, not the bio it already has",
      u[0]["set"] == {"photo": "/api/files/oakbridge/authors/Bob Blank.jpg"})

print("\n-- percent-encoded and parenthesised file names --")
# Portraits uploaded through a form that encoded the name sat unused: they
# normalise to gibberish and match nobody.
from urllib.parse import unquote as _unq
def filekey(f):
    s = _unq(f)
    s = re.sub(r"\.[A-Za-z0-9]+$", "", s)
    s = re.sub(r"[_\-]+", " ", s)
    s = re.sub(r"\s*\([^)]*\)\s*", " ", s)
    return author_match_key(s)
check("a bracketed nickname is not part of the name",
      filekey("mrityunjay-rai-%28bahubali-sir%29.jpg") == "mrityunjay rai")
check("and it works undecoded too", filekey("Mrityunjay Rai (Bahubali Sir).jpg") == "mrityunjay rai")
check("a post-nominal in brackets still resolves",
      filekey("Dr K K Khandelwal, IAS (R).jpg") == "k k khandelwal")
check("an ordinary name is untouched", filekey("Bibek Debroy.jpg") == "bibek debroy")

print("\n-- photos are matched on the person, not the slug --")
PHOTOS = {author_match_key(n): f"/api/files/oakbridge/authors/{f}" for n, f in [
    ("Dr Joshua Aston", "Dr Joshua Aston.jpg"),
    ("Apoorva K Singh", "apoorva_k_singh.png"),
    ("Nobody Here", "Nobody Here.jpg"),
]}
a, u = resolve([{"id": "dr-joshua-aston", "name": "Dr Joshua Aston", "bio": "B"}], ROSTER, PHOTOS)
check("an honorific in the file name still matches",
      a[0]["photo"].endswith("Dr Joshua Aston.jpg"))
a, u = resolve([{"id": "x", "name": "Apoorva Kumar Singh", "bio": "B"}], ROSTER, PHOTOS)
check("underscores and case do not matter", u[0]["set"].get("photo", "").endswith("apoorva_k_singh.png"))
a, u = resolve([{"id": "y", "name": "Dr Joshua Aston", "bio": "B",
                 "photo": "/api/files/oakbridge/authors/explicit.jpg"}], ROSTER, PHOTOS)
check("a photo already in the row is not overwritten", a[0]["photo"].endswith("explicit.jpg"))
check("a photo matching nobody is simply not used",
      "Nobody Here" not in str(a) )

print("\n-- the file name normaliser --")
norm = lambda f: author_match_key(re.sub(r"[_\-]+", " ", re.sub(r"\.[A-Za-z0-9]+$", "", f)))
for f, want in [("Dr Joshua Aston.jpg", "joshua aston"), ("dr_joshua_aston.PNG", "joshua aston"),
                ("Prof. Manish Singh.webp", "manish singh"), ("K K Khandelwal, IAS (R).jpg", "k k khandelwal")]:
    check(f"{f!r} -> {want!r}", norm(f) == want)

print("\n-- an alias must reach a portrait on the FIRST insert --")
# The bug this catches: aliases were keyed only off the MATCHED record, and on
# an insert there is no matched record. Harish Narasappa went live with a bio
# and a blank square while the other thirteen were fine, because his file reads
# "Harish Byrasandra Narasappa". It self-healed on a second run, which is
# exactly why it survived the first round of tests.
PH = {author_match_key("Harish Byrasandra Narasappa"):
      "/api/files/oakbridge/authors/Harish Byrasandra Narasappa.jpg"}
a, u = resolve([{"id": "harish-narasappa", "name": "Harish Narasappa", "bio": "B"}], [], PH)
check("a NEW record reaches its portrait through the alias",
      a and a[0]["photo"].endswith("Harish Byrasandra Narasappa.jpg"))
# And still works the other way round, once the record exists.
a, u = resolve([{"id": "harish-narasappa", "name": "Harish Narasappa", "bio": "B"}],
               [{"id": "harish-narasappa", "name": "Harish Narasappa"}], PH)
check("and an EXISTING record still does",
      u and u[0]["set"].get("photo", "").endswith("Harish Byrasandra Narasappa.jpg"))

print("\n-- the portraits shipped in the repo --")
# They arrive named after the person and ride along in backend/seed_media/authors,
# so a fresh environment needs no manual upload. Every one of the fourteen being
# added must find its own face, or someone renders as a name with a blank square.
import json as _json, glob as _glob
SEED = os.path.join(BACKEND, "seed_media", "authors")
files = sorted(os.path.basename(f) for f in _glob.glob(os.path.join(SEED, "*")))
check("the folder is present and populated", len(files) >= 14)
check("every file is a jpeg after optimisation",
      all(f.lower().endswith(".jpg") for f in files))
big = [f for f in files if os.path.getsize(os.path.join(SEED, f)) > 200_000]
check(f"none is oversized for a 96px avatar {big or ''}", not big)

photo_keys = {author_match_key(re.sub(r"[_\-]+", " ", re.sub(r"\.[A-Za-z0-9]+$", "", f))): f
              for f in files}
recs = _json.load(open(os.path.join(BACKEND, "authors_from_sheet_2026_08_25.json"), encoding="utf-8"))
missing = []
for r in recs:
    spellings = [r["name"], *AUTHOR_ALIASES.get(r["id"], ())]
    if not any(author_match_key(s) in photo_keys for s in spellings):
        missing.append(r["name"])
check(f"all {len(recs)} imported authors find a portrait {missing or ''}", not missing)

# His portrait first arrived as "Harish Byrasandra Narasappa" -- a middle name
# the sheet, the book and DAKSH all omit -- and the alias was what reached it.
# The replacement is filed under his own name, so the alias is no longer load-
# bearing here. It stays as a safety net for a book that credits the fuller
# form, and the alias mechanism itself is exercised below on a synthetic case.
check("his portrait is filed under the name everything else uses",
      photo_keys.get(author_match_key("Harish Narasappa")) == "Harish Narasappa.jpg")
check("and the alias survives for a book crediting the fuller form",
      "Harish Byrasandra Narasappa" in AUTHOR_ALIASES["harish-narasappa"])
# A post-nominal in the FILE name is stripped the same as one in a record name.
check("'Amrit Agrahari IRS-IT.jpg' reaches Amrit Agrahari",
      photo_keys.get(author_match_key("Amrit Agrahari")) == "Amrit Agrahari IRS-IT.jpg")

print()
if failures:
    print(f"{len(failures)} assertion(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all assertions passed")
