"""Interactive AI chatbot for the Vivo BI dashboard.

Uses Emergent LLM key (Claude Sonnet 4.5) via emergentintegrations.
Multi-turn conversations are pinned to a `session_id`; messages are persisted
to MongoDB so the user can pick up where they left off.
"""
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from emergentintegrations.llm.chat import LlmChat, UserMessage

from auth import get_current_user, User, db


EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")

SYSTEM_PROMPT = """You are the Vivo Fashion Group BI Assistant — a data-savvy analyst
embedded in a retail business-intelligence dashboard for a fashion group operating
in Kenya, Uganda, Rwanda and online.

Your job: answer the user's questions clearly and concisely, using the dashboard
context the app provides in each turn. If the question requires data the user
hasn't shared, ask them to switch to the relevant dashboard page or filter.

Style guide:
- Short answers. 2-4 sentences for simple questions.
- Use bullet points for comparisons / breakdowns.
- Currency is ALWAYS Kenyan Shillings (KES) with comma separators — never $.
- When citing numbers from context, quote them exactly; don't invent figures.
- Offer one specific follow-up action or insight at the end when it's useful.
- You can explain BI concepts (ABV, ASP, MSI, SOR, Weeks of Cover, Conversion
  Rate, Churn, Stock-to-Sales) in plain English when asked.
"""

chat_router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None  # arbitrary JSON snapshot of current page


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    created_at: str


def _build_system_message(context: Optional[Dict[str, Any]]) -> str:
    base = SYSTEM_PROMPT
    if not context:
        return base
    try:
        # Trim context payload — keep it under ~6 KB of JSON.
        import json
        snippet = json.dumps(context, default=str)[:6000]
        return (
            f"{base}\n\n"
            "CURRENT DASHBOARD CONTEXT (JSON, may be truncated):\n"
            f"{snippet}\n"
        )
    except Exception:
        return base


@chat_router.post("", response_model=ChatResponse)
@chat_router.post("/", response_model=ChatResponse)
async def chat(body: ChatRequest, user: User = Depends(get_current_user)) -> ChatResponse:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "EMERGENT_LLM_KEY not configured on server")
    if not body.message or not body.message.strip():
        raise HTTPException(400, "message is required")

    session_id = body.session_id or f"chat_{uuid.uuid4().hex[:12]}"
    system_msg = _build_system_message(body.context)

    # Re-hydrate previous turns from Mongo (LlmChat keeps its own copy per
    # instance, so we seed it by sending the history when we construct it).
    # Simplest reliable path: issue one-shot; we don't rely on in-memory history
    # because each request creates a fresh LlmChat instance.
    history = await db.chat_messages.find(
        {"session_id": session_id, "user_id": user.user_id},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(length=40)

    # Build a combined transcript prefix so the model has context.
    transcript = ""
    for m in history[-12:]:  # last ~12 messages
        who = "User" if m["role"] == "user" else "Assistant"
        transcript += f"{who}: {m['content']}\n"

    prompt = (
        (f"Previous conversation (most recent last):\n{transcript}\n" if transcript else "")
        + f"User: {body.message}"
    )

    llm = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_msg,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    try:
        answer = await llm.send_message(UserMessage(text=prompt))
    except Exception as e:
        raise HTTPException(502, f"LLM error: {e}")

    now = datetime.now(timezone.utc)
    await db.chat_messages.insert_many([
        {
            "session_id": session_id,
            "user_id": user.user_id,
            "user_email": user.email,
            "role": "user",
            "content": body.message,
            "created_at": now,
        },
        {
            "session_id": session_id,
            "user_id": user.user_id,
            "user_email": user.email,
            "role": "assistant",
            "content": answer,
            "created_at": now,
        },
    ])

    return ChatResponse(session_id=session_id, answer=answer, created_at=now.isoformat())


@chat_router.get("/history")
async def history(
    session_id: str,
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    cursor = db.chat_messages.find(
        {"session_id": session_id, "user_id": user.user_id},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", 1)
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
        rows.append(r)
    return {"session_id": session_id, "messages": rows}
