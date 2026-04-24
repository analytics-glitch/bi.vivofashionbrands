"""
Iteration 26 — Thumbnails REST + /api/analytics/price-changes

Scope:
  - POST /api/thumbnails/lookup (any auth user)
  - GET  /api/thumbnails        (any auth user)
  - POST /api/thumbnails        (admin only, upsert)
  - POST /api/thumbnails/bulk   (admin only)
  - DELETE /api/thumbnails/{style_name} (admin only)
  - GET /api/analytics/price-changes (current + previous windows, filters, 400s)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASSWORD = "VivoAdmin!2026"


# ---------- fixtures ----------

@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def admin_client(admin_token) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}",
    })
    return s


@pytest.fixture(scope="session")
def anon_client() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- thumbnails ----------

class TestThumbnailsAuth:
    def test_lookup_requires_auth(self, anon_client):
        r = anon_client.post(
            f"{BASE_URL}/api/thumbnails/lookup",
            json={"styles": ["DOES_NOT_EXIST"]},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected auth rejection, got {r.status_code}"

    def test_upsert_requires_admin(self, anon_client):
        r = anon_client.post(
            f"{BASE_URL}/api/thumbnails",
            json={"style_name": "x", "image_url": "https://example.com/a.jpg"},
            timeout=15,
        )
        assert r.status_code in (401, 403)

    def test_delete_requires_admin(self, anon_client):
        r = anon_client.delete(f"{BASE_URL}/api/thumbnails/x", timeout=15)
        assert r.status_code in (401, 403)


class TestThumbnailsCrud:
    style = f"TEST_STYLE_{uuid.uuid4().hex[:8]}"
    url1 = "https://example.com/tshirt.jpg"
    url2 = "https://example.com/tshirt-v2.jpg"

    def test_lookup_empty_for_nonexistent(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/thumbnails/lookup",
            json={"styles": [self.style, "NEVER_EXISTS_STYLE_abcxyz"]},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)
        # our random test style should not be pre-existing
        assert self.style not in data

    def test_upsert_create(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/thumbnails",
            json={"style_name": self.style, "image_url": self.url1},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["style_name"] == self.style
        assert body["image_url"].startswith("https://example.com/tshirt")
        assert body.get("updated_by_email") == ADMIN_EMAIL
        assert body.get("updated_at")

    def test_lookup_returns_saved(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/thumbnails/lookup",
            json={"styles": [self.style]},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert self.style in data
        assert data[self.style].startswith("https://example.com/tshirt")

    def test_upsert_update(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/thumbnails",
            json={"style_name": self.style, "image_url": self.url2},
            timeout=15,
        )
        assert r.status_code == 200
        assert "tshirt-v2" in r.json()["image_url"]

        # Verify via lookup
        r2 = admin_client.post(
            f"{BASE_URL}/api/thumbnails/lookup",
            json={"styles": [self.style]},
            timeout=15,
        )
        assert "tshirt-v2" in r2.json()[self.style]

    def test_list_contains_style(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/thumbnails", timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        styles = [row.get("style_name") for row in rows]
        assert self.style in styles

    def test_bulk_upsert(self, admin_client):
        bulk_a = f"TEST_BULK_A_{uuid.uuid4().hex[:6]}"
        bulk_b = f"TEST_BULK_B_{uuid.uuid4().hex[:6]}"
        r = admin_client.post(
            f"{BASE_URL}/api/thumbnails/bulk",
            json={"items": [
                {"style_name": bulk_a, "image_url": "https://example.com/a.jpg"},
                {"style_name": bulk_b, "image_url": "https://example.com/b.jpg"},
            ]},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("upserted") == 2

        # cleanup
        admin_client.delete(f"{BASE_URL}/api/thumbnails/{bulk_a}")
        admin_client.delete(f"{BASE_URL}/api/thumbnails/{bulk_b}")

    def test_delete_and_verify(self, admin_client):
        r = admin_client.delete(
            f"{BASE_URL}/api/thumbnails/{self.style}", timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("deleted") == 1

        # lookup returns empty now
        r2 = admin_client.post(
            f"{BASE_URL}/api/thumbnails/lookup",
            json={"styles": [self.style]},
            timeout=15,
        )
        assert self.style not in r2.json()

    def test_delete_missing_is_404(self, admin_client):
        r = admin_client.delete(
            f"{BASE_URL}/api/thumbnails/NEVER_EXISTED_{uuid.uuid4().hex[:6]}",
            timeout=15,
        )
        assert r.status_code == 404

    def test_upsert_rejects_bad_url(self, admin_client):
        r = admin_client.post(
            f"{BASE_URL}/api/thumbnails",
            json={"style_name": "TEST_BAD", "image_url": "not-a-url"},
            timeout=15,
        )
        assert r.status_code in (400, 422)


# ---------- price-changes ----------

class TestPriceChanges:
    path = "/api/analytics/price-changes"

    def test_missing_dates_400(self, admin_client):
        r = admin_client.get(f"{BASE_URL}{self.path}", timeout=30)
        assert r.status_code == 400

    def test_bad_date_format_400(self, admin_client):
        r = admin_client.get(
            f"{BASE_URL}{self.path}",
            params={"date_from": "nope", "date_to": "also-nope"},
            timeout=30,
        )
        assert r.status_code == 400

    def test_inverted_dates_400(self, admin_client):
        r = admin_client.get(
            f"{BASE_URL}{self.path}",
            params={"date_from": "2026-02-01", "date_to": "2026-01-01"},
            timeout=30,
        )
        assert r.status_code == 400

    def test_default_window(self, admin_client):
        r = admin_client.get(
            f"{BASE_URL}{self.path}",
            params={"date_from": "2026-01-01", "date_to": "2026-02-01"},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for key in (
            "rows", "current_from", "current_to", "previous_from",
            "previous_to", "window_days", "min_units", "min_change_pct", "count",
        ):
            assert key in body, f"missing {key} in response"
        assert body["current_from"] == "2026-01-01"
        assert body["current_to"] == "2026-02-01"
        assert body["window_days"] == 32  # inclusive
        # previous should be the 32 days before 2026-01-01
        assert body["previous_to"] == "2025-12-31"
        assert body["previous_from"] == "2025-11-30"
        assert isinstance(body["rows"], list)
        assert body["count"] == len(body["rows"])

        # Row shape check — only if there is at least one row
        if body["rows"]:
            row = body["rows"][0]
            for f in (
                "style_name", "brand", "collection", "product_type",
                "current_avg_price", "previous_avg_price", "price_change_pct",
                "direction", "current_units", "previous_units",
                "units_change_pct", "current_sales", "previous_sales",
                "sales_change_pct", "price_elasticity",
            ):
                assert f in row, f"row missing {f}"
            assert row["direction"] in ("increase", "decrease")

    def test_filter_shrinks_rows(self, admin_client):
        base_params = {"date_from": "2026-01-01", "date_to": "2026-02-01"}
        wide = admin_client.get(
            f"{BASE_URL}{self.path}",
            params={**base_params, "min_units": 1, "min_change_pct": 0.5},
            timeout=120,
        )
        assert wide.status_code == 200
        narrow = admin_client.get(
            f"{BASE_URL}{self.path}",
            params={**base_params, "min_units": 50, "min_change_pct": 10},
            timeout=120,
        )
        assert narrow.status_code == 200
        assert narrow.json()["count"] <= wide.json()["count"]
        assert narrow.json()["min_units"] == 50
        assert narrow.json()["min_change_pct"] == 10.0

    def test_requires_auth(self, anon_client):
        r = anon_client.get(
            f"{BASE_URL}{self.path}",
            params={"date_from": "2026-01-01", "date_to": "2026-02-01"},
            timeout=30,
        )
        assert r.status_code in (401, 403)
