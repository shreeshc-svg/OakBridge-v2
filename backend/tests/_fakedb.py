"""A tiny in-memory stand-in for the Motor collection methods jobs.py and
dbutil.py use, so their logic is tested without MongoDB. Supports only what
those modules call: equality, $or/$and, $lt/$lte/$gt/$gte/$in/$nin/$ne/$exists,
$set/$inc/$unset/$setOnInsert/$pull/$addToSet, array paths, sort, limit, projection, unique (sparse) indexes."""
import copy


def _get(doc, path):
    cur = doc
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None, False
        cur = cur[p]
    return cur, True


def _values(doc, path):
    """Every value at path, walking into arrays the way MongoDB does
    ("items.book_id" matches any line's book_id)."""
    cur = [doc]
    for p in path.split("."):
        nxt = []
        for c in cur:
            if isinstance(c, dict) and p in c:
                nxt.append(c[p])
            elif isinstance(c, list):
                nxt.extend(x[p] for x in c if isinstance(x, dict) and p in x)
        cur = nxt
    return cur


def _flat(vals):
    out = []
    for v in vals:
        out.extend(v if isinstance(v, list) else [v])
    return out


def _eq(vals, v):
    return any(c == v or (isinstance(c, list) and not isinstance(v, list) and v in c) for c in vals)


def _match(doc, q):
    for k, v in q.items():
        if k == "$or":
            if not any(_match(doc, s) for s in v):
                return False
            continue
        if k == "$and":
            if not all(_match(doc, s) for s in v):
                return False
            continue
        vals = _values(doc, k)
        present = bool(vals)
        flat = _flat(vals)
        if isinstance(v, dict) and any(op.startswith("$") for op in v):
            for op, arg in v.items():
                if op == "$lt" and not any(x is not None and x < arg for x in flat): return False
                if op == "$lte" and not any(x is not None and x <= arg for x in flat): return False
                if op == "$gt" and not any(x is not None and x > arg for x in flat): return False
                if op == "$gte" and not any(x is not None and x >= arg for x in flat): return False
                if op == "$in" and not (any(x in arg for x in flat) or (not present and None in arg)): return False
                if op == "$nin" and (any(x in arg for x in flat) or (not present and None in arg)): return False
                if op == "$ne" and (_eq(vals, arg) or (not present and arg is None)): return False
                if op == "$exists" and present != bool(arg): return False
        elif not (_eq(vals, v) or (not present and v is None)):
            return False
    return True


def _project(doc, proj):
    d = copy.deepcopy(doc)
    d.pop("_id", None)
    if proj:
        keep = [k for k, v in proj.items() if v and k != "_id"]
        if keep:
            d = {k: d[k] for k in keep if k in d}
    return d


class Result:
    def __init__(self, modified=0, inserted=None):
        self.modified_count = modified
        self.upserted_id = inserted
        self.deleted_count = modified


class Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=None):
        keys = key if isinstance(key, list) else [(key, direction or 1)]
        for k, d in reversed(keys):
            self.docs.sort(key=lambda x: (x.get(k) is None, x.get(k)), reverse=d == -1)
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, n):
        return self.docs[:n]

    def __aiter__(self):
        self._i = iter(self.docs)
        return self

    async def __anext__(self):
        try:
            return next(self._i)
        except StopIteration:
            raise StopAsyncIteration


class Coll:
    def __init__(self, unique=()):
        self.docs = []
        self.unique = list(unique)

    def _check_unique(self, doc, skip=None):
        for f in self.unique:
            v, present = _get(doc, f)
            if not present or v is None:
                continue
            for o in self.docs:
                if o is not skip and _get(o, f) == (v, True):
                    raise Exception(f"E11000 duplicate key {f}")

    async def insert_one(self, doc):
        self._check_unique(doc)
        self.docs.append(copy.deepcopy(doc))
        return Result(inserted=doc.get("id"))

    async def insert_many(self, docs):
        for d in docs:
            await self.insert_one(d)
        return Result(len(docs))

    def find(self, q=None, proj=None):
        return Cursor([_project(d, proj) for d in self.docs if _match(d, q or {})])

    async def find_one(self, q=None, proj=None, sort=None):
        c = self.find(q, proj)
        if sort:
            c.sort(sort)
        return c.docs[0] if c.docs else None

    def _apply(self, d, upd, inserting=False):
        for k, v in (upd.get("$set") or {}).items():
            d[k] = v
        for k, v in (upd.get("$inc") or {}).items():
            d[k] = (d.get(k) or 0) + v
        for k in (upd.get("$unset") or {}):
            d.pop(k, None)
        for k, v in (upd.get("$pull") or {}).items():
            d[k] = [x for x in d.get(k) or [] if x != v]
        for k, v in (upd.get("$addToSet") or {}).items():
            cur = list(d.get(k) or [])
            for x in (v["$each"] if isinstance(v, dict) and "$each" in v else [v]):
                if x not in cur:
                    cur.append(x)
            d[k] = cur
        if inserting:
            for k, v in (upd.get("$setOnInsert") or {}).items():
                d[k] = v

    async def update_one(self, q, upd, upsert=False):
        for d in self.docs:
            if _match(d, q):
                before = copy.deepcopy(d)
                self._apply(d, upd)
                try:
                    self._check_unique(d, skip=d)
                except Exception:
                    d.clear(); d.update(before)
                    raise
                return Result(1)
        if upsert:
            nd = {k: v for k, v in q.items() if not k.startswith("$") and not isinstance(v, dict)}
            self._apply(nd, upd, inserting=True)
            await self.insert_one(nd)
            return Result(0, inserted=True)
        return Result(0)

    async def update_many(self, q, upd):
        n = 0
        for d in self.docs:
            if _match(d, q):
                self._apply(d, upd)
                n += 1
        return Result(n)

    async def find_one_and_update(self, q, upd, sort=None, return_document=False, projection=None, upsert=False):
        cands = [d for d in self.docs if _match(d, q)]
        if sort:
            for k, dirn in reversed(sort):
                cands.sort(key=lambda x: (x.get(k) is None, x.get(k)), reverse=dirn == -1)
        if not cands:
            if upsert:
                await self.update_one(q, upd, upsert=True)
                return _project(self.docs[-1], projection) if return_document else None
            return None
        d = cands[0]
        before = _project(d, projection)
        self._apply(d, upd)
        return _project(d, projection) if return_document else before

    async def bulk_write(self, ops, ordered=False):
        n = 0
        for op in ops:
            r = await self.update_one(op["q"], op["u"])
            n += r.modified_count
        return Result(n)

    async def create_index(self, *a, **k):
        return None

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if _match(d, q):
                del self.docs[i]
                return Result(1)
        return Result(0)

    async def delete_many(self, q):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not _match(d, q)]
        return Result(before - len(self.docs))

    async def count_documents(self, q):
        return len([d for d in self.docs if _match(d, q)])

    def aggregate(self, pipeline):
        docs = [d for d in self.docs]
        for st in pipeline:
            if "$match" in st:
                docs = [d for d in docs if _match(d, st["$match"])]
            if "$group" in st:
                key = st["$group"]["_id"].lstrip("$")
                g = {}
                for d in docs:
                    g[d.get(key)] = g.get(d.get(key), 0) + 1
                docs = [{"_id": k, "n": v} for k, v in g.items()]
        return Cursor(docs)


class DB:
    def __init__(self, **unique):
        self._c = {}
        self._unique = unique

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._c:
            self._c[name] = Coll(self._unique.get(name, ()))
        return self._c[name]
