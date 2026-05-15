"""Iter 84c — Redis quota observability tests.

Locks in the behaviour that Upstash's "max requests limit exceeded"
error string is parsed into a structured `redis_quota` snapshot the
audit service can include in the alert email. Also locks in the
defensive behaviour: non-quota errors must NOT touch the quota state,
and the `/api/admin/redis-quota` endpoint must always return a
well-formed body even when Redis is disabled.
"""
import os
import time
from pathlib import Path
import sys

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")


def _admin() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30,
    )
    r.raise_for_status()
    token = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {token}"}


# ───────── parse-side unit tests (no network) ──────────


def _fresh_cache():
    """Return a clean RedisCache-like object for assertions, isolated
    from the singleton's state so test order doesn't matter."""
    from redis_cache import RedisCache
    return RedisCache()


def test_quota_parser_extracts_limit_and_usage():
    rc = _fresh_cache()
    rc._maybe_parse_quota(
        "max requests limit exceeded. Limit: 500000, Usage: 487341. See ..."
    )
    s = rc.quota_status()
    assert s["known"] is True
    assert s["limit"] == 500000
    assert s["usage"] == 487341
    assert s["pct"] == 97.5
    assert s["exhausted"] is False
    assert s["status"] == "critical"


def test_quota_parser_status_thresholds():
    """50% → ok, 85% → warning, 97% → critical, 100% → exhausted."""
    cases = [
        (250000, "ok",      False),
        (425000, "warning", False),
        (475000, "critical", False),
        (500000, "exhausted", True),
    ]
    for usage, expected_status, expected_exhausted in cases:
        rc = _fresh_cache()
        rc._maybe_parse_quota(
            f"max requests limit exceeded. Limit: 500000, Usage: {usage}. ..."
        )
        s = rc.quota_status()
        assert s["status"] == expected_status, (usage, expected_status, s)
        assert s["exhausted"] is expected_exhausted, (usage, s)


def test_quota_parser_ignores_unrelated_errors():
    """Connection refused / DNS failure / timeout etc. must NOT
    overwrite a previously-good quota observation."""
    rc = _fresh_cache()
    rc._maybe_parse_quota(
        "max requests limit exceeded. Limit: 500000, Usage: 100. ..."
    )
    before = rc.quota_status()
    rc._maybe_parse_quota("Connection refused")
    rc._maybe_parse_quota("socket.timeout: ...")
    rc._maybe_parse_quota("")
    rc._maybe_parse_quota(None)  # type: ignore[arg-type]
    after = rc.quota_status()
    # observed_age_sec may have ticked up by 1 — exclude it from compare.
    before.pop("observed_age_sec", None)
    after.pop("observed_age_sec", None)
    assert before == after


def test_quota_parser_unknown_when_never_observed():
    """A fresh cache with no failures has status='unknown' (or
    'disabled' if REDIS_URL isn't set) — but never crashes."""
    rc = _fresh_cache()
    s = rc.quota_status()
    assert s["known"] is False
    assert s["limit"] is None
    assert s["usage"] is None
    assert s["pct"] is None
    assert s["status"] in ("unknown", "disabled")


# ───────── admin endpoint integration ──────────


def test_admin_endpoint_returns_well_formed_body():
    """`/api/admin/redis-quota` must always return the same shape even
    when no quota event has occurred yet."""
    if not BASE_URL:
        return  # CI without preview env — skip
    r = requests.get(
        f"{BASE_URL}/api/admin/redis-quota",
        headers=_admin(), timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("enabled", "known", "limit", "usage", "pct",
              "exhausted", "observed_age_sec", "status"):
        assert k in body, f"missing key: {k} ({body})"
    assert body["status"] in (
        "ok", "warning", "critical", "exhausted", "disabled", "unknown"
    )


def test_admin_endpoint_requires_admin():
    """Anonymous + non-admin callers MUST be denied — the response
    contains the monthly subscription state which is admin-only info."""
    if not BASE_URL:
        return
    r = requests.get(f"{BASE_URL}/api/admin/redis-quota", timeout=10)
    assert r.status_code in (401, 403), r.text


# ───────── audit-email render ──────────


def test_audit_email_body_includes_quota_line():
    """The Iter 84c email body must render a "Redis quota:" line in
    BOTH alert + daily-summary templates."""
    from audit_service import _format_alert_body
    fake_record = {
        "timestamp": "2026-05-15T07:00:00+03:00",
        "status": "WARNING",
        "performance": {"slowest_endpoint": "/api/kpis", "slowest_ms": 412},
        "data_accuracy": {"kenya": 100, "uganda": 5, "rwanda": 2, "online": 30},
        "connectivity": {"vivo_bi": True, "smtp": True},
        "system_health": {
            "cache_hit_rate": 88.4,
            "rss_mb": 712,
            "heavyguard_rejections": 0,
            "redis_quota_pct": 97.5,
            "redis_quota_status": "critical",
            "redis_quota_limit": 500000,
            "redis_quota_usage": 487341,
        },
        "issues_escalated": 1,
        "issues_auto_fixed": 0,
        "fix_details": [],
    }
    body = _format_alert_body(fake_record, ["test critical msg"])
    assert "Redis quota:" in body, body
    assert "97.5%" in body, body
    assert "487,341" in body and "500,000" in body, body
    assert "CRIT" in body, body


def test_audit_email_body_when_quota_unknown():
    """When Upstash has never reported a quota failure (steady-state)
    the line must render "n/a" — not crash on the f-string format."""
    from audit_service import _format_alert_body
    fake_record = {
        "timestamp": "2026-05-15T07:00:00+03:00",
        "status": "WARNING",
        "performance": {"slowest_endpoint": "/api/kpis", "slowest_ms": 412},
        "data_accuracy": {"kenya": 100, "uganda": 5, "rwanda": 2, "online": 30},
        "connectivity": {"vivo_bi": True, "smtp": True},
        "system_health": {
            "cache_hit_rate": 88.4,
            "rss_mb": 712,
            "heavyguard_rejections": 0,
            "redis_quota_pct": None,
            "redis_quota_status": "unknown",
            "redis_quota_limit": None,
            "redis_quota_usage": None,
        },
        "issues_escalated": 0,
        "issues_auto_fixed": 0,
        "fix_details": [],
    }
    body = _format_alert_body(fake_record, ["test msg"])
    assert "Redis quota:" in body
    assert "n/a" in body, body
