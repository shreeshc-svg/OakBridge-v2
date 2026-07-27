"""
Role-based access control for the Oakbridge admin.

Before this, every admin endpoint sat behind a single check — `role == "admin"` —
so any admin could change prices, wipe the catalogue, rewrite the legal pages and
read every customer's contact details. This adds fixed role tiers with
section-level access, and keeps user management to superadmins only.

DESIGN NOTES

* Access is resolved from the REQUEST PATH, not per-endpoint decorators. All 50
  admin routes live on two shared routers, so a path->area map means a new
  endpoint is covered the moment it is added, and there is no chance of someone
  forgetting a decorator.

* Unknown paths resolve to `governance` — i.e. superadmin only. Failing closed
  means a newly added endpoint is never accidentally world-open to every staff
  login; the worst case is a superadmin has to widen it deliberately.

* The legacy role `"admin"` is treated as `superadmin`. Existing logins (and the
  account seeded from ADMIN_EMAIL/ADMIN_PASSWORD) therefore keep working exactly
  as before — nobody can be locked out by deploying this.
"""
from __future__ import annotations

AREAS = ("dashboard", "catalogue", "content", "fulfilment", "enquiries", "governance")

# What each tier can reach. Every admin tier gets `dashboard`.
ROLE_AREAS: dict[str, set[str]] = {
    # Full control, including user management, legal pages, settings and the
    # destructive bulk operations.
    "superadmin": set(AREAS),
    # Legacy value — identical to superadmin so no existing account loses access.
    "admin": set(AREAS),
    # Runs the store day to day, but cannot manage users, legal or settings.
    "manager": {"dashboard", "catalogue", "content", "fulfilment", "enquiries"},
    # Dispatch / customer service: orders, stock and incoming requests.
    "fulfilment": {"dashboard", "fulfilment", "enquiries"},
    # Marketing / editorial: site copy, media and the catalogue.
    "editor": {"dashboard", "content", "catalogue"},
}

# Roles that may sign in to the admin at all.
ADMIN_ROLES = frozenset(ROLE_AREAS)

# Roles allowed to create users and change roles.
SUPERADMIN_ROLES = frozenset({"superadmin", "admin"})

# Roles a superadmin may assign in the UI (legacy "admin" is deliberately absent —
# new accounts should be created as "superadmin").
ASSIGNABLE_ROLES = ("superadmin", "manager", "editor", "fulfilment", "customer")

# First path segment after /api/admin/ -> area.
_PATH_AREA: dict[str, str] = {
    "stats": "dashboard",
    "roles": "dashboard",  # every tier reads its own permissions to render the sidebar
    # Catalogue
    "books": "catalogue",
    "categories": "catalogue",
    "uploads": "catalogue",
    "authors": "catalogue",
    "authors-order": "catalogue",
    "authors-order-mode": "catalogue",
    "apply-book-specs": "catalogue",
    "apply-release-order": "catalogue",
    # Content
    "site-content": "content",
    "collections": "content",
    "media": "content",
    # Fulfilment
    "orders": "fulfilment",
    "coupons": "fulfilment",
    "inventory": "fulfilment",
    "cart-reminders": "fulfilment",
    # Enquiries
    "messages": "enquiries",
    "desk-copies": "enquiries",
    "submissions": "enquiries",
    "waitlists": "enquiries",
    "job-applications": "enquiries",
    "search-logs": "enquiries",
    # Governance — superadmin only
    "users": "governance",
    "legal": "governance",
    "settings": "governance",
    "reset-test-data": "governance",
    "merge-titles": "governance",
    "delete-coverless": "governance",
    "find-generated-covers": "governance",
    "reseed-authors": "governance",
}


def resolve_area(path: str) -> str:
    """Map an admin request path to its permission area (fails closed)."""
    marker = "/api/admin/"
    tail = path.split(marker, 1)[1] if marker in path else path.strip("/")
    segment = tail.split("/", 1)[0].split("?", 1)[0]
    return _PATH_AREA.get(segment, "governance")


def allowed_areas(role: str | None) -> set[str]:
    return set(ROLE_AREAS.get(role or "", ()))


def can(role: str | None, area: str) -> bool:
    return area in allowed_areas(role)


def is_superadmin(role: str | None) -> bool:
    return (role or "") in SUPERADMIN_ROLES
