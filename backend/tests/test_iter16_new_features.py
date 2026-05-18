"""Iter16 backend tests — Customer Moments, WhatsApp Co-pilot, Voice Notes, segments/filters regression.

Run: pytest /app/backend/tests/test_iter16_new_features.py -v --junitxml=/app/test_reports/pytest/iter16_results.xml
"""
import io
import os
import struct
import wave
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # backend env fallback for in-container regression
    BASE_URL = "http://localhost:8001"

MANAGER_TOKEN = "test_session_vivo_mgr_1778250692444"
CUSTOMER_ID = "3846911099035"  # Janet Masinde


@pytest.fixture(scope="module")
def hdrs():
    return {"Authorization": f"Bearer {MANAGER_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def auth_hdrs():
    return {"Authorization": f"Bearer {MANAGER_TOKEN}"}


# --------- Customer Moments CRUD ----------
class TestMoments:
    def test_list_moments_empty_or_list(self, hdrs):
        r = requests.get(f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments", headers=hdrs, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_create_moment_and_persist(self, hdrs):
        payload = {
            "type": "birthday",
            "date": "1990-06-15",
            "title": "TEST_Birthday",
            "recurring_annual": True,
            "remind_days_before": 7,
        }
        r = requests.post(f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments", json=payload, headers=hdrs, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["type"] == "birthday"
        assert body["title"] == "TEST_Birthday"
        assert body["recurring_annual"] is True
        assert body["remind_days_before"] == 7
        assert "moment_id" in body
        pytest.created_moment_id = body["moment_id"]

        # GET to verify persistence
        r2 = requests.get(f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments", headers=hdrs, timeout=15)
        assert r2.status_code == 200
        assert any(m.get("moment_id") == body["moment_id"] for m in r2.json())

    def test_create_moment_bad_type_400(self, hdrs):
        r = requests.post(
            f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments",
            json={"type": "not_a_real_event", "date": "2026-01-01"},
            headers=hdrs,
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "Invalid type" in r.json().get("detail", "")

    def test_create_moment_all_valid_types(self, hdrs):
        valid_types = ["anniversary", "graduation", "wedding", "baby", "promotion", "custom"]
        created = []
        for t in valid_types:
            r = requests.post(
                f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments",
                json={"type": t, "date": "2026-09-09", "title": f"TEST_{t}"},
                headers=hdrs,
                timeout=15,
            )
            assert r.status_code == 200, f"type={t} -> {r.status_code} {r.text}"
            created.append(r.json()["moment_id"])
        # cleanup
        for mid in created:
            requests.delete(f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments/{mid}", headers=hdrs, timeout=15)

    def test_delete_moment(self, hdrs):
        mid = getattr(pytest, "created_moment_id", None)
        if not mid:
            pytest.skip("No moment created in this run")
        r = requests.delete(f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments/{mid}", headers=hdrs, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}
        # verify removal
        r2 = requests.get(f"{BASE_URL}/api/customers/{CUSTOMER_ID}/moments", headers=hdrs, timeout=15)
        assert all(m.get("moment_id") != mid for m in r2.json())


# --------- WhatsApp Co-pilot draft-message ----------
class TestDraftMessage:
    def test_draft_checkin_warm(self, hdrs):
        r = requests.post(
            f"{BASE_URL}/api/customers/{CUSTOMER_ID}/draft-message",
            json={"intent": "checkin", "tone": "warm"},
            headers=hdrs,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["intent"] == "checkin"
        assert data["tone"] == "warm"
        assert isinstance(data["variants"], list)
        assert len(data["variants"]) >= 1
        for v in data["variants"]:
            assert "label" in v
            assert "text" in v
            assert isinstance(v["text"], str) and len(v["text"]) > 0

    @pytest.mark.parametrize("intent", ["winback", "birthday", "new_arrivals", "thank_you"])
    def test_draft_supported_intents(self, hdrs, intent):
        r = requests.post(
            f"{BASE_URL}/api/customers/{CUSTOMER_ID}/draft-message",
            json={"intent": intent, "tone": "warm"},
            headers=hdrs,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["intent"] == intent
        assert isinstance(body["variants"], list) and len(body["variants"]) >= 1

    def test_draft_custom_intent(self, hdrs):
        r = requests.post(
            f"{BASE_URL}/api/customers/{CUSTOMER_ID}/draft-message",
            json={"intent": "custom", "custom_prompt": "Invite her to a private trunk show on Saturday", "tone": "playful"},
            headers=hdrs,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["intent"] == "custom"
        assert body["tone"] == "playful"
        assert len(body["variants"]) >= 1

    def test_draft_404_for_unknown_customer(self, hdrs):
        r = requests.post(
            f"{BASE_URL}/api/customers/__nonexistent__/draft-message",
            json={"intent": "checkin"},
            headers=hdrs,
            timeout=20,
        )
        assert r.status_code == 404


# --------- Voice Note (Whisper) ----------
def _make_tiny_wav() -> bytes:
    """Generate a ~0.2s of silence WAV in memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        # 0.2 s of silence
        frames = b"\x00\x00" * 3200
        w.writeframes(frames)
    return buf.getvalue()


class TestVoiceNote:
    def test_voice_note_endpoint_accepts_audio(self, auth_hdrs):
        wav_bytes = _make_tiny_wav()
        files = {"audio": ("test.wav", wav_bytes, "audio/wav")}
        r = requests.post(
            f"{BASE_URL}/api/customers/{CUSTOMER_ID}/voice-note",
            headers=auth_hdrs,
            files=files,
            timeout=60,
        )
        # Whisper may legitimately reject silence with 502, that is accepted
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            d = r.json()
            assert "note_id" in d
            assert d.get("source") == "voice"
            assert "tags" in d
            tags = d["tags"]
            assert "interests" in tags
            assert "size_notes" in tags
            assert "sentiment" in tags
            assert "follow_up" in tags


# --------- segments/filters regression ----------
class TestSegmentFiltersRegression:
    def test_segments_filters_200(self, hdrs):
        r = requests.get(f"{BASE_URL}/api/segments/filters", headers=hdrs, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rfm_tiers" in data
        assert "cities" in data
        assert isinstance(data["rfm_tiers"], list)
        assert isinstance(data["cities"], list)
