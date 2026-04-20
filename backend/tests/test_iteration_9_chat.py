"""Iteration 9 — Chat endpoint + delta smoke tests.

Focus:
- POST /api/chat returns an answer (uses Emergent LLM key / Claude Sonnet 4.5)
- GET /api/chat/history returns prior turns for the session
- Auth protection on /api/chat and existing /api/kpis
- Login with seeded admin still works
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://bi-platform-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@vivofashiongroup.com"
ADMIN_PASS = "VivoAdmin!2026"


@pytest.fixture(scope="session")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10
    assert data.get("user", {}).get("role") == "admin"
    return data["token"]


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth still enforced ----------

def test_chat_requires_auth():
    r = requests.post(f"{BASE_URL}/api/chat", json={"message": "hi"}, timeout=15)
    assert r.status_code in (401, 403), r.status_code


def test_chat_history_requires_auth():
    r = requests.get(f"{BASE_URL}/api/chat/history", params={"session_id": "x"}, timeout=15)
    assert r.status_code in (401, 403), r.status_code


def test_kpis_with_auth(auth_headers):
    # Retry once if upstream hiccups per review note
    last = None
    for _ in range(2):
        r = requests.get(
            f"{BASE_URL}/api/kpis",
            params={"date_from": "2026-04-01", "date_to": "2026-04-19"},
            headers=auth_headers,
            timeout=60,
        )
        last = r
        if r.status_code == 200:
            break
        time.sleep(2)
    assert last.status_code == 200, f"kpis failed: {last.status_code} {last.text[:300]}"


# ---------- Chat POST ----------

@pytest.fixture(scope="session")
def chat_session_id():
    return f"TEST_chat_{uuid.uuid4().hex[:10]}"


def test_chat_empty_message_400(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/chat",
        json={"message": "   ", "session_id": "x"},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 400


def test_chat_post_returns_answer(auth_headers, chat_session_id):
    payload = {
        "message": "In one short sentence, what is ABV in retail analytics?",
        "session_id": chat_session_id,
        "context": {"page": "/overview", "countries": ["KE"]},
    }
    r = requests.post(
        f"{BASE_URL}/api/chat",
        json=payload,
        headers=auth_headers,
        timeout=60,  # LLM call can take several seconds
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    data = r.json()
    assert data.get("session_id") == chat_session_id
    assert isinstance(data.get("answer"), str) and len(data["answer"]) > 5
    assert "created_at" in data


def test_chat_post_second_turn_multiturn(auth_headers, chat_session_id):
    # second turn on same session — model should not error; answer returned
    payload = {
        "message": "Give me one tip to increase it.",
        "session_id": chat_session_id,
    }
    r = requests.post(
        f"{BASE_URL}/api/chat",
        json=payload,
        headers=auth_headers,
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    data = r.json()
    assert data["session_id"] == chat_session_id
    assert isinstance(data["answer"], str) and len(data["answer"]) > 3


# ---------- Chat history ----------

def test_chat_history_returns_turns(auth_headers, chat_session_id):
    # small delay for write propagation
    time.sleep(1)
    r = requests.get(
        f"{BASE_URL}/api/chat/history",
        params={"session_id": chat_session_id},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["session_id"] == chat_session_id
    msgs = data.get("messages", [])
    # 2 turns posted * 2 rows (user + assistant) = 4 rows
    assert len(msgs) >= 4, f"expected >=4 messages, got {len(msgs)}"
    roles = [m["role"] for m in msgs]
    assert roles.count("user") >= 2
    assert roles.count("assistant") >= 2
    for m in msgs:
        assert "_id" not in m  # mongo _id must be excluded
        assert m["content"]
