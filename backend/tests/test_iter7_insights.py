"""Iteration 7: Cohort analytics + 10 CRM features + Studio→CRM rename.

Tests /api/insights/* router and frontend HTML title.
"""
import os
import time
import pytest
import requests
from datetime import datetime, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")

MGR_TOKEN = "test_session_vivo_mgr_1778250692444"
ASSOC_TOKEN = "test_session_vivo_assoc_1778250692444"
JANET = "3846911099035"


@pytest.fixture
def mgr():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {MGR_TOKEN}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def assoc():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ASSOC_TOKEN}", "Content-Type": "application/json"})
    return s


# ------- RENAME -------
class TestRename:
    def test_html_title_is_vivo_crm(self):
        r = requests.get(BASE_URL + "/", timeout=15)
        assert r.status_code == 200
        assert "Vivo CRM" in r.text
        assert "Vivo Studio" not in r.text


# ------- COHORTS -------
class TestCohorts:
    def test_retention(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/cohorts/retention")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "months_window" in d
        assert "cohorts" in d and isinstance(d["cohorts"], list)
        assert len(d["cohorts"]) >= 3, f"want >=3 cohort rows, got {len(d['cohorts'])}"
        row = d["cohorts"][0]
        for k in ("cohort", "size", "retention", "avg_ltv_kes", "avg_orders", "tier_mix"):
            assert k in row, k
        for mk in ("m1", "m3", "m6", "m12"):
            assert mk in row["retention"], mk

    def test_tier_flow(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/cohorts/tier-flow")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "flows" in d and isinstance(d["flows"], list)
        if d["flows"]:
            row = d["flows"][0]
            for k in ("cohort", "size", "by_tier", "ltv_by_tier_kes"):
                assert k in row

    def test_by_channel_sorted(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/cohorts/by-channel")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "channels" in d
        sizes = [c["size"] for c in d["channels"]]
        assert sizes == sorted(sizes, reverse=True), "channels must be sorted desc by size"
        if d["channels"]:
            for k in ("channel", "size", "active_180d_pct", "avg_ltv_kes", "tier_mix"):
                assert k in d["channels"][0]

    def test_triangle(self, mgr):
        # may be slow first call (paginates BI /orders); allow up to 90s
        r = mgr.get(f"{BASE_URL}/api/insights/cohorts/triangle?months=12", timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "rows" in d
        assert "months" in d
        assert "source" in d


# ------- LTV / REORDER / LOOK-ALIKES -------
class TestLTV:
    def test_top(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/ltv/top?limit=10")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "customers" in d and isinstance(d["customers"], list)
        if d["customers"]:
            for k in ("customer_id", "customer_name", "rfm_tier", "lifetime_spend_kes",
                      "forecast_12m_orders", "forecast_12m_ltv_kes", "confidence"):
                assert k in d["customers"][0], k
            # sorted desc by forecast
            forecasts = [c["forecast_12m_ltv_kes"] for c in d["customers"]]
            assert forecasts == sorted(forecasts, reverse=True)

    def test_reorder(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/reorder-candidates?window_days=14")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("window_days") == 14
        assert "candidates" in d
        if d["candidates"]:
            for k in ("customer_id", "avg_cadence_days", "days_since_last", "due_in_days"):
                assert k in d["candidates"][0]

    def test_lookalikes(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/lookalikes/{JANET}?limit=5")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["anchor"]["customer_id"] == JANET
        assert "matches" in d

    def test_lookalikes_404(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/lookalikes/9999999999999?limit=5")
        assert r.status_code == 404


# ------- DAILY BRIEF / LEADERBOARD / EVENTS -------
class TestOps:
    def test_daily_brief(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/daily-brief")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("for_date", "headline", "yesterday_kpis", "today",
                  "top_quality_issues_7d", "top_performers_7d"):
            assert k in d, k
        for k in ("anniversaries", "at_risk_top", "vip_silent_top", "lookbooks_so_far"):
            assert k in d["today"], k

    def test_daily_brief_assoc_blocked(self, assoc):
        r = assoc.get(f"{BASE_URL}/api/insights/daily-brief")
        assert r.status_code in (401, 403)

    def test_leaderboard_week(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/leaderboard?period=week")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["period"] == "week"
        assert "rows" in d
        assert "window_days" in d

    def test_leaderboard_month(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/leaderboard?period=month")
        assert r.status_code == 200
        assert r.json()["period"] == "month"

    def test_leaderboard_invalid(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/leaderboard?period=invalid")
        assert r.status_code == 400

    def test_upcoming_events_empty_initially(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/upcoming-events?days=30")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("window_days") == 30
        assert "events" in d


# ------- LIFE EVENTS via DOB prefs -------
class TestLifeEventsDOB:
    def test_dob_appears_in_events(self, mgr):
        # Pick a DOB that falls within next 5 days (mm-dd part)
        target = datetime.utcnow().date() + timedelta(days=3)
        dob = f"2020-{target.month:02d}-{target.day:02d}"
        # Update prefs
        r = mgr.put(
            f"{BASE_URL}/api/preferences/{JANET}",
            json={"dob": dob, "key_dates": [{"label": "anniversary", "date": "2018-06-12"}]},
        )
        assert r.status_code in (200, 201, 204), r.text

        r2 = mgr.get(f"{BASE_URL}/api/insights/upcoming-events?days=30")
        assert r2.status_code == 200
        events = r2.json()["events"]
        # find Janet
        ids = [e.get("customer_id") for e in events]
        assert JANET in ids, f"Expected {JANET} in events after dob update; got {ids[:5]}"


# ------- WISHLIST CRUD -------
class TestWishlist:
    _wid = None

    def test_create(self, mgr):
        payload = {
            "customer_id": JANET,
            "customer_name": "Janet Masinde",
            "product_title": "TEST_Iter7 Wishlist Item",
            "note": "regression",
        }
        r = mgr.post(f"{BASE_URL}/api/insights/wishlists", json=payload)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        TestWishlist._wid = d.get("wishlist_id") or d.get("id") or d.get("_id")
        assert TestWishlist._wid
        assert d.get("product_title") == "TEST_Iter7 Wishlist Item"

    def test_list(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/wishlists/{JANET}")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert any(i.get("product_title") == "TEST_Iter7 Wishlist Item" for i in items)

    def test_fulfill(self, mgr):
        wid = TestWishlist._wid
        assert wid
        r = mgr.post(f"{BASE_URL}/api/insights/wishlists/{wid}/fulfill")
        assert r.status_code == 200, r.text
        r2 = mgr.get(f"{BASE_URL}/api/insights/wishlists/{JANET}")
        match = [i for i in r2.json() if (i.get("wishlist_id") or i.get("id") or i.get("_id")) == wid]
        assert match and match[0].get("fulfilled") is True

    def test_delete(self, mgr):
        wid = TestWishlist._wid
        r = mgr.delete(f"{BASE_URL}/api/insights/wishlists/{wid}")
        assert r.status_code in (200, 204), r.text
        r2 = mgr.get(f"{BASE_URL}/api/insights/wishlists/{JANET}")
        ids = [(i.get("wishlist_id") or i.get("id") or i.get("_id")) for i in r2.json()]
        assert wid not in ids


# ------- WALK-INS -------
class TestWalkins:
    _id = None

    def test_create(self, mgr):
        r = mgr.post(f"{BASE_URL}/api/insights/walkins",
                     json={"customer_id": JANET, "customer_name": "Janet Masinde"})
        assert r.status_code in (200, 201), r.text
        d = r.json()
        TestWalkins._id = d.get("checkin_id") or d.get("id") or d.get("_id")
        assert TestWalkins._id

    def test_list_today(self, mgr):
        r = mgr.get(f"{BASE_URL}/api/insights/walkins")
        assert r.status_code == 200
        rows = r.json()
        items = rows if isinstance(rows, list) else rows.get("walkins") or rows.get("items") or []
        ids = [(i.get("checkin_id") or i.get("id") or i.get("_id")) for i in items]
        assert TestWalkins._id in ids

    def test_serve(self, mgr):
        r = mgr.post(f"{BASE_URL}/api/insights/walkins/{TestWalkins._id}/serve")
        assert r.status_code == 200, r.text


# ------- SOCIAL REPLY SUGGEST -------
class TestReplySuggest:
    def test_suggest_reply(self, mgr):
        # find a feedback_id
        r = mgr.get(f"{BASE_URL}/api/social/feedback?limit=5")
        if r.status_code != 200:
            pytest.skip(f"social feedback list unavailable: {r.status_code}")
        rows = r.json()
        items = rows if isinstance(rows, list) else rows.get("items") or rows.get("feedback") or []
        if not items:
            pytest.skip("no social feedback rows seeded")
        fid = items[0].get("id") or items[0].get("_id") or items[0].get("feedback_id")
        assert fid
        r2 = mgr.post(f"{BASE_URL}/api/insights/social/suggest-reply",
                      json={"feedback_id": fid}, timeout=30)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert "reply" in d
        assert d.get("tone") in ("warm", "apologetic", "informative", "celebratory")
