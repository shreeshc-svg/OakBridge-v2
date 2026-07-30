#!/usr/bin/env python3
"""
Find names a Python file uses but never binds — a missing import, essentially.

WHY THIS EXISTS

`python -m py_compile` is a syntax check. A module that calls `re.split` without
importing `re` compiles perfectly and raises NameError the first time that line
executes. For a rarely-taken path — a fallback, an error branch, typo correction
that only runs when a search finds nothing — that can be days later, in front of
a customer. Exactly that slipped into server.py while adding search correction.

pyflakes does this properly, but it is not always installed and this repo's
build runs where PyPI may be unreachable. This is the dependency-free stand-in.

DELIBERATELY SCOPE-BLIND, AND THAT IS THE POINT

It collects every name bound ANYWHERE in the file — imports, assignments,
function and class definitions, arguments, comprehension targets, with/except
aliases, global declarations — and subtracts them, plus builtins, from every
name that is read. Ignoring scope means it under-reports: a name bound only
inside one function will not be flagged when used in another, even though that
is a genuine bug.

That bias is intentional. This gate blocks commits, and a checker that cries
wolf gets bypassed within a week, at which point it protects nothing. Missing
imports are caught with essentially no false positives; deeper scope analysis is
pyflakes' job when it is available.

Usage:  python3 undefined_names.py FILE [FILE...]
Exit 1 and one "file:line: undefined name 'x'" per finding.
"""
import ast
import builtins
import sys


class Collector(ast.NodeVisitor):
    def __init__(self):
        self.bound: set = set()
        self.used: list = []
        self.star_import = False

    # -- bindings ---------------------------------------------------------
    def visit_Import(self, node):
        for a in node.names:
            self.bound.add((a.asname or a.name).split(".")[0])
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        for a in node.names:
            if a.name == "*":
                # A star import binds names we cannot know without importing the
                # module. Anything after this would be guesswork, so the whole
                # file is abandoned rather than reported wrongly.
                self.star_import = True
                continue
            self.bound.add(a.asname or a.name)
        self.generic_visit(node)

    # -- match statements (3.10+) ----------------------------------------
    # Every capture pattern binds a name. Without these, an ordinary
    # `match`/`case` reported each captured variable as undefined and would have
    # blocked every commit in the repo until someone used --no-verify.
    def visit_MatchAs(self, node):
        if node.name:
            self.bound.add(node.name)
        self.generic_visit(node)

    def visit_MatchStar(self, node):
        if node.name:
            self.bound.add(node.name)
        self.generic_visit(node)

    def visit_MatchMapping(self, node):
        if node.rest:
            self.bound.add(node.rest)
        self.generic_visit(node)

    # -- PEP 695 type parameters (3.12+) ---------------------------------
    def visit_TypeAlias(self, node):
        if isinstance(node.name, ast.Name):
            self.bound.add(node.name.id)
        self.generic_visit(node)

    def _bind_target(self, t):
        if isinstance(t, ast.Name):
            self.bound.add(t.id)
        elif isinstance(t, (ast.Tuple, ast.List)):
            for e in t.elts:
                self._bind_target(e)
        elif isinstance(t, ast.Starred):
            self._bind_target(t.value)

    def visit_Assign(self, node):
        for t in node.targets:
            self._bind_target(t)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        self._bind_target(node.target)
        self.generic_visit(node)

    def visit_AugAssign(self, node):
        self._bind_target(node.target)
        self.generic_visit(node)

    def visit_NamedExpr(self, node):
        self._bind_target(node.target)
        self.generic_visit(node)

    def visit_For(self, node):
        self._bind_target(node.target)
        self.generic_visit(node)

    visit_AsyncFor = visit_For

    def visit_comprehension(self, node):
        self._bind_target(node.target)
        self.generic_visit(node)

    def visit_withitem(self, node):
        if node.optional_vars is not None:
            self._bind_target(node.optional_vars)
        self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        if node.name:
            self.bound.add(node.name)
        self.generic_visit(node)

    def _bind_function(self, node):
        self.bound.add(node.name)
        for tp in getattr(node, "type_params", []) or []:   # PEP 695: def f[T]()
            self.bound.add(getattr(tp, "name", ""))
        a = node.args
        for arg in [*a.posonlyargs, *a.args, *a.kwonlyargs]:
            self.bound.add(arg.arg)
        if a.vararg:
            self.bound.add(a.vararg.arg)
        if a.kwarg:
            self.bound.add(a.kwarg.arg)
        self.generic_visit(node)

    visit_FunctionDef = _bind_function
    visit_AsyncFunctionDef = _bind_function

    def visit_ClassDef(self, node):
        self.bound.add(node.name)
        for tp in getattr(node, "type_params", []) or []:
            self.bound.add(getattr(tp, "name", ""))
        self.generic_visit(node)

    def visit_Global(self, node):
        self.bound.update(node.names)
        self.generic_visit(node)

    visit_Nonlocal = visit_Global

    def visit_Lambda(self, node):
        a = node.args
        for arg in [*a.posonlyargs, *a.args, *a.kwonlyargs]:
            self.bound.add(arg.arg)
        if a.vararg:
            self.bound.add(a.vararg.arg)
        if a.kwarg:
            self.bound.add(a.kwarg.arg)
        self.generic_visit(node)

    # -- uses -------------------------------------------------------------
    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.used.append((node.id, node.lineno))
        self.generic_visit(node)


def check(path: str) -> list[str]:
    try:
        tree = ast.parse(open(path, encoding="utf-8").read(), filename=path)
    except SyntaxError as e:
        return [f"{path}:{e.lineno}: syntax error: {e.msg}"]

    c = Collector()
    c.visit(tree)
    if c.star_import:
        return []  # see visit_ImportFrom — cannot know what was imported
    known = (
        c.bound
        | set(dir(builtins))
        | {
            "__name__", "__file__", "__doc__", "__package__", "__spec__",
            "__loader__", "__builtins__", "__debug__", "__all__", "__path__",
        }
    )
    seen = set()
    out = []
    for name, line in c.used:
        if name in known or (name, ) in seen:
            continue
        seen.add((name, ))
        out.append(f"{path}:{line}: undefined name '{name}'")
    return out


if __name__ == "__main__":
    problems = []
    for f in sys.argv[1:]:
        problems.extend(check(f))
    for p in problems:
        print(p)
    sys.exit(1 if problems else 0)
