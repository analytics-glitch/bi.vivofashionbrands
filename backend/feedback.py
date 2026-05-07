"""
Feedback module — users submit dashboard feedback; admins can mark
items resolved.

Endpoints:
  POST   /api/feedback              - any logged-in user submits feedback
  GET    /api/feedback              - admin only: list all feedback
  PATCH  /api/feedback/{fid}        - admin only: toggle resolved / add note
  GET    /api/feedback/mine         - any user: their own submissions

The MongoDB collection is `feedback`. Each document looks like:
  {
    _id, id (uuid),
    user_id, user_email, user_name,
    page (e.g. "/ibt"),
    category ("bug" | "feature" | "data" | "general"),
    message,
    created_at,
    resolved (bool),
    resolved_by (admin email),
    resolved_at,
    admin_note,
  }
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

from auth import User, get_current_user, require_admin


# ── Mongo handle ──────────────────────────────────────────────────────
_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
_db = _client[os.environ["DB_NAME"]]
_coll = _db.feedback


# ── Models ────────────────────────────────────────────────────────────
class FeedbackCreate(BaseModel):
    page: Optional[str] = None
    category: str = Field(default="general", pattern="^(bug|feature|data|general)$")
    message: str = Field(..., min_length=4, max_length=4000)


class FeedbackUpdate(BaseModel):
    resolved: Optional[bool] = None
    admin_note: Optional[str] = None


class FeedbackOut(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_name: Optional[str] = None
    page: Optional[str] = None
    category: str
    message: str
    created_at: datetime
    resolved: bool = False
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    admin_note: Optional[str] = None


# ── Router ────────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/feedback", tags=["feedback"])


def _strip_id(doc: dict) -> dict:
    """Drop Mongo _id from a doc before returning."""
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


@router.post("", response_model=FeedbackOut)
async def submit_feedback(
    body: FeedbackCreate,
    user: User = Depends(get_current_user),
):
    """Any logged-in user can submit feedback."""
    fid = str(uuid.uuid4())
    doc = {
        "id": fid,
        "user_id": user.user_id,
        "user_email": user.email,
        "user_name": user.name,
        "page": body.page,
        "category": body.category,
        "message": body.message.strip(),
        "created_at": datetime.now(timezone.utc),
        "resolved": False,
        "resolved_by": None,
        "resolved_at": None,
        "admin_note": None,
    }
    await _coll.insert_one(doc)
    return _strip_id(doc)


@router.get("", response_model=List[FeedbackOut])
async def list_feedback(
    status: Optional[str] = Query(None, regex="^(all|open|resolved)$"),
    user: User = Depends(require_admin),
):
    """Admin-only — list every feedback entry, newest first."""
    q: dict = {}
    if status == "open":
        q["resolved"] = False
    elif status == "resolved":
        q["resolved"] = True
    cursor = _coll.find(q, {"_id": 0}).sort("created_at", -1)
    return [doc async for doc in cursor]


@router.get("/mine", response_model=List[FeedbackOut])
async def my_feedback(user: User = Depends(get_current_user)):
    """Logged-in user's own submissions."""
    cursor = _coll.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1)
    return [doc async for doc in cursor]


@router.patch("/{fid}", response_model=FeedbackOut)
async def update_feedback(
    fid: str,
    body: FeedbackUpdate,
    user: User = Depends(require_admin),
):
    """Admin-only — toggle resolved / set admin note."""
    update: dict = {}
    if body.resolved is not None:
        update["resolved"] = body.resolved
        update["resolved_by"] = user.email if body.resolved else None
        update["resolved_at"] = datetime.now(timezone.utc) if body.resolved else None
    if body.admin_note is not None:
        update["admin_note"] = body.admin_note
    if not update:
        raise HTTPException(400, "Nothing to update")
    result = await _coll.find_one_and_update(
        {"id": fid},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Feedback not found")
    return result
