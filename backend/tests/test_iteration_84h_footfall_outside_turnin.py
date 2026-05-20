"""Iter 84h — Verify backend returns outside_traffic + turn_in_rate fields.

Covers:
  • GET /api/footfall returns outside_traffic + turn_in_rate per row.
  • GET /api/footfall/weekday-pattern returns avg_outside_traffic,
    avg_turn_in_rate, total_outside_window per row AND per
    group_avg_by_weekday entry.
"""
import os
import pytest
import requests

def _read_backend_url():
    u = os.environ.get("REACT_APP_BACKEND_URL")
    if u:
        return u.rstrip("/")
    try:
        with open("/app/frontend/.env", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")

BASE_URL = _read_backend_url()
EMAIL = "admin@vivofashiongroup.com"
PASSWORD = "VivoAdmin!2026"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": EMAIL, "password": PASSWORD},
                      timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, f"no token in login body: {body}"
    return tok


@pytest.fixture(scope="session")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ────────────────────────── /api/footfall ──────────────────────────
class TestFootfallEndpoint:
    def test_footfall_rows_have_outside_and_turnin(self, headers):
        r = requests.get(f"{BASE_URL}/api/footfall", headers=headers, timeout=120)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        rows = body if isinstance(body, list) else (body.get("rows") or body.get("by_location") or body.get("data") or [])
        assert isinstance(rows, list) and len(rows) > 0, f"no rows; type={type(body).__name__}"
        # Find a sample row and verify both fields exist
        sample = rows[0]
        assert "outside_traffic" in sample, f"outside_traffic missing in row: {list(sample.keys())}"
        assert "turn_in_rate" in sample, f"turn_in_rate missing in row: {list(sample.keys())}"
        # Validate types: outside_traffic int/float ≥0, turn_in_rate None or non-negative
        ot = sample["outside_traffic"]
        tr = sample["turn_in_rate"]
        assert ot is None or (isinstance(ot, (int, float)) and ot >= 0), f"bad outside_traffic: {ot}"
        assert tr is None or (isinstance(tr, (int, float)) and tr >= 0), f"bad turn_in_rate: {tr}"

    def test_footfall_at_least_one_row_has_outside_traffic(self, headers):
        """We expect at least some stores to have a pavement counter installed."""
        r = requests.get(f"{BASE_URL}/api/footfall", headers=headers, timeout=120)
        assert r.status_code == 200
        body = r.json()
        rows = body if isinstance(body, list) else (body.get("rows") or [])
        with_outside = [r for r in rows if (r.get("outside_traffic") or 0) > 0]
        assert len(with_outside) > 0, "no rows have outside_traffic>0 — feature unusable"
        # For those rows, turn_in_rate must be a number (not None)
        for row in with_outside[:5]:
            assert row.get("turn_in_rate") is not None, (
                f"row {row.get('location')} has outside_traffic={row.get('outside_traffic')} "
                f"but turn_in_rate is None"
            )


# ────────────── /api/footfall/weekday-pattern ──────────────
class TestWeekdayPatternEndpoint:
    def test_weekday_pattern_per_row_has_new_fields(self, headers):
        r = requests.get(f"{BASE_URL}/api/footfall/weekday-pattern",
                         headers=headers, timeout=120)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        rows = body.get("by_location") or body.get("rows") or []
        assert isinstance(rows, list) and len(rows) > 0, f"no rows; keys={list(body.keys())}"
        sample = rows[0]
        # per-row aggregate fields
        for k in ("avg_outside_traffic", "avg_turn_in_rate", "total_outside_window"):
            assert k in sample, f"{k} missing from row: {list(sample.keys())}"
        # per-weekday list
        by_wkd = sample.get("by_weekday") or []
        assert len(by_wkd) > 0, "by_weekday empty"
        wkd_sample = by_wkd[0]
        for k in ("avg_outside_traffic", "avg_turn_in_rate"):
            assert k in wkd_sample, f"{k} missing from by_weekday entry: {list(wkd_sample.keys())}"

    def test_weekday_pattern_group_avg_has_new_fields(self, headers):
        r = requests.get(f"{BASE_URL}/api/footfall/weekday-pattern",
                         headers=headers, timeout=120)
        assert r.status_code == 200
        body = r.json()
        group_avg = body.get("group_avg_by_weekday") or []
        assert isinstance(group_avg, list) and len(group_avg) > 0, (
            f"group_avg_by_weekday missing/empty; keys={list(body.keys())}"
        )
        ga = group_avg[0]
        for k in ("avg_outside_traffic", "avg_turn_in_rate"):
            assert k in ga, f"{k} missing from group_avg entry: {list(ga.keys())}"
        # Validate non-negative numeric
        for k in ("avg_outside_traffic", "avg_turn_in_rate"):
            v = ga[k]
            assert v is None or (isinstance(v, (int, float)) and v >= 0), f"bad {k}: {v}"
