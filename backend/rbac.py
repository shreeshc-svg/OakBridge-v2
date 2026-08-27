"""
Role-based access control for the Oakbridge admin.

Permissions are per SECTION — the same 20 entries as the admin sidebar — so a
superadmin can tick exactly what each person gets. A role only supplies the
starting set; `user.sections` overrides it once edited.

HOW ENFORCEMENT WORKS

Access is resolved from the REQUEST PATH, not per-endpoint decorators: all admin
routes live on two shared routers, so a path -> section map means new endpoints
are covered automatically and nobody can forget a decorator.

WHAT IS AND ISN'T TRULY SEPARABLE  (important, and deliberately documented)

Several sidebar screens write through the SAME endpoints — Pages, Navigation,
Media & Gallery, Careers, Bookstore Page, Book Page and E-Books all persist via
`site-content` / `collections` / `settings`. A request cannot say which screen it
came from, so those seven are enforced as one bundle: unticking one hides it from
the sidebar, but someone technical with any of the seven could still reach the
others' data through the API. The other fourteen sections are genuinely isolated.

Sensitive `settings` keys (tax, shipping, admin nav) are additionally gated to
superadmins by key, so letting an editor arrange page sections does not also let
them change your tax rate.
"""
from __future__ import annotations

# ---------------------------------------------------------------- sections ---
# Mirrors the admin sidebar. Key = path suffix under /admin.
SECTIONS: tuple[str, ...] = (
    "dashboard",
    "books",
    "hampers",
    "inventory",
    "authors",
    "page-bookstore",
    "page-book",
    "pages",
    "navigation",
    "media",
    "media-gallery",
    "ebooks",
    "careers",
    "orders",
    "coupons",
    "messages",
    "desk-copies",
    "submissions",
    "waitlists",
    "spam",
    "users",
    "legal",
    "settings",
)

SECTION_LABELS: dict[str, str] = {
    "dashboard": "Dashboard",
    "books": "Books",
    "hampers": "Gift Hampers",
    "inventory": "Inventory",
    "authors": "Authors",
    "page-bookstore": "Bookstore Page",
    "page-book": "Book Page",
    "pages": "Pages",
    "navigation": "Navigation",
    "media": "Media Library",
    "media-gallery": "Media & Gallery",
    "ebooks": "E-Books",
    "careers": "Careers",
    "orders": "Orders",
    "coupons": "Coupons",
    "messages": "Messages",
    "desk-copies": "Desk Copies",
    "submissions": "Submissions",
    "waitlists": "Waitlists",
    "spam": "Spam",
    "users": "Users",
    "legal": "Legal",
    "settings": "Settings",
}

# The six that share endpoints — surfaced to the UI so it can say so honestly.
SHARED_CONTENT_SECTIONS = frozenset(
    {"pages", "navigation", "media-gallery", "careers", "page-bookstore", "page-book",
     "ebooks",
     # Hampers stores its banner and /gifting copy in settings, so it shares that
     # endpoint with the screens above and cannot be fully isolated from them.
     "hampers"}
)

# --------------------------------------------------------------- endpoints ---
# Section -> the first path segments under /api/admin/ that it unlocks.
SECTION_PATHS: dict[str, set[str]] = {
    "dashboard": {"stats", "roles", "search-logs"},
    "books": {"books", "categories", "uploads", "apply-book-specs", "apply-release-order"},
    # `uploads` is shared with books and authors: the hamper form posts its
    # photography to the same image endpoint, and without it the picker 403s.
    "hampers": {"hampers", "hampers-copy-defaults", "uploads", "settings"},
    "authors": {"authors", "authors-order", "authors-order-mode", "uploads"},
    "inventory": {"inventory"},
    "orders": {"orders", "cart-reminders"},
    "coupons": {"coupons"},
    "messages": {"messages"},
    "desk-copies": {"desk-copies"},
    "submissions": {"submissions"},
    "waitlists": {"waitlists"},
    # Sits with the other enquiry inboxes because it holds the same records —
    # the contact messages and manuscript submissions that were screened out.
    # Without this entry sections_for_path("/api/admin/spam") is empty, which
    # fails closed for everyone but a superadmin, and the section could never be
    # granted to anybody.
    "spam": {"spam"},
    "careers": {"job-applications", "collections"},
    "media": {"media", "uploads"},
    "media-gallery": {"collections", "media", "uploads"},
    "pages": {"site-content", "collections", "settings", "media", "uploads"},
    "navigation": {"site-content", "collections"},
    "ebooks": {"site-content"},
    "page-bookstore": {"settings", "books"},
    "page-book": {"settings"},
    "users": {"users"},
    "legal": {"legal"},
    "settings": {"settings"},
}

