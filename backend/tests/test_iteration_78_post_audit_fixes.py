"""Iter 78 (post-audit) — bug-fix regression tests.

Locks in the three bug fixes shipped after the full self-audit:

  • Bug #1 (false alarm)   — audit script endpoint list corrected.
                              Verified by inspection — no test.
  • Bug #2 — chain-wide IBT now UNIONs per-country snapshots so the
             "All countries" filter on /ibt returns recommendations
             instead of [].
  • Bug #3 — axios response interceptor in lib/api.js redirects to
             /login?session_expired=1 on 401 (non-auth paths).
  • Security — /admin/flush-kpi-cache now requires admin role.
"""
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent


def test_chain_wide_ibt_unions_per_country():
    """Source sentinel — wrapper must check `country is None` and
    iterate _SNAPSHOT_COUNTRIES to union per-country snapshots before
    falling through to live."""
    src = (REPO / "server.py").read_text()
    assert "if country is None:" in src
    assert "for c in _SNAPSHOT_COUNTRIES:" in src
    assert "per_country.extend(snap_c)" in src
    assert "per_country.sort(" in src


def test_401_interceptor_redirects_to_login():
    """The axios response interceptor must clear stored token and
    bounce to /login on 401 (skipping auth-path requests)."""
    api_js = (REPO.parent / "frontend" / "src" / "lib" / "api.js").read_text()
    # Iter 78 sentinels — keep these literal so a refactor that breaks
    # the redirect fails this test loudly.
    assert "status === 401 && !isAuthPath" in api_js
    assert "/login?session_expired=1" in api_js
    assert "_respCache.clear()" in api_js


def test_login_page_surfaces_session_expired():
    """The Login page must read `session_expired=1` from the query
    string and render a friendly amber banner before the user gets
    confused by a silent state-loss."""
    login_jsx = (REPO.parent / "frontend" / "src" / "pages" / "Login.jsx").read_text()
    assert 'sessionExpired' in login_jsx
    assert 'session_expired' in login_jsx
    assert 'login-session-expired' in login_jsx


def test_flush_cache_requires_admin():
    """Security regression — /admin/flush-kpi-cache must NOT be open
    to anonymous callers. Lock in the require_admin dependency."""
    src = (REPO / "server.py").read_text()
    assert (
        '@api_router.post("/admin/flush-kpi-cache")\n'
        "async def admin_flush_kpi_cache(_: User = Depends(require_admin)):"
    ) in src


def test_snapshot_count_endpoint_exists():
    """Standing 2-hour audit script depends on this lightweight
    Mongo-count endpoint to verify the precompute layer is populated."""
    src = (REPO / "server.py").read_text()
    assert '@api_router.get("/admin/snapshot-count")' in src
    assert 'analytics_snapshots' in src
    assert 'kpi_snapshots' in src


def test_2hour_audit_script_exists():
    """Standing instruction — audit_2hour.py + the GHA workflow must
    both ship in-repo so this is reproducible from a clean checkout."""
    audit = REPO / "tests" / "audit_2hour.py"
    wf = REPO.parent / ".github" / "workflows" / "audit-2hour.yml"
    assert audit.is_file(), "audit_2hour.py missing"
    assert wf.is_file(), "audit-2hour.yml workflow missing"
    text = audit.read_text()
    # Exact-format sentinels from the CEO's request.
    assert "🕐 2-HOUR AUDIT" in text
    assert "Performance Pulse" in text
    assert "Data Accuracy Pulse" in text
    assert "System Health Pulse" in text
    assert "Login & Connectivity" in text
    assert "CRITICAL ALERTS" in text
    assert "auto-fix" in text.lower()
