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

WANTED = {"author_match_key", "match_authors", "_HONORIFIC_PREFIX", "_POST_NOMINAL"}


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
    mod = ast.Module(body=out, type_ignores=[])
    ns = {"re": re, "List": list}
    exec(compile(mod, "<extracted>", "exec"), ns)
    missing = WANTED - set(ns)
    assert not missing, f"could not extract {missing} from extensions.py"
    return ns


ns = load()
author_match_key = ns["author_match_key"]
match_authors = ns["match_authors"]

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

print()
if failures:
    print(f"{len(failures)} assertion(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all assertions passed")
