"""Backend API tests for Oakbridge Publishing."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ===== Health =====
class TestHealth:
    def test_root(self, client):
        r = client.get(f"{API}/")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"
        assert "Oakbridge" in data.get("message", "")


# ===== Categories =====
class TestCategories:
    def test_list_categories(self, client):
        r = client.get(f"{API}/categories")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 5
        ids = {c["id"] for c in data}
        assert ids == {"school", "higher-ed", "professional", "test-prep", "children"}
        for c in data:
            assert "book_count" in c
            assert isinstance(c["book_count"], int)
            assert c["book_count"] > 0
            assert "_id" not in c


# ===== Books =====
class TestBooks:
    def test_list_books(self, client):
        r = client.get(f"{API}/books")
        assert r.status_code == 200
        books = r.json()
        assert isinstance(books, list)
        assert len(books) >= 25  # ~30 seeded
        b = books[0]
        for k in ("id", "title", "author", "isbn", "category", "price", "cover_image"):
            assert k in b
        assert "_id" not in b

    def test_filter_category_school(self, client):
        r = client.get(f"{API}/books", params={"category": "school"})
        assert r.status_code == 200
        books = r.json()
        assert len(books) > 0
        assert all(b["category"] == "school" for b in books)

    def test_filter_bestseller(self, client):
        r = client.get(f"{API}/books", params={"bestseller": "true"})
        assert r.status_code == 200
        books = r.json()
        assert len(books) > 0
        assert all(b["bestseller"] is True for b in books)

    def test_filter_new_release(self, client):
        r = client.get(f"{API}/books", params={"new_release": "true"})
        assert r.status_code == 200
        books = r.json()
        assert len(books) > 0
        assert all(b["new_release"] is True for b in books)

    def test_search_jee(self, client):
        r = client.get(f"{API}/books", params={"search": "JEE"})
        assert r.status_code == 200
        books = r.json()
        assert len(books) >= 1
        assert any("jee" in b["title"].lower() for b in books)

    def test_sort_price_asc(self, client):
        r = client.get(f"{API}/books", params={"sort": "price_asc"})
        assert r.status_code == 200
        prices = [b["price"] for b in r.json()]
        assert prices == sorted(prices)

    def test_sort_price_desc(self, client):
        r = client.get(f"{API}/books", params={"sort": "price_desc"})
        assert r.status_code == 200
        prices = [b["price"] for b in r.json()]
        assert prices == sorted(prices, reverse=True)

    def test_featured(self, client):
        r = client.get(f"{API}/books/featured")
        assert r.status_code == 200
        books = r.json()
        assert len(books) > 0
        assert all(b["bestseller"] is True for b in books)

    def test_new_releases(self, client):
        r = client.get(f"{API}/books/new-releases")
        assert r.status_code == 200
        books = r.json()
        assert len(books) > 0
        assert all(b["new_release"] is True for b in books)

    def test_get_book_valid(self, client):
        all_books = client.get(f"{API}/books").json()
        book_id = all_books[0]["id"]
        r = client.get(f"{API}/books/{book_id}")
        assert r.status_code == 200
        assert r.json()["id"] == book_id

    def test_get_book_invalid(self, client):
        r = client.get(f"{API}/books/does-not-exist-xyz")
        assert r.status_code == 404


# ===== Newsletter =====
class TestNewsletter:
    def test_newsletter_signup_and_idempotent(self, client):
        email = "TEST_news@example.com"
        r1 = client.post(f"{API}/newsletter", json={"email": email})
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["email"] == email
        assert "id" in d1
        # Duplicate returns same id (idempotent)
        r2 = client.post(f"{API}/newsletter", json={"email": email})
        assert r2.status_code == 200
        assert r2.json()["id"] == d1["id"]

    def test_newsletter_invalid_email(self, client):
        r = client.post(f"{API}/newsletter", json={"email": "not-an-email"})
        assert r.status_code == 422


# ===== Contact =====
class TestContact:
    def test_contact_submit(self, client):
        payload = {
            "name": "TEST User",
            "email": "TEST_contact@example.com",
            "subject": "Demo",
            "message": "Hello",
        }
        r = client.post(f"{API}/contact", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == payload["name"]
        assert d["email"] == payload["email"]
        assert d["subject"] == payload["subject"]
        assert "id" in d and "created_at" in d


# ===== Orders =====
class TestOrders:
    @pytest.fixture(scope="class")
    def sample_book(self):
        r = requests.get(f"{API}/books")
        return r.json()[0]

    def test_create_order_empty_items(self, client):
        payload = {
            "full_name": "Test Buyer",
            "email": "TEST_buyer@example.com",
            "phone": "9999999999",
            "address_line1": "1 Test St",
            "city": "Mumbai",
            "state": "MH",
            "pincode": "400001",
            "items": [],
            "subtotal": 0,
            "shipping": 0,
            "tax": 0,
            "total": 0,
        }
        r = client.post(f"{API}/orders", json=payload)
        assert r.status_code == 400

    def test_create_order_and_lookup(self, client, sample_book):
        item = {
            "book_id": sample_book["id"],
            "title": sample_book["title"],
            "author": sample_book["author"],
            "cover_image": sample_book["cover_image"],
            "price": sample_book["price"],
            "quantity": 2,
        }
        payload = {
            "full_name": "TEST Buyer",
            "email": "TEST_buyer@example.com",
            "phone": "9999999999",
            "address_line1": "1 Test St",
            "address_line2": "Apt 2",
            "city": "Mumbai",
            "state": "MH",
            "pincode": "400001",
            "items": [item],
            "subtotal": item["price"] * 2,
            "shipping": 50,
            "tax": 10,
            "total": item["price"] * 2 + 60,
            "notes": "Please deliver fast",
        }
        r = client.post(f"{API}/orders", json=payload)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["order_number"].startswith("OAK-")
        assert order["status"] == "confirmed"
        assert len(order["items"]) == 1
        oid = order["id"]
        onum = order["order_number"]

        # GET by id
        r2 = client.get(f"{API}/orders/{oid}")
        assert r2.status_code == 200
        assert r2.json()["order_number"] == onum

        # GET by order_number
        r3 = client.get(f"{API}/orders/{onum}")
        assert r3.status_code == 200
        assert r3.json()["id"] == oid

    def test_get_order_not_found(self, client):
        r = client.get(f"{API}/orders/nonexistent-xyz")
        assert r.status_code == 404