# Bulk/destructive operations — always superadmin, never grantable.
#
# import-authors only ever adds, and repair-book-authors only rewrites a field
# from the Title Master — neither deletes. They are here anyway because both
# rewrite the whole catalogue or the whole roster in one call, and the delete
# rule in require_admin() cannot help: it keys on the DELETE method, and these
# are POSTs.
SUPERADMIN_ONLY_PATHS = frozenset(
    {
        "reset-test-data",
        "merge-titles",
        "delete-coverless",
        "find-generated-covers",
        "reseed-authors",
        "import-authors",
        "repair-book-authors",
        # Mails real people. A staff account with Users access should be able to
        # read the list without being able to broadcast to it.
        "send-purchase-nudge",
    }
)

# Settings keys only a superadmin may write. Everything else (page layout,
# section order, carousel options) is ordinary content configuration.
SUPERADMIN_ONLY_SETTING_KEYS = frozenset(
    {
        "tax_percent",
        "free_ship_threshold",
        "ship_flat",
        "admin_nav_order",
    }
)

# Reverse index: path segment -> sections that grant it.
_PATH_SECTIONS: dict[str, set[str]] = {}
for _section, _paths in SECTION_PATHS.items():
    for _p in _paths:
        _PATH_SECTIONS.setdefault(_p, set()).add(_section)

# ------------------------------------------------------------------- roles ---
ROLE_PRESETS: dict[str, tuple[str, ...]] = {
    "superadmin": SECTIONS,
    "admin": SECTIONS,  # legacy value — identical, so no existing login breaks
    "manager": tuple(s for s in SECTIONS if s not in {"users", "legal", "settings"}),
    "editor": (
        "dashboard", "books", "authors", "pages", "navigation",
        "media", "media-gallery", "careers", "page-bookstore", "page-book", "ebooks",
    ),
    "fulfilment": (
        "dashboard", "inventory", "orders", "coupons",
        "messages", "desk-copies", "submissions", "waitlists",
    ),
}

ADMIN_ROLES = frozenset(ROLE_PRESETS)
SUPERADMIN_ROLES = frozenset({"superadmin", "admin"})
ASSIGNABLE_ROLES = ("superadmin", "manager", "editor", "fulfilment", "customer")


def is_superadmin(role: str | None) -> bool:
    return (role or "") in SUPERADMIN_ROLES


def effective_sections(user: dict) -> set[str]:
    """Sections this user may reach: their explicit list, else the role preset.

    Superadmins always get everything, so a bad override can never orphan the
    account that manages the others.
    """
    role = user.get("role")
    if is_superadmin(role):
        return set(SECTIONS)
    override = user.get("sections")
    if isinstance(override, list):
        return {s for s in override if s in SECTIONS}
    return set(ROLE_PRESETS.get(role or "", ()))


def sections_for_path(path: str) -> set[str]:
    """Which sections would grant this admin path. Empty = superadmin only."""
    marker = "/api/admin/"
    tail = path.split(marker, 1)[1] if marker in path else path.strip("/")
    segment = tail.split("/", 1)[0].split("?", 1)[0]
    if segment in SUPERADMIN_ONLY_PATHS:
        return set()
    return set(_PATH_SECTIONS.get(segment, ()))


def can_path(user: dict, path: str) -> bool:
    if is_superadmin(user.get("role")):
        return True
    granting = sections_for_path(path)
    if not granting:
        return False  # unknown or destructive -> fail closed
    return bool(granting & effective_sections(user))
