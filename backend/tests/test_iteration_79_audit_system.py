"""Iter 79 — Self-audit system regression tests."""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def test_email_alert_module_present():
    src = REPO / "email_alert.py"
    assert src.is_file()
    text = src.read_text()
    # Public surface sentinels.
    assert "def send_alert(" in text
    assert "def email_configured(" in text
    # Never-raise contract — every send goes through a try/except.
    assert "try:" in text
    assert "smtplib.SMTPAuthenticationError" in text


def test_audit_service_two_attempt_protocol():
    src = (REPO / "audit_service.py").read_text()
    # Every problem class must go through at least one auto-fix
    # attempt before being escalated.
    for needle in (
        "issues_auto_fixed",
        "issues_escalated",
        "fix_details",
        "attempt_2",
        "send_alert(",
    ):
        assert needle in src, f"missing sentinel: {needle}"
    # CEO email policy — WARNING only escalates on persistence.
    assert 'prev.get("status") == "WARNING"' in src


def test_run_audit_endpoint_secret_gated():
    """The /api/run-audit route must:
      • live OUTSIDE the JWT-gated api_router (cron has no JWT)
      • require AUDIT_TRIGGER_SECRET match
    """
    src = (REPO / "server.py").read_text()
    assert '@app.post("/api/run-audit")' in src
    assert 'AUDIT_TRIGGER_SECRET' in src
    assert 'invalid_or_missing_secret' in src
    # Background-task pattern — must not block the HTTP response since
    # the audit can take 5 min and the ingress times out at 60 s.
    assert "asyncio.create_task(_run_in_bg())" in src


def test_audit_log_endpoint_admin_only():
    src = (REPO / "server.py").read_text()
    assert '@api_router.get("/admin/audit-log")' in src
    assert "Depends(require_admin)" in src.split('@api_router.get("/admin/audit-log")')[1][:500]


def test_audit_log_ui_panel_exists():
    panel = REPO.parent / "frontend" / "src" / "components" / "AuditHistoryPanel.jsx"
    assert panel.is_file()
    text = panel.read_text()
    # Required UI elements per CEO spec.
    assert 'data-testid="audit-history-panel"' in text
    assert 'data-testid="audit-history-table"' in text
    assert 'data-testid="audit-email-pill"' in text
    assert "View full log" in text
    assert "Africa/Nairobi" in text  # timezone correctness


def test_cache_stats_pill_mounts_audit_panel():
    """The audit panel must be reachable from the existing CacheStatsPill
    drawer so admins find it where the CEO asked."""
    src = (
        REPO.parent / "frontend" / "src" / "components" / "CacheStatsPill.jsx"
    ).read_text()
    assert "AuditHistoryPanel" in src
    assert 'import AuditHistoryPanel' in src
