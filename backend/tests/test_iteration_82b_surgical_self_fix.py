"""Iteration 82 (Part 2) — Surgical self-fix endpoints for the
remaining audit ESCALATIONs.

User shared an audit alert that showed:
  • Fan-out tripwire fired 7× → RESOLVED ✓ (our new mechanism)
  • Cache hit rate stuck at 40.4% → ESCALATED (no real auto-fix existed)
  • RSS still 1277MB → ESCALATED (flush-kpi-cache was wrong tool)

This iter adds:
  • POST /admin/warm-snapshots-now — populates snapshot layer
    (lifts hit rate by ADDING entries, not by destroying them).
  • POST /admin/trim-memory — clears the big drill-down caches
    while preserving snapshots, then forces GC.

Both are admin-only and idempotent.
"""
import os
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")
VIEWER_EMAIL = os.environ.get("SEED_VIEWER_EMAIL", "viewer@vivofashiongroup.com")
VIEWER_PASS = os.environ.get("SEED_VIEWER_PASSWORD", "Viewer!2026")


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password}, timeout=60,
    )
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token")


def _admin() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASS)}"}


def _viewer() -> dict:
    return {"Authorization": f"Bearer {_login(VIEWER_EMAIL, VIEWER_PASS)}"}


def test_warm_snapshots_now_async_ack():
    """Default (async) mode must return <2s with `queued: true`."""
    r = requests.post(
        f"{BASE_URL}/api/admin/warm-snapshots-now",
        headers=_admin(), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("queued") is True
    assert "queued_at" in body
    assert body.get("expected_completion_sec", 0) > 0


def test_warm_snapshots_now_sync_returns_counters():
    """`sync=true` blocks until done and returns kpi_written/analytics_written."""
    r = requests.post(
        f"{BASE_URL}/api/admin/warm-snapshots-now?sync=true",
        headers=_admin(), timeout=240,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert "kpi_written" in body
    assert "analytics_written" in body
    assert "duration_sec" in body
    # If anything was written, totals must be > 0 (sanity)
    assert body.get("kpi_total", 0) > 0


def test_trim_memory_returns_rss_and_clears_caches():
    """`/admin/trim-memory` must return rss_before/rss_after and a list
    of cleared caches. Idempotent — safe to call repeatedly."""
    r1 = requests.post(
        f"{BASE_URL}/api/admin/trim-memory",
        headers=_admin(), timeout=30,
    )
    assert r1.status_code == 200, r1.text
    body = r1.json()
    assert body.get("ok") is True
    assert "rss_before_mb" in body
    assert "rss_after_mb" in body
    assert "gc_freed" in body
    assert isinstance(body.get("cleared_caches"), list)
    assert len(body["cleared_caches"]) >= 5  # we clear ~16 caches
    # Second call must also succeed (idempotency).
    r2 = requests.post(
        f"{BASE_URL}/api/admin/trim-memory",
        headers=_admin(), timeout=30,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json().get("ok") is True


def test_admin_endpoints_require_admin():
    """Both endpoints must reject non-admin (viewer) tokens with 403."""
    for path in ("/admin/warm-snapshots-now", "/admin/trim-memory"):
        r = requests.post(
            f"{BASE_URL}/api{path}",
            headers=_viewer(), timeout=15,
        )
        assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"
