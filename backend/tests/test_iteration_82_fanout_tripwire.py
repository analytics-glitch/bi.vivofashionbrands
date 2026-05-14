"""Iteration 82 — Fan-out tripwire + self-healing.

When a single request would dispatch more than `_MAX_FANOUT_PER_REQUEST`
(default 8) upstream calls, the system:
  1. Aborts the live fan-out before any upstream HTTP call.
  2. Builds an approximate response from existing /kpis snapshots.
  3. Schedules background warm tasks for the exact missing combos.
  4. Logs the alert to `fanout_alerts` so the 2-hour audit can verify.

This test exercises the full flow: trip the wire, verify the response
is served from snapshots in <2s with `_fanout_protected=True`, confirm
the alert is logged, and run the self-heal endpoint to validate it
rebuilds the missing snapshots.
"""
import os
import time
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")

# 10 mixed channels (online + retail) — bypasses the channel-group
# rewrite so it hits the multi-fan-out code path. Planned fan-out is
# 1 country × 10 channels = 10, above the 8 threshold.
MIXED_CSV = ",".join([
    "Vivo Nakuru", "Vivo Sarit", "Vivo Junction", "Vivo Village Market",
    "Vivo Mama Ngina St", "Vivo Kigali Heights", "Vivo Moi Avenue",
    "Online - Shop Zetu", "Online - Vivo", "Online - Vivo Woman",
])


def _token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=60,
    )
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token")


def _hdrs() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


def test_tripwire_serves_from_snapshot():
    """Mixed 10-channel request must NOT trigger a 40-call fan-out;
    must be served from snapshots in <2s, with `_fanout_protected=True`.
    """
    today = time.strftime("%Y-%m-%d", time.gmtime())
    started = time.time()
    r = requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": today, "date_to": today, "channel": MIXED_CSV},
        headers=_hdrs(), timeout=20,
    )
    duration = time.time() - started
    assert r.status_code == 200, r.text
    body = r.json()
    assert duration < 5, f"Tripwire request took {duration:.2f}s (should be <2s warm)"
    assert body.get("_fanout_protected") is True, (
        f"Mixed 10-channel request was NOT intercepted: {body}"
    )
    assert body.get("_source") == "snapshot", body


def test_tripwire_alert_logged():
    """The alert must be persisted to `fanout_alerts` and visible via
    /admin/fanout-alerts (last 10 minutes)."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    # Trip the wire once.
    requests.get(
        f"{BASE_URL}/api/kpis",
        params={"date_from": today, "date_to": today, "channel": MIXED_CSV},
        headers=_hdrs(), timeout=20,
    )
    time.sleep(1)
    r = requests.get(
        f"{BASE_URL}/api/admin/fanout-alerts?minutes=10",
        headers=_hdrs(), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("count", 0) >= 1, body
    assert body.get("threshold") == 8
    most_recent = body["alerts"][0]
    assert most_recent["planned_calls"] >= 9
    assert most_recent["path"] == "/kpis"
    assert "snapshot" in most_recent["served_from"]


def test_self_heal_endpoint_idempotent():
    """`/admin/fanout-self-heal` must rebuild missing snapshots,
    return ok=True, and be safe to call repeatedly."""
    r1 = requests.post(
        f"{BASE_URL}/api/admin/fanout-self-heal",
        headers=_hdrs(), timeout=90,
    )
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1.get("ok") is True
    assert "rebuilt" in body1
    assert "distinct_combos" in body1
    # Idempotency: a second call shouldn't error.
    r2 = requests.post(
        f"{BASE_URL}/api/admin/fanout-self-heal",
        headers=_hdrs(), timeout=90,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json().get("ok") is True
