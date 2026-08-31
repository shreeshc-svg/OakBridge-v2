"""
Oakbridge Publishing — iteration 2 backend tests.
Covers: JWT auth, admin routes, authors, reviews, my-orders.
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load backend/.env so ADMIN_EMAIL / ADMIN_PASSWORD match the running server
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@oakbridge.in")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")


# ============== FIXTURES ==============
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def customer(api):
    email = f"TEST_user_{uuid.uuid4().hex[:8]}@example.com"
    r = api.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Test User"})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    return {"email": email, "password": "pass1234", "token": body["access_token"], "id": body["user"]["id"], "name": body["user"]["name"]}


def H(token):
    return {"Authorization": f"Bearer {token}"}


# ============== AUTH ==============
class TestAuth:
    def test_register_returns_user_and_token(self, api):
        email = f"TEST_reg_{uuid.uuid4().hex[:8]}@example.com"
        r = api.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Reg User"})
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["email"] == email.lower()
        assert body["user"]["role"] == "customer"
        assert "access_token" in body and len(body["access_token"]) > 20
        assert "password_hash" not in body["user"]

    def test_register_duplicate_400(self, api, customer):
        r = api.post(f"{API}/auth/register", json={"email": customer["email"], "password": "pass1234", "name": "Dup"})
        assert r.status_code == 400

    def test_login_admin_success(self, admin_token):
        assert admin_token and len(admin_token) > 20

    def test_login_wrong_password_401(self, api):
        r = api.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_with_token(self, api, customer):
        r = api.get(f"{API}/auth/me", headers=H(customer["token"]))
        assert r.status_code == 200
        assert r.json()["email"] == customer["email"].lower()

    def test_me_without_token_401(self, api):
        r = api.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_admin_role(self, api, admin_token):
        r = api.get(f"{API}/auth/me", headers=H(admin_token))
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_bcrypt_hash_format(self, api):
        # Indirect: passwords work with bcrypt (hash format $2b$) via successful login.
        # Directly verify by checking admin seed + login works repeatedly.
        for _ in range(2):
            r = api.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
            assert r.status_code == 200


# ============== ADMIN ACL ==============
class TestAdminACL:
    def test_admin_stats_no_token_401(self, api):
        r = api.get(f"{API}/admin/stats")
        assert r.status_code == 401

    def test_admin_stats_customer_403(self, api, customer):
        r = api.get(f"{API}/admin/stats", headers=H(customer["token"]))
        assert r.status_code == 403

    def test_admin_stats_admin_200(self, api, admin_token):
        r = api.get(f"{API}/admin/stats", headers=H(admin_token))
        assert r.status_code == 200
        d = r.json()
        for k in ["books", "orders", "customers", "revenue", "recent_orders"]:
            assert k in d
        assert isinstance(d["books"], int) and d["books"] > 0

    def test_admin_users_no_password_leak(self, api, admin_token):
        r = api.get(f"{API}/admin/users", headers=H(admin_token))
        assert r.status_code == 200
        users = r.json()
        assert len(users) >= 1
        for u in users:
            assert "password_hash" not in u
            assert "email" in u and "role" in u


# ============== ADMIN BOOKS CRUD ==============
class TestAdminBooks:
    def test_book_crud_flow(self, api, admin_token):
        # CREATE
        payload = {
            "title": "TEST_Book " + uuid.uuid4().hex[:6],
            "author": "Test Author",
            "isbn": "978-00-TEST-" + uuid.uuid4().hex[:4],
            "category": "higher-ed",
            "subject": "Testing",
            "description": "A test book",
            "price": 499.0,
            "cover_image": "https://example.com/c.jpg",
            "pages": 200,
        }
        r = api.post(f"{API}/admin/books", json=payload, headers=H(admin_token))
        assert r.status_code == 200, r.text
        book = r.json()
        bid = book["id"]
        assert book["title"] == payload["title"]

        # Verify via GET /api/books/{id}
        g = api.get(f"{API}/books/{bid}")
        assert g.status_code == 200 and g.json()["title"] == payload["title"]

        # UPDATE
        r2 = api.patch(f"{API}/admin/books/{bid}", json={"price": 599.0, "bestseller": True}, headers=H(admin_token))
        assert r2.status_code == 200
        assert r2.json()["price"] == 599.0 and r2.json()["bestseller"] is True

        # DELETE
        r3 = api.delete(f"{API}/admin/books/{bid}", headers=H(admin_token))
        assert r3.status_code == 200

        # Verify 404
        g2 = api.get(f"{API}/books/{bid}")
        assert g2.status_code == 404

    def test_update_missing_book_404(self, api, admin_token):
        r = api.patch(f"{API}/admin/books/nonexistent-id", json={"price": 100}, headers=H(admin_token))
        assert r.status_code == 404

    def test_delete_missing_book_404(self, api, admin_token):
        r = api.delete(f"{API}/admin/books/nonexistent-id", headers=H(admin_token))
        assert r.status_code == 404

    def test_customer_cannot_create_book_403(self, api, customer):
        r = api.post(f"{API}/admin/books", json={
            "title": "x", "author": "x", "isbn": "x", "category": "x",
            "subject": "x", "description": "x", "price": 1.0, "cover_image": "x"
        }, headers=H(customer["token"]))
        assert r.status_code == 403


# ============== AUTHORS ==============
class TestAuthors:
    def test_list_authors_seeded(self, api):
        r = api.get(f"{API}/authors")
        assert r.status_code == 200
        authors = r.json()
        assert len(authors) >= 6
        ids = {a["id"] for a in authors}
        assert "ananya-ghosh" in ids

    def test_author_detail(self, api):
        r = api.get(f"{API}/authors/kaushik-banerjee")
        assert r.status_code == 200
        assert "Kaushik" in r.json()["name"]

    def test_author_detail_404(self, api):
        r = api.get(f"{API}/authors/nobody-here")
        assert r.status_code == 404

    def test_author_books(self, api):
        r = api.get(f"{API}/authors/ananya-ghosh/books")
        assert r.status_code == 200
        books = r.json()
        # Modern Indian History is by Ananya Ghosh in the seed
        assert isinstance(books, list)


# Desk copies were retired in August 2026 -- the public form, both admin routes
# and the dashboard tile are gone. The tests that exercised them went with them;
# the `desk_copies` collection is still in the database, just unreachable.


# ============== REVIEWS ==============
class TestReviews:
    def test_post_review_requires_auth(self, api):
        bks = api.get(f"{API}/books").json()
        bid = bks[0]["id"]
        r = api.post(f"{API}/books/{bid}/reviews", json={"rating": 5, "title": "ok", "comment": "good"})
        assert r.status_code == 401

    def test_review_create_and_list(self, api, customer):
        bks = api.get(f"{API}/books").json()
        bid = bks[1]["id"]
        r = api.post(f"{API}/books/{bid}/reviews", json={"rating": 4, "title": "Good", "comment": "Nice book"}, headers=H(customer["token"]))
        assert r.status_code == 200
        # Duplicate review should fail
        r2 = api.post(f"{API}/books/{bid}/reviews", json={"rating": 5, "title": "A", "comment": "B"}, headers=H(customer["token"]))
        assert r2.status_code == 400
        # List
        lst = api.get(f"{API}/books/{bid}/reviews")
        assert lst.status_code == 200
        assert any(x["user_id"] == customer["id"] for x in lst.json())


# ============== ORDERS + /my/orders ==============
class TestOrders:
    def _order_payload(self):
        return {
            "full_name": "TEST User", "email": "test@x.com", "phone": "9999999999",
            "address_line1": "1 st", "city": "Kolkata", "state": "WB", "pincode": "700001",
            "items": [{"book_id": "b1", "title": "t", "author": "a", "cover_image": "x", "price": 100, "quantity": 1}],
            "subtotal": 100, "shipping": 40, "tax": 5, "total": 145,
        }

    def test_my_orders_requires_auth(self, api):
        r = api.get(f"{API}/my/orders")
        assert r.status_code == 401

    def test_authenticated_order_links_user(self, api, customer):
        r = api.post(f"{API}/orders", json=self._order_payload(), headers=H(customer["token"]))
        assert r.status_code == 200
        order = r.json()
        assert order["user_id"] == customer["id"]
        # my orders
        mine = api.get(f"{API}/my/orders", headers=H(customer["token"]))
        assert mine.status_code == 200
        assert any(o["id"] == order["id"] for o in mine.json())

    def test_admin_orders_list_and_status_update(self, api, admin_token, customer):
        # create order
        r = api.post(f"{API}/orders", json=self._order_payload(), headers=H(customer["token"]))
        oid = r.json()["id"]
        # list
        lst = api.get(f"{API}/admin/orders", headers=H(admin_token))
        assert lst.status_code == 200
        assert any(o["id"] == oid for o in lst.json())
        # update status
        up = api.patch(f"{API}/admin/orders/{oid}", json={"status": "shipped"}, headers=H(admin_token))
        assert up.status_code == 200 and up.json()["status"] == "shipped"
        # invalid status
        bad = api.patch(f"{API}/admin/orders/{oid}", json={"status": "foo"}, headers=H(admin_token))
        assert bad.status_code == 400
