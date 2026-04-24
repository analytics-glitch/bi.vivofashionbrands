"""
Product thumbnail catalog.

Upstream Vivo BI does not expose product images. To let buyers and store
managers discuss SKUs visually (Audit #8 — "fashion teams can't discuss
SKUs as text"), admins can attach a single image URL to any style_name.

Collection: `product_thumbnails`
Document shape:
    {
        style_name: str,        # case-sensitive, matches upstream style
        image_url:  str,        # absolute http(s) URL to a web-safe image
        updated_at: datetime,
        updated_by_email: str,
    }

Reads are open to any authenticated user; writes are admin-only. Callers
fetch thumbnails in a single batch via `POST /api/thumbnails/lookup` so
the frontend hydrates entire tables with one round-trip.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, HttpUrl

from auth import db, get_current_user, require_admin, User

router = APIRouter(prefix="/api/thumbnails", tags=["thumbnails"])


# ---------- models ----------

class ThumbnailRow(BaseModel):
    style_name: str
    image_url: str
    updated_at: Optional[datetime] = None
    updated_by_email: Optional[str] = None


class ThumbnailUpsert(BaseModel):
    style_name: str = Field(..., min_length=1, max_length=400)
    image_url: HttpUrl


class ThumbnailBulkUpsert(BaseModel):
    items: List[ThumbnailUpsert] = Field(..., min_length=1, max_length=500)


class LookupRequest(BaseModel):
    # Batch endpoint — GET query strings can balloon past proxy limits when
    # hydrating 200-row tables, so we accept the style list in a POST body.
    styles: List[str] = Field(..., min_length=1, max_length=500)


# ---------- indexes ----------

async def _ensure_index() -> None:
    try:
        await db.product_thumbnails.create_index(
            "style_name", unique=True, background=True,
        )
    except Exception:
        # best-effort; collection still works without the index
        pass


# ---------- routes ----------

@router.post("/lookup", response_model=Dict[str, str])
async def lookup_thumbnails(
    body: LookupRequest,
    _: User = Depends(get_current_user),
):
    """Return `{style_name: image_url}` for every style the caller asked
    about that has a stored thumbnail. Missing styles are simply omitted
    — the frontend falls back to its deterministic placeholder."""
    await _ensure_index()
    out: Dict[str, str] = {}
    # dedupe incoming list — preserves behaviour if callers double-send
    seen = list({s for s in body.styles if s})
    if not seen:
        return out
    async for doc in db.product_thumbnails.find(
        {"style_name": {"$in": seen}},
        {"_id": 0, "style_name": 1, "image_url": 1},
    ):
        out[doc["style_name"]] = doc["image_url"]
    return out


@router.get("", response_model=List[ThumbnailRow])
async def list_thumbnails(_: User = Depends(get_current_user)):
    """Admin-ish catalog view. Returned to any authenticated caller so
    managers can confirm what's been set, but writes stay admin-only."""
    await _ensure_index()
    rows: List[ThumbnailRow] = []
    async for doc in db.product_thumbnails.find(
        {}, {"_id": 0},
    ).sort("style_name", 1):
        rows.append(ThumbnailRow(**doc))
    return rows


@router.post("", response_model=ThumbnailRow)
async def set_thumbnail(
    body: ThumbnailUpsert,
    user: User = Depends(require_admin),
):
    await _ensure_index()
    now = datetime.now(timezone.utc)
    doc = {
        "style_name": body.style_name,
        "image_url": str(body.image_url),
        "updated_at": now,
        "updated_by_email": user.email,
    }
    await db.product_thumbnails.update_one(
        {"style_name": body.style_name},
        {"$set": doc},
        upsert=True,
    )
    return ThumbnailRow(**doc)


@router.post("/bulk", response_model=Dict[str, int])
async def set_thumbnails_bulk(
    body: ThumbnailBulkUpsert,
    user: User = Depends(require_admin),
):
    """Upsert many thumbnails at once. Useful for CSV-driven seeding."""
    await _ensure_index()
    now = datetime.now(timezone.utc)
    written = 0
    for it in body.items:
        await db.product_thumbnails.update_one(
            {"style_name": it.style_name},
            {"$set": {
                "style_name": it.style_name,
                "image_url": str(it.image_url),
                "updated_at": now,
                "updated_by_email": user.email,
            }},
            upsert=True,
        )
        written += 1
    return {"upserted": written}


@router.delete("/{style_name}")
async def delete_thumbnail(
    style_name: str,
    _: User = Depends(require_admin),
):
    res = await db.product_thumbnails.delete_one({"style_name": style_name})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No thumbnail for that style")
    return {"deleted": res.deleted_count}
