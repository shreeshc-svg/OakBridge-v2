"""
match_authors / author_match_key, checked against the real Title Master.

    python backend/tests/test_author_match.py

No DB and no server: the two functions are pure, and the fixtures below are
real author strings lifted from title_master_go_live.xlsx. They are pulled out
of extensions.py with ast so importing the module (and with it motor, jwt,
bcrypt and a Mongo connection) is not required.
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)

WANTED = {"author_match_key", "match_authors", "_HONORIFIC_PREFIX", "_POST_NOMINAL",
          "AUTHOR_ALIASES"}


def load():
    tree = ast.parse(open(os.path.join(BACKEND, "extensions.py"), encoding="utf-8").read())
    out = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in WANTED:
            out.append(node)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in WANTED:
                    out.append(node)
    for node in tree.body:                      # AUTHOR_ALIASES carries a type hint
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) \
                and node.target.id in WANTED:
            out.append(node)
    mod = ast.Module(body=out, type_ignores=[])
    ns = {"re": re, "List": list, "dict": dict}
    exec(compile(mod, "<extracted>", "exec"), ns)
    missing = WANTED - set(ns)
    assert not missing, f"could not extract {missing} from extensions.py"
    return ns


ns = load()
author_match_key = ns["author_match_key"]
match_authors = ns["match_authors"]
AUTHOR_ALIASES = ns["AUTHOR_ALIASES"]

failures = []


def ok(label):
    print(f"ok   {label}")


def check(cond, label):
    if cond:
        ok(label)
    else:
        print(f"FAIL {label}")
        failures.append(label)


def index(*names):
    """Build an author index the way _author_index() does."""
    return [{"id": n.lower().replace(" ", "-"), "match_key": author_match_key(n)} for n in names]


def ids(*names):
    return [n.lower().replace(" ", "-") for n in names]


print("\n-- match key normalisation --")
check(author_match_key("Prof. Anil Malhotra") == "anil malhotra", "a Prof. prefix is not part of the name")
check(author_match_key("Dr Bharat Nain") == "bharat nain", "Dr without a full stop too")
check(author_match_key("Prof. Dr. Anil Malhotra") == "anil malhotra", "stacked honorifics all come off")
check(author_match_key("  CA  Kiran   Shah ") == "kiran shah", "whitespace collapses, CA comes off")
check(author_match_key("") == "", "empty name yields an empty key")
check(author_match_key("Andrew Dr Smith") == "andrew dr smith", "an honorific mid-name is left alone")

print("\n-- post-nominals in the RECORD's own name --")
# One record is filed as "Dr K K Khandelwal, IAS (R)". Books credit him without
# the suffix, so requiring the whole stored name missed him on all eleven of his
# titles -- more than any other author -- and kept his page out of the sitemap.
check(author_match_key("Dr K K Khandelwal, IAS (R)") == "k k khandelwal",
      "the suffix comes off the stored name, honorific too")
check(author_match_key("Smarak Swain, IRS") == "smarak swain", "IRS likewise")
check(author_match_key("Dhanashree Patil, ICAS") == "dhanashree patil", "ICAS likewise")
check(author_match_key("Nitesh Dhawan (Retd.)") == "nitesh dhawan", "a parenthesised Retd. too")
# The guard that makes it safe: never strip down to a single word.
check(author_match_key("Rao, IAS") == "rao, ias",
      "a one-word remainder is left alone, or 'rao' would match half the catalogue")
check(author_match_key("Vishal, IPS") == "vishal, ips", "same for any single-word name")

idx = index("Dr K K Khandelwal, IAS (R)", "Dheera Khandelwal", "Apoorva K Singh")
kk = ids("Dr K K Khandelwal, IAS (R)")
check(match_authors("K K Khandelwal", idx) == kk, "the bare name now finds the record")
check(match_authors("Dr K K Khandelwal", idx) == kk, "and the Dr form")
check(match_authors("Dr K K Khandelwal, IAS (R)", idx) == kk, "and the full stored form, once")
check(match_authors("Dr K K Khandelwal & Apoorva K Singh", idx) == kk + ids("Apoorva K Singh"),
      "alongside a co-author")
check(match_authors("Dheera Khandelwal", idx) == ids("Dheera Khandelwal"),
      "a different Khandelwal is still their own person")

print("\n-- single author --")
idx = index("Asheeta Regidi", "Surendra Raut")
check(match_authors("Asheeta Regidi", idx) == ids("Asheeta Regidi"), "the simple case")
check(match_authors("asheeta regidi", idx) == ids("Asheeta Regidi"), "matching ignores case")
check(match_authors("Parthasarathi Shome", idx) == [], "an author we have no record for matches nothing")
check(match_authors("", idx) == [], "an empty author string matches nothing")
check(match_authors(None, idx) == [], "a missing author string matches nothing")

print("\n-- the separators the Title Master actually uses --")
idx = index("Lohit Matani", "Vishal", "Udaybhan Singh", "Garima Singh",
            "Sanjay Kumar", "SP Singh", "Sharad Goyal", "Smarak Swain", "Satyajeet Sahoo")
check(match_authors("Lohit Matani & Vishal", idx) == ids("Lohit Matani", "Vishal"),
      "ampersand: both authors, in the order printed")
check(match_authors("Udaybhan Singh and Garima Singh", idx) == ids("Udaybhan Singh", "Garima Singh"),
      "the word 'and'")
check(match_authors("Sanjay Kumar, SP Singh, and Sharad Goyal", idx) == ids("Sanjay Kumar", "SP Singh", "Sharad Goyal"),
      "comma list with an Oxford 'and'")
check(match_authors("Smarak Swain & Satyajeet Sahoo", idx) == ids("Smarak Swain", "Satyajeet Sahoo"),
      "two authors, one ampersand")
check(match_authors("Vishal & Lohit Matani", idx) == ids("Vishal", "Lohit Matani"),
      "order follows the string, not the index")

print("\n-- post-nominals are not separators --")
# The bug a naive split(',') would introduce: "Lohit Matani, IPS" is one person.
idx = index("Lohit Matani", "Naveen Kumar Chandra", "Somesh Upadhyay")
check(match_authors("Lohit Matani, IPS", idx) == ids("Lohit Matani"), "', IPS' does not invent a second author")
check(match_authors("Naveen Kumar Chandra, IAS", idx) == ids("Naveen Kumar Chandra"), "', IAS' likewise")
check(match_authors("Somesh Upadhyay, IAS", idx) == ids("Somesh Upadhyay"), "and again")

print("\n-- nested editor lists --")
real = "Daksh ( Editor - Shruti Vidyasagar, Sandhya P. R., Anindita Pattanayak and Harish Narasappa)"
idx = index("Shruti Vidyasagar", "Anindita Pattanayak", "Harish Narasappa")
check(match_authors(real, idx) == ids("Shruti Vidyasagar", "Anindita Pattanayak", "Harish Narasappa"),
      "the editors inside the parenthetical are found")
check(match_authors(real, index("Nobody At All")) == [],
      "with no records, it yields nothing rather than garbage")

print("\n-- overlapping and partial names --")
idx = index("K K Chythanya", "Chythanya", "H Padamchand Khincha")
got = match_authors("H Padamchand Khincha & K K Chythanya", idx)
check(got == ids("H Padamchand Khincha", "K K Chythanya"),
      "the longer of two overlapping records wins, and only once")
check("chythanya" not in got, "the bare-surname record does not double up")

idx = index("Vishal", "Somesh Arora", "Salil Arora")
check(match_authors("Vishalakshi Menon", idx) == [], "a name is not matched inside a longer word")
check(match_authors("Somesh Arora & Salil Arora", idx) == ids("Somesh Arora", "Salil Arora"),
      "a shared surname does not collapse two people into one")

idx = index("Aditya Nain", "Bharat Nain")
check(match_authors("Dr Bharat Nain & Dr Aditya Nain", idx) == ids("Bharat Nain", "Aditya Nain"),
      "honorifics in the book string do not block the match")

print("\n-- an author listed twice --")
idx = index("Ajay Sharma")
check(match_authors("Ajay Sharma and Ajay Sharma", idx) == ids("Ajay Sharma"),
      "a repeated name yields one entry, not two")

print("\n-- regex metacharacters in a name --")
idx = index("Sandhya P. R.")
check(match_authors("Sandhya P. R., Anindita Pattanayak", idx) == ids("Sandhya P. R."),
      "full stops in a name are matched literally, not as any-char")
check(match_authors("Sandhya PXRX", idx) == [],
      "and really literally -- the dots do not match arbitrary characters")

print("\n-- every multi-author string in the real Title Master --")
try:
    import openpyxl
    wb = openpyxl.load_workbook(os.path.join(BACKEND, "title_master_go_live.xlsx"), read_only=True)
    rows = list(wb.active.iter_rows(values_only=True))
    hdr = [str(h).strip() if h else "" for h in rows[0]]
    col = hdr.index("Author Name")
    strings = [str(r[col]) for r in rows[1:] if r[col]]
    # Feed every real author string through with an empty index. The contract
    # is that it never raises and never invents an author -- the failure mode
    # that matters, since a bad regex here 500s the PDP.
    bad = []
    for s in strings:
        try:
            if match_authors(s, []) != []:
                bad.append(s)
        except Exception as e:  # noqa: BLE001
            bad.append(f"{s} -> raised {e!r}")
    check(not bad, f"all {len(strings)} real author strings parse without raising or inventing")
    if bad:
        for b in bad[:5]:
            print("      ", b)
except ImportError:
    print("skip openpyxl not installed -- real-data sweep skipped")

print("\n-- the master separates some co-authors with a NEWLINE --")
# Seven cells in the sheet do this. repair-book-authors used to collapse all
# whitespace, which still matched both people but printed the byline as
# "Mukesh Bhutani Kinshuk Jha" -- one person with four names.
import re as _re
def _master_name(cell):
    """The normalisation repair-book-authors applies. Mirrors features.py."""
    n = _re.sub(r"\s*\n\s*", " & ", cell.strip())
    return _re.sub(r"[ \t]+", " ", n).strip()
check(_master_name("Mukesh Bhutani\nKinshuk Jha") == "Mukesh Bhutani & Kinshuk Jha",
      "a line break between two names becomes an ampersand")
check(_master_name("Atul Kumar Gupta\nAjay Sharma\nSwati Chutani")
      == "Atul Kumar Gupta & Ajay Sharma & Swati Chutani", "three names, two breaks")
check(_master_name("Anil Malhotra \nRanjit Malhotra") == "Anil Malhotra & Ranjit Malhotra",
      "trailing space before the break does not survive")
check(_master_name("Dr K K Khandelwal, IAS (R)") == "Dr K K Khandelwal, IAS (R)",
      "a cell with no break is left exactly as it is")
check(_master_name("  Asheeta   Regidi  ") == "Asheeta Regidi", "runs of spaces still collapse")
idx = index("Mukesh Bhutani", "Kinshuk Jha")
check(match_authors(_master_name("Mukesh Bhutani\nKinshuk Jha"), idx)
      == ids("Mukesh Bhutani", "Kinshuk Jha"), "and both authors still match afterwards")

print("\n-- alternate spellings (AUTHOR_ALIASES) --")
# The book's author line and the author record are maintained separately and
# disagree in ways no rule can bridge safely -- spacing ("AP" for "A P"),
# misspellings ("Butani" for "Bhutani"), and outright different forms
# ("Apoorva Kumar Singh" where the record says "Apoorva K Singh"). A fuzzy
# match would cover all three and is exactly what must not be used, so this is
# a hand-checked list. These assertions guard the list, not a formula.
def index_with_aliases(*pairs):
    """(id, name) pairs, expanded through AUTHOR_ALIASES like _author_index()."""
    out = []
    for aid, name in pairs:
        for sp in (name, *AUTHOR_ALIASES.get(aid, ())):
            k = author_match_key(sp)
            if k:
                out.append({"id": aid, "match_key": k})
    return out

idx = index_with_aliases(("a-p-bhardwaj", "A P Bhardwaj"), ("apoorva-k-singh", "Apoorva K Singh"),
                         ("mukesh-bhutani", "Mukesh Bhutani"), ("ns-nappinai", "NS Nappinai"),
                         ("dr-k-k-khandelwal-ias-r", "Dr K K Khandelwal, IAS (R)"))
for spelling, want in [("AP Bhardwaj", "a-p-bhardwaj"), ("Ap Bhardwaj", "a-p-bhardwaj"),
                       ("A P Bharadwaj", "a-p-bhardwaj"), ("A P Bhardwaj", "a-p-bhardwaj"),
                       ("Mukesh Butani", "mukesh-bhutani"), ("N S Nappinai", "ns-nappinai")]:
    check(match_authors(spelling, idx) == [want], f"{spelling!r} reaches the right record")
check(match_authors("Dr K K Khandelwal & Apoorva Kumar Singh", idx)
      == ["dr-k-k-khandelwal-ias-r", "apoorva-k-singh"],
      "the book that prompted this renders both authors")

# The failure this design must not have: one person listed twice because their
# name and an alias both hit.
check(match_authors("A P Bhardwaj and AP Bhardwaj", idx) == ["a-p-bhardwaj"],
      "name and alias both matching still yields ONE author")

print("\n-- guarding the alias list itself --")
check(all(isinstance(v, tuple) for v in AUTHOR_ALIASES.values()),
      "every entry is a tuple, so a bare string cannot be iterated per character")
short = [a for v in AUTHOR_ALIASES.values() for a in v if len(a.split()) < 2]
check(not short, f"no alias is a single word -- one would match inside other names {short or ''}")
seen = {}
dupes = []
for aid, v in AUTHOR_ALIASES.items():
    for a in v:
        k = author_match_key(a)
        if k in seen and seen[k] != aid:
            dupes.append((a, seen[k], aid))
        seen[k] = aid
check(not dupes, f"no spelling is claimed by two different authors {dupes or ''}")
check(all(a.strip() and a == a.strip() for v in AUTHOR_ALIASES.values() for a in v),
      "no alias is blank or carries stray whitespace")
check(len(AUTHOR_ALIASES) == len(set(AUTHOR_ALIASES)), "no id appears twice")

print()
if failures:
    print(f"{len(failures)} assertion(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all assertions passed")
