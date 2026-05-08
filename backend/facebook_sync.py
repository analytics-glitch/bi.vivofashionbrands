"""Facebook Graph API sync — pulls Page posts, comments, reviews, mentions
into our existing social_posts + social_feedback collections.

Requires PAGE-LEVEL credentials. App-level credentials (App ID + App Secret +
Client Token) alone CANNOT read a Facebook Page's content — Meta requires a
Page Access Token granted by a Page admin via OAuth.

To enable: set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN in /app/backend/.env
(get the token via Graph API Explorer: https://developers.facebook.com/tools/explorer/
selecting the Vivo Page and the pages_read_engagement + pages_read_user_generated_content
scopes; then paste the long-lived Page Token).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("vivo.fb")

API_VERSION = os.environ.get("FACEBOOK_API_VERSION", "v19.0")
BASE = f"https://graph.facebook.com/{API_VERSION}"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def app_access_token() -> str:
    """Mint App Access Token from App ID + Secret. Limited to public/cross-page operations."""
    return f"{os.environ.get('FACEBOOK_APP_ID', '')}|{os.environ.get('FACEBOOK_APP_SECRET', '')}"


async def fb_get(path: str, params: Dict[str, Any], token: str) -> Dict[str, Any]:
    p = {**params, "access_token": token}
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(f"{BASE}{path}", params=p)
        if r.status_code != 200:
            logger.warning("FB %s -> %s: %s", path, r.status_code, r.text[:300])
            r.raise_for_status()
        return r.json()


async def sync_facebook_page(db, page_id: str, page_token: str, max_posts: int = 25) -> Dict[str, Any]:
    """Fetch posts + comments + reviews + mentions for a page; upsert into our
    existing social_* collections so they flow through the same UI + classifier."""
    summary = {"posts": 0, "comments": 0, "reviews": 0, "mentions": 0, "errors": []}
    if not page_id or not page_token:
        return {**summary, "errors": ["page_id and page_token required"]}

    # Posts
    try:
        posts_resp = await fb_get(
            f"/{page_id}/posts",
            {"fields": "id,message,created_time,permalink_url,attachments{media,type}", "limit": max_posts},
            page_token,
        )
        for p in posts_resp.get("data", []):
            attach = (p.get("attachments") or {}).get("data", [])
            image_url = None
            if attach and attach[0].get("media", {}).get("image"):
                image_url = attach[0]["media"]["image"].get("src")
            doc = {
                "post_id": f"fb_{p['id']}",
                "platform": "facebook",
                "author_handle": "@vivofashion",
                "author_name": "Vivo Fashion",
                "body": p.get("message") or "",
                "image_url": image_url,
                "posted_at": p.get("created_time"),
                "likes": 0,
                "comments_count": 0,
                "shares": 0,
                "reach": 0,
                "permalink_url": p.get("permalink_url"),
                "source": "facebook_graph",
                "synced_at": iso(now_utc()),
            }
            await db.social_posts.update_one({"post_id": doc["post_id"]}, {"$set": doc}, upsert=True)
            summary["posts"] += 1

            # Comments on this post
            try:
                comm_resp = await fb_get(
                    f"/{p['id']}/comments",
                    {"fields": "id,message,from,created_time,like_count", "limit": 25},
                    page_token,
                )
                for c in comm_resp.get("data", []):
                    fb_doc = {
                        "feedback_id": f"fb_{c['id']}",
                        "platform": "facebook",
                        "type": "comment",
                        "author_handle": "@" + (c.get("from", {}).get("name", "user").lower().replace(" ", ".")),
                        "author_name": c.get("from", {}).get("name", "Anonymous"),
                        "body": c.get("message") or "",
                        "post_id": f"fb_{p['id']}",
                        "posted_at": c.get("created_time"),
                        "engagement_likes": c.get("like_count", 0),
                        "sentiment": None,
                        "themes": [],
                        "customer_id": None,
                        "classified_at": None,
                        "replied_at": None,
                        "reply_body": None,
                        "source": "facebook_graph",
                        "synced_at": iso(now_utc()),
                    }
                    await db.social_feedback.update_one({"feedback_id": fb_doc["feedback_id"]}, {"$set": fb_doc}, upsert=True)
                    summary["comments"] += 1
            except Exception as exc:  # noqa: BLE001
                summary["errors"].append(f"comments {p['id']}: {exc}")
    except Exception as exc:  # noqa: BLE001
        summary["errors"].append(f"posts: {exc}")

    # Reviews / ratings
    try:
        rev = await fb_get(
            f"/{page_id}/ratings",
            {"fields": "review_text,rating,created_time,reviewer", "limit": 50},
            page_token,
        )
        for r in rev.get("data", []):
            if not r.get("review_text"):
                continue
            doc = {
                "feedback_id": f"fb_review_{r.get('reviewer',{}).get('id','x')}_{r.get('created_time','')}",
                "platform": "facebook",
                "type": "review",
                "author_handle": "@" + (r.get("reviewer", {}).get("name", "user").lower().replace(" ", ".")),
                "author_name": r.get("reviewer", {}).get("name", "Anonymous"),
                "body": r.get("review_text") or "",
                "post_id": None,
                "posted_at": r.get("created_time"),
                "engagement_likes": 0,
                "rating": r.get("rating"),
                "sentiment": None,
                "themes": [],
                "customer_id": None,
                "classified_at": None,
                "replied_at": None,
                "reply_body": None,
                "source": "facebook_graph",
                "synced_at": iso(now_utc()),
            }
            await db.social_feedback.update_one({"feedback_id": doc["feedback_id"]}, {"$set": doc}, upsert=True)
            summary["reviews"] += 1
    except Exception as exc:  # noqa: BLE001
        summary["errors"].append(f"reviews: {exc}")

    return summary
