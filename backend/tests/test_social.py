"""Vivo Clienteling — Social module test suite (iteration 2).

Covers /api/social/* endpoints:
- summary, posts, feedback (filters), mentions, influencers, dms
- handles GET/POST/DELETE + backfill
- timeline by customer_id
- feedback link + reply + audit
- classify-pending manager-only
- sentiment + theme classifier output sanity
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://crm-platform-145.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

MGR_TOKEN = os.environ.get("MGR_TOKEN", "test_session_vivo_mgr_1778250692444")
ASSOC_TOKEN = os.environ.get("ASSOC_TOKEN", "test_session_vivo_assoc_1778250692444")

REAL_CUSTOMER_ID = "3846911099035"  # Janet Masinde

THEME_VOCAB = {
    "sizing", "fit", "fabric", "delivery", "customer_service", "pricing",
    "style", "stock", "returns", "quality", "compliment", "request_info",
}


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


@pytest.fixture(scope="session", autouse=True)
def ensure_classified(mgr):
    """Make sure all 180 items have sentiment populated before tests assert on it."""
    # Trigger seed + classify
    r = mgr.get(f"{API}/social/summary")
    assert r.status_code == 200, r.text
    # Manager kicks the classifier (sync)
    for _ in range(3):
        cls = mgr.post(f"{API}/social/classify-pending")
        assert cls.status_code == 200, cls.text
        if cls.json()["classified"] == 0:
            break
        time.sleep(1)
    yield


# --- Auth gating --- #
class TestAuth:
    def test_summary_unauth(self):
        r = requests.get(f"{API}/social/summary")
        assert r.status_code == 401

    def test_classify_pending_assoc_forbidden(self, assoc):
        r = assoc.post(f"{API}/social/classify-pending")
        assert r.status_code == 403

    def test_classify_pending_manager_ok(self, mgr):
        r = mgr.post(f"{API}/social/classify-pending")
        assert r.status_code == 200
        assert "classified" in r.json()


# --- Seed + summary --- #
class TestSummary:
    def test_summary_shape_and_seed(self, mgr):
        r = mgr.get(f"{API}/social/summary")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["totals"]["feedback"] == 180
        assert d["totals"]["posts"] == 40
        assert set(d["sentiment"].keys()) == {"positive", "neutral", "negative"}
        # platforms: 5 expected
        assert set(d["by_platform"].keys()) <= {"instagram", "facebook", "tiktok", "x", "whatsapp"}
        assert isinstance(d["top_themes"], list)
        assert d["engagement"]["likes"] > 0


# --- Posts --- #
class TestPosts:
    def test_list_posts(self, mgr):
        r = mgr.get(f"{API}/social/posts", params={"limit": 10})
        assert r.status_code == 200
        items = r.json()
        assert 1 <= len(items) <= 10
        for p in items:
            assert "post_id" in p and "platform" in p and "likes" in p

    def test_filter_platform(self, mgr):
        r = mgr.get(f"{API}/social/posts", params={"platform": "instagram", "limit": 50})
        assert r.status_code == 200
        for p in r.json():
            assert p["platform"] == "instagram"


# --- Feedback list + filters --- #
class TestFeedback:
    def test_all_classified(self, mgr):
        r = mgr.get(f"{API}/social/feedback", params={"limit": 200})
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 180
        for it in items:
            assert it.get("sentiment") in ("positive", "neutral", "negative")
            for t in it.get("themes") or []:
                assert t in THEME_VOCAB

    def test_filter_platform_dm(self, mgr):
        r = mgr.get(f"{API}/social/feedback", params={"platform": "instagram"})
        assert r.status_code == 200
        for it in r.json():
            assert it["platform"] == "instagram"
        r2 = mgr.get(f"{API}/social/feedback", params={"type": "dm"})
        assert r2.status_code == 200
        for it in r2.json():
            assert it["type"] == "dm"

    def test_filter_sentiment_positive(self, mgr):
        r = mgr.get(f"{API}/social/feedback", params={"sentiment": "positive", "limit": 50})
        assert r.status_code == 200
        for it in r.json():
            assert it["sentiment"] == "positive"

    def test_filter_unmatched(self, mgr):
        r = mgr.get(f"{API}/social/feedback", params={"unmatched": "true"})
        assert r.status_code == 200
        for it in r.json():
            assert it.get("customer_id") in (None, "")

    def test_search_q(self, mgr):
        r = mgr.get(f"{API}/social/feedback", params={"q": "delivery"})
        assert r.status_code == 200
        for it in r.json():
            assert "delivery" in it["body"].lower()


# --- Classifier sanity (positive vs negative pickup) --- #
class TestClassifierSanity:
    def test_positive_and_negative_present(self, mgr):
        rp = mgr.get(f"{API}/social/feedback", params={"sentiment": "positive", "limit": 50})
        rn = mgr.get(f"{API}/social/feedback", params={"sentiment": "negative", "limit": 50})
        assert rp.status_code == 200 and rn.status_code == 200
        assert len(rp.json()) > 0, "Expected at least 1 positive item"
        assert len(rn.json()) > 0, "Expected at least 1 negative item"

    def test_themes_vocab_only(self, mgr):
        r = mgr.get(f"{API}/social/feedback", params={"limit": 200})
        assert r.status_code == 200
        for it in r.json():
            for t in it.get("themes") or []:
                assert t in THEME_VOCAB, f"Unexpected theme {t}"


# --- Mentions, Influencers, DMs --- #
class TestMentionsInfluencersDMs:
    def test_mentions(self, mgr):
        r = mgr.get(f"{API}/social/mentions")
        assert r.status_code == 200
        for it in r.json():
            assert it["type"] == "mention"

    def test_influencers(self, mgr):
        r = mgr.get(f"{API}/social/influencers")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        if items:
            top = items[0]
            assert "handle" in top and "feedback_count" in top and "engagement" in top

    def test_dms(self, mgr):
        r = mgr.get(f"{API}/social/dms")
        assert r.status_code == 200
        for it in r.json():
            assert it["type"] == "dm"


# --- Handles + timeline + backfill --- #
class TestHandlesTimeline:
    def test_add_handle_backfills_and_timeline(self, mgr):
        cust = REAL_CUSTOMER_ID
        # Clean any prior handle for this platform
        mgr.delete(f"{API}/social/handles/{cust}/instagram")

        # Pick a handle that exists in seed feedback
        rfb = mgr.get(f"{API}/social/feedback", params={"limit": 200})
        handles = sorted({f["author_handle"] for f in rfb.json() if f["platform"] == "instagram"})
        # Prefer @maina_eric if seeded
        chosen = "@maina_eric" if any(h == "@maina_eric" for h in handles) else handles[0]

        r = mgr.post(f"{API}/social/handles/{cust}", json={"platform": "instagram", "handle": chosen})
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["customer_id"] == cust
        assert doc["handle"] == chosen
        assert doc["platform"] == "instagram"

        # GET handles
        r2 = mgr.get(f"{API}/social/handles/{cust}")
        assert r2.status_code == 200
        assert any(h["handle"] == chosen for h in r2.json())

        # Timeline should include >0 items
        r3 = mgr.get(f"{API}/social/timeline/{cust}")
        assert r3.status_code == 200
        d = r3.json()
        assert "handles" in d and "items" in d
        assert len(d["items"]) > 0, "Backfill failed: no items linked"
        # All items should be tied to this handle (or have customer_id == cust)
        for it in d["items"]:
            assert it.get("author_handle") == chosen or it.get("customer_id") == cust

        # DELETE handle
        r4 = mgr.delete(f"{API}/social/handles/{cust}/instagram")
        assert r4.status_code == 200
        assert r4.json()["ok"] is True

    def test_handle_invalid_platform(self, mgr):
        r = mgr.post(f"{API}/social/handles/{REAL_CUSTOMER_ID}",
                     json={"platform": "myspace", "handle": "@x"})
        assert r.status_code == 400


# --- Feedback link + reply --- #
class TestFeedbackLinkReply:
    def test_link_and_reply(self, mgr):
        # Pick first unmatched feedback
        r = mgr.get(f"{API}/social/feedback", params={"unmatched": "true", "limit": 1})
        assert r.status_code == 200 and len(r.json()) > 0
        fb_id = r.json()[0]["feedback_id"]

        # Link
        cust = REAL_CUSTOMER_ID
        r2 = mgr.post(f"{API}/social/feedback/{fb_id}/link",
                      json={"customer_id": cust, "customer_name": "Janet Masinde"})
        assert r2.status_code == 200

        # Reply
        body = f"TEST_reply_{uuid.uuid4().hex[:6]}"
        r3 = mgr.post(f"{API}/social/feedback/{fb_id}/reply", json={"body": body})
        assert r3.status_code == 200
        d = r3.json()
        assert d["reply_body"] == body
        assert d["replied_at"] is not None
        assert d["customer_id"] == cust

    def test_associate_can_link_and_reply(self, assoc, mgr):
        r = mgr.get(f"{API}/social/feedback", params={"unmatched": "true", "limit": 1})
        if not r.json():
            pytest.skip("No unmatched left")
        fb_id = r.json()[0]["feedback_id"]
        r2 = assoc.post(f"{API}/social/feedback/{fb_id}/link",
                        json={"customer_id": REAL_CUSTOMER_ID})
        assert r2.status_code == 200
        r3 = assoc.post(f"{API}/social/feedback/{fb_id}/reply", json={"body": "TEST_assoc reply"})
        assert r3.status_code == 200


# --- Audit --- #
class TestAuditSocial:
    def test_audit_contains_social_actions(self, mgr):
        r = mgr.get(f"{API}/audit", params={"limit": 200})
        assert r.status_code == 200
        actions = {ev.get("action") for ev in r.json()}
        # At least one of the social actions we just performed should be present
        expected = {"social.handle.add", "social.handle.remove", "social.feedback.link", "social.feedback.reply"}
        assert actions & expected, f"None of {expected} in audit; got {actions}"


# --- Role enforcement (associate access matrix) --- #
class TestAssocRoleMatrix:
    def test_assoc_can_read_summary(self, assoc):
        r = assoc.get(f"{API}/social/summary")
        assert r.status_code == 200

    def test_assoc_can_read_feedback(self, assoc):
        r = assoc.get(f"{API}/social/feedback", params={"limit": 5})
        assert r.status_code == 200

    def test_assoc_can_read_mentions_and_influencers(self, assoc):
        assert assoc.get(f"{API}/social/mentions").status_code == 200
        assert assoc.get(f"{API}/social/influencers").status_code == 200

    def test_assoc_can_read_handles(self, assoc):
        assert assoc.get(f"{API}/social/handles/{REAL_CUSTOMER_ID}").status_code == 200
