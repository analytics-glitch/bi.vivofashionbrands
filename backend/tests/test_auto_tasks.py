"""Vivo Clienteling — Auto-task generator (iteration 3).

Covers /api/social/auto-tasks/* endpoints:
- POST /run idempotency per ISO week
- GET /auto-tasks list shape
- GET /auto-tasks/runs history
- GET /auto-tasks/kpi shape + delta after completing one task
- Role enforcement (associate gets 403)
- Audit log captures social.autotask.run
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://crm-platform-145.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

MGR_TOKEN = os.environ.get("MGR_TOKEN", "test_session_vivo_mgr_1778250692444")
ASSOC_TOKEN = os.environ.get("ASSOC_TOKEN", "test_session_vivo_assoc_1778250692444")


@pytest.fixture(scope="session")
def mgr():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {MGR_TOKEN}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def assoc():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ASSOC_TOKEN}", "Content-Type": "application/json"})
    return s


# --- Role enforcement: associate gets 403 on all auto-tasks endpoints --- #
class TestRoleEnforcement:
    def test_assoc_run_forbidden(self, assoc):
        r = assoc.post(f"{API}/social/auto-tasks/run")
        assert r.status_code == 403

    def test_assoc_list_forbidden(self, assoc):
        r = assoc.get(f"{API}/social/auto-tasks")
        assert r.status_code == 403

    def test_assoc_runs_forbidden(self, assoc):
        r = assoc.get(f"{API}/social/auto-tasks/runs")
        assert r.status_code == 403

    def test_assoc_kpi_forbidden(self, assoc):
        r = assoc.get(f"{API}/social/auto-tasks/kpi")
        assert r.status_code == 403

    def test_unauth_run(self):
        r = requests.post(f"{API}/social/auto-tasks/run")
        assert r.status_code == 401


# --- /run: idempotency --- #
class TestRunIdempotency:
    def test_run_first_call(self, mgr):
        """Per task context: backend may already have a run for this ISO week.
        Accept either fresh run (already_run=False) or already_run=True as expected first state."""
        r = mgr.post(f"{API}/social/auto-tasks/run")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "already_run" in d
        assert "week_start" in d
        assert "tasks_created" in d
        # Persist for next test via class attr
        TestRunIdempotency._first_state = d

    def test_run_second_call_idempotent(self, mgr):
        """Second call MUST return already_run=True, tasks_created=0."""
        r = mgr.post(f"{API}/social/auto-tasks/run")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["already_run"] is True
        assert d["tasks_created"] == 0
        assert d["week_start"] == TestRunIdempotency._first_state["week_start"]


# --- /auto-tasks listing --- #
class TestListAutoTasks:
    def test_list_shape(self, mgr):
        r = mgr.get(f"{API}/social/auto-tasks", params={"include_completed": "true", "limit": 50})
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) > 0, "Expected pre-seeded auto-tasks per task context"
        for t in items:
            assert t.get("auto_generated") is True
            assert "auto_theme" in t
            assert "auto_count" in t and isinstance(t["auto_count"], int)
            assert "auto_week_start" in t
            assert "auto_platforms" in t and isinstance(t["auto_platforms"], list)
            assert "assignee_user_id" in t
            assert "assignee_name" in t
            assert t.get("customer_id") == ""  # system-wide
            # compliment must NOT be auto-generated
            assert t["auto_theme"] != "compliment"

    def test_filter_uncompleted(self, mgr):
        r = mgr.get(f"{API}/social/auto-tasks", params={"include_completed": "false"})
        assert r.status_code == 200
        for t in r.json():
            assert t.get("completed") is False


# --- /auto-tasks/runs history --- #
class TestRunsHistory:
    def test_runs_history(self, mgr):
        r = mgr.get(f"{API}/social/auto-tasks/runs")
        assert r.status_code == 200
        runs = r.json()
        assert isinstance(runs, list) and len(runs) >= 1
        latest = runs[0]
        assert "week_start" in latest
        assert "themes" in latest and isinstance(latest["themes"], list)
        assert "tasks_created" in latest
        assert "managers_notified" in latest
        for theme in latest["themes"]:
            assert "theme" in theme and "label" in theme and "count" in theme


# --- /auto-tasks/kpi shape + delta --- #
class TestKpiAndCompletion:
    def test_kpi_initial_shape(self, mgr):
        r = mgr.get(f"{API}/social/auto-tasks/kpi")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("open", "completed_14d", "median_resolution_hours",
                  "negative_feedback_7d", "tasks_created_7d", "last_run"):
            assert k in d, f"missing {k}"
        assert isinstance(d["open"], int)
        assert isinstance(d["completed_14d"], int)
        assert isinstance(d["negative_feedback_7d"], int)
        assert isinstance(d["tasks_created_7d"], int)
        # last_run can be None on a totally fresh system, but per task context one exists
        assert d["last_run"] is not None
        assert "week_start" in d["last_run"]
        TestKpiAndCompletion._before = d

    def test_complete_task_shifts_kpi(self, mgr):
        # Fetch one open auto-task
        r = mgr.get(f"{API}/social/auto-tasks", params={"include_completed": "false", "limit": 5})
        assert r.status_code == 200
        items = r.json()
        if not items:
            pytest.skip("No open auto-tasks to complete")
        task_id = items[0]["task_id"]

        before = TestKpiAndCompletion._before

        # Complete via tasks endpoint
        rc = mgr.post(f"{API}/tasks/{task_id}/complete")
        assert rc.status_code == 200, rc.text

        # Re-read KPI
        r2 = mgr.get(f"{API}/social/auto-tasks/kpi")
        assert r2.status_code == 200
        after = r2.json()
        assert after["open"] == before["open"] - 1, f"open did not decrement: {before['open']} -> {after['open']}"
        assert after["completed_14d"] == before["completed_14d"] + 1
        # Median: was likely None before; now must be a number
        assert after["median_resolution_hours"] is not None
        assert isinstance(after["median_resolution_hours"], (int, float))


# --- Audit log --- #
class TestAuditAutoTask:
    def test_audit_contains_autotask_run(self, mgr):
        r = mgr.get(f"{API}/audit", params={"limit": 200})
        assert r.status_code == 200
        actions = {ev.get("action") for ev in r.json()}
        assert "social.autotask.run" in actions, f"social.autotask.run not in audit; sample: {list(actions)[:10]}"
