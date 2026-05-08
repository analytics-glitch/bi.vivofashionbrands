"""Social listening + customer feedback module.

Reads from MongoDB (mocked v1 seed mirroring how a BigQuery-fed endpoint would
look — swap in `bi_get('/social-...')` later by env to switch).

Provides:
- Owned posts (engagement metrics)
- Feedback stream: comments, mentions, DMs, reviews across IG/FB/TikTok/X/WhatsApp
- Sentiment + theme classification via Claude Sonnet 4.5 (Emergent universal key)
- Customer<->social-handle linking
- Per-customer activity timeline
- Influencer leaderboard
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel

logger = logging.getLogger("vivo.social")

PLATFORMS = ["instagram", "facebook", "tiktok", "x", "whatsapp"]
THEME_VOCAB = [
    "sizing", "fit", "fabric", "delivery", "customer_service", "pricing",
    "style", "stock", "returns", "quality", "compliment", "request_info",
]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


# --------------------------------------------------------------------------- #
# Mock seed                                                                   #
# --------------------------------------------------------------------------- #

POST_TEMPLATES = [
    ("Vivo Lulu Cotton Tent Mini Dress in Mustard — {{drop_line}}", "https://images.unsplash.com/photo-1485518882345-15568b007407?w=600&q=80"),
    ("New arrival: Safari Long Sleeve Waterfall in Black — limited stock at all stores.", "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&q=80"),
    ("Behind the seams: meet the team crafting Vivo Lulu collection in Nairobi.", "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=600&q=80"),
    ("Vivo x Shop Zetu — free delivery within Nairobi this weekend only.", "https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?w=600&q=80"),
    ("Spring lookbook 2026 is live online. Three silhouettes, six colour stories.", "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&q=80"),
    ("Tag a friend who needs this Maxi Dress for {{occasion}}.", "https://images.unsplash.com/photo-1495121605193-b116b5b9c5fe?w=600&q=80"),
    ("Restock alert: Essence Linen Top — sizes S–XL back in store today.", "https://images.unsplash.com/photo-1551803091-e20673f15770?w=600&q=80"),
    ("Vivo Junction store hours extended for the long weekend.", "https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=600&q=80"),
]

POSITIVE_FEEDBACK = [
    "Absolutely love my new dress! Got so many compliments at the wedding 💛",
    "Quality is amazing, fit is perfect. Will be back!",
    "Just received my order — packaging is beautiful, fabric feels luxurious.",
    "Vivo Sarit team gave us the best service. Sarah was incredible.",
    "Finally a Kenyan brand that understands my body type 🙌",
    "The maxi dress is everything!! 10/10",
    "My third order this season. Vivo never disappoints.",
    "Cotton is so soft and breathable. Worth every shilling.",
    "@vivofashion thank you for the quick delivery 🚚",
    "Absolutely smitten with the Lulu collection.",
]
NEGATIVE_FEEDBACK = [
    "Ordered a size M but it's running really small. Disappointed.",
    "Delivery took 8 days when I was promised 3. Not okay.",
    "Returns process is confusing — three calls and still no refund.",
    "The fabric pilled after just two washes. Expected better quality at this price.",
    "Why is the Westgate store always out of size L?",
    "Customer service didn't pick up the phone for 30 minutes.",
    "Buttons came off the first time I wore it. Sending it back.",
    "Saw the dress on @vivofashion stories but it's already sold out online.",
    "Pricing has gone up too much this season honestly.",
    "Colour is much darker than the photos online — very misleading.",
]
NEUTRAL_FEEDBACK = [
    "Do you ship to Mombasa?",
    "Is this available in petite sizing?",
    "Are the Sarit and Junction branches open today?",
    "Does this come in navy as well?",
    "What time does the Vivo Junction store close?",
    "Hi, can I exchange a top bought online at any branch?",
    "Will the Lulu collection have a restock this month?",
    "Do you do alterations in-store?",
]

INFLUENCER_HANDLES = [
    ("@nairobifashionist", "Nairobi Fashionista", True),
    ("@stylebyamani", "Amani K.", True),
    ("@kenyanmuse", "Wanjiku M.", True),
    ("@thefitlibrary", "Fit Library", True),
    ("@modernlagos", "Modern Lagos", False),
]
PUBLIC_HANDLES = [
    ("@sarah_w", "Sarah W."),
    ("@maina_eric", "Eric Maina"),
    ("@nyaboke254", "Lillian Nyaboke"),
    ("@grace.k", "Grace K."),
    ("@kelvin_o", "Kelvin O."),
    ("@nairobimum", "Aisha B."),
    ("@_zawadi_", "Zawadi N."),
    ("@chichi.atieno", "Chichi Atieno"),
    ("@mwangi.dev", "Joe Mwangi"),
    ("@beatrice.j", "Beatrice J."),
    ("@hellokemunto", "Kemunto"),
    ("@miss_vivian", "Vivian K."),
]
OCCASIONS = ["a wedding", "graduation", "weekend brunch", "the office", "a date night"]
DROPS = ["Mustard back in stock", "Now in 4 colourways", "Restocked at all stores", "Online exclusive"]


def _seed_posts() -> List[Dict[str, Any]]:
    posts = []
    base = now_utc() - timedelta(days=45)
    for i in range(40):
        body, image = random.choice(POST_TEMPLATES)
        body = body.replace("{{drop_line}}", random.choice(DROPS)).replace("{{occasion}}", random.choice(OCCASIONS))
        platform = random.choice(PLATFORMS[:4])  # owned posts: skip whatsapp
        posted = base + timedelta(days=i, hours=random.randint(0, 23))
        likes = random.randint(40, 1800)
        comments = random.randint(2, 60)
        shares = random.randint(0, 90)
        reach = likes * random.randint(8, 25)
        posts.append({
            "post_id": f"post_{platform}_{i:04d}",
            "platform": platform,
            "author_handle": "@vivofashion",
            "author_name": "Vivo Fashion",
            "body": body,
            "image_url": image,
            "posted_at": iso(posted),
            "likes": likes,
            "comments_count": comments,
            "shares": shares,
            "reach": reach,
        })
    return posts


def _seed_feedback(posts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    feedback = []
    base = now_utc() - timedelta(days=30)
    types = ["comment", "mention", "dm", "review"]
    for i in range(180):
        kind_pool = random.random()
        if kind_pool < 0.45:
            body = random.choice(POSITIVE_FEEDBACK)
        elif kind_pool < 0.75:
            body = random.choice(NEGATIVE_FEEDBACK)
        else:
            body = random.choice(NEUTRAL_FEEDBACK)
        ftype = random.choices(types, weights=[55, 15, 25, 5])[0]
        platform = random.choice(PLATFORMS) if ftype != "review" else "facebook"
        # Influencers contribute ~12% of all feedback
        if random.random() < 0.12:
            handle, name, _ = random.choice(INFLUENCER_HANDLES)
        else:
            handle, name = random.choice(PUBLIC_HANDLES)
        post_id = None
        if ftype == "comment":
            post_id = random.choice(posts)["post_id"]
        posted = base + timedelta(days=random.randint(0, 30), hours=random.randint(0, 23), minutes=random.randint(0, 59))
        feedback.append({
            "feedback_id": f"fb_{i:05d}",
            "platform": platform,
            "type": ftype,
            "author_handle": handle,
            "author_name": name,
            "body": body,
            "post_id": post_id,
            "posted_at": iso(posted),
            "engagement_likes": random.randint(0, 25),
            "sentiment": None,
            "themes": [],
            "customer_id": None,
            "classified_at": None,
            "replied_at": None,
            "reply_body": None,
        })
    return feedback


# --------------------------------------------------------------------------- #
# LLM classifier                                                              #
# --------------------------------------------------------------------------- #

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

CLASSIFY_SYSTEM = (
    "You classify short-form social media feedback for a Kenyan fashion brand. "
    "Return STRICT JSON: an array of objects, one per input, each with keys "
    "`id` (string from input), `sentiment` (one of: positive, neutral, negative), "
    "and `themes` (array of 0-3 strings from this vocabulary only: "
    + ", ".join(THEME_VOCAB)
    + "). No prose, no markdown, JSON only."
)


async def classify_batch(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Classify a batch of feedback items via Claude Sonnet 4.5."""
    if not items:
        return []
    if not EMERGENT_LLM_KEY:
        # Heuristic fallback if no key
        return [{"id": x["id"], "sentiment": "neutral", "themes": []} for x in items]

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"vivo-social-classify-{int(now_utc().timestamp())}",
            system_message=CLASSIFY_SYSTEM,
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")

        prompt = "Classify the following items. Return JSON only.\n" + json.dumps(
            [{"id": x["id"], "text": x["text"]} for x in items], ensure_ascii=False
        )
        msg = UserMessage(text=prompt)
        raw = await chat.send_message(msg)
        text = str(raw).strip()
        # Extract JSON from possible code-fence
        m = re.search(r"\[[\s\S]*\]", text)
        if not m:
            raise ValueError("No JSON array in LLM response")
        parsed = json.loads(m.group(0))
        out = []
        for it in parsed:
            sentiment = it.get("sentiment", "neutral")
            if sentiment not in ("positive", "neutral", "negative"):
                sentiment = "neutral"
            themes = [t for t in (it.get("themes") or []) if t in THEME_VOCAB][:3]
            out.append({"id": it.get("id"), "sentiment": sentiment, "themes": themes})
        # Guarantee 1:1 mapping (fall back to neutral for anything missing)
        by_id = {x["id"]: x for x in out}
        return [by_id.get(x["id"], {"id": x["id"], "sentiment": "neutral", "themes": []}) for x in items]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Classifier failed, falling back to neutral: %s", exc)
        return [{"id": x["id"], "sentiment": "neutral", "themes": []} for x in items]


async def classify_pending(db, limit: int = 60) -> int:
    """Classify up to `limit` unclassified feedback items in batches of 20."""
    cursor = db.social_feedback.find({"sentiment": None}, {"_id": 0, "feedback_id": 1, "body": 1}).limit(limit)
    pending = await cursor.to_list(limit)
    if not pending:
        return 0
    classified_total = 0
    for i in range(0, len(pending), 20):
        chunk = pending[i:i + 20]
        items = [{"id": p["feedback_id"], "text": p["body"]} for p in chunk]
        results = await classify_batch(items)
        ts = iso(now_utc())
        for r in results:
            await db.social_feedback.update_one(
                {"feedback_id": r["id"]},
                {"$set": {"sentiment": r["sentiment"], "themes": r["themes"], "classified_at": ts}},
            )
            classified_total += 1
    return classified_total


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

class HandleIn(BaseModel):
    platform: str
    handle: str


class LinkIn(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None


class ReplyIn(BaseModel):
    body: str


# --------------------------------------------------------------------------- #
# Router                                                                      #
# --------------------------------------------------------------------------- #

router = APIRouter(prefix="/social", tags=["social"])


def make_router(get_current_user, require_manager, db, audit_fn):
    """Factory so the router can use the deps + db from server.py."""

    async def _ensure_seed():
        if await db.social_posts.count_documents({}) == 0:
            posts = _seed_posts()
            await db.social_posts.insert_many([dict(p) for p in posts])
            fb = _seed_feedback(posts)
            await db.social_feedback.insert_many([dict(f) for f in fb])
            logger.info("Seeded %d posts and %d feedback items", len(posts), len(fb))
            # Best-effort first classification (fire and forget)
            try:
                asyncio.create_task(classify_pending(db, limit=60))
            except Exception:  # noqa: BLE001
                pass

    @router.get("/summary")
    async def summary(date_from: Optional[str] = None, date_to: Optional[str] = None, _: Any = Depends(get_current_user)):
        await _ensure_seed()
        # filter feedback by date
        query: Dict[str, Any] = {}
        if date_from and date_to:
            query["posted_at"] = {"$gte": date_from, "$lte": date_to + "T23:59:59"}
        feedback = await db.social_feedback.find(query, {"_id": 0}).to_list(5000)
        posts = await db.social_posts.find(query if not date_from else {}, {"_id": 0}).to_list(5000)

        # ensure classified
        unclassified = [f for f in feedback if not f.get("sentiment")]
        if unclassified:
            asyncio.create_task(classify_pending(db, limit=40))

        by_platform: Dict[str, Dict[str, int]] = {}
        sentiment_totals = {"positive": 0, "neutral": 0, "negative": 0}
        themes: Dict[str, int] = {}
        for f in feedback:
            p = f["platform"]
            by_platform.setdefault(p, {"feedback": 0, "positive": 0, "neutral": 0, "negative": 0})
            by_platform[p]["feedback"] += 1
            s = f.get("sentiment") or "neutral"
            by_platform[p][s] += 1
            sentiment_totals[s] += 1
            for t in f.get("themes") or []:
                themes[t] = themes.get(t, 0) + 1
        engagement = {"likes": 0, "comments": 0, "shares": 0, "reach": 0}
        for p in posts:
            engagement["likes"] += p.get("likes", 0)
            engagement["comments"] += p.get("comments_count", 0)
            engagement["shares"] += p.get("shares", 0)
            engagement["reach"] += p.get("reach", 0)

        unmatched = sum(1 for f in feedback if not f.get("customer_id"))
        return {
            "totals": {
                "feedback": len(feedback),
                "posts": len(posts),
                "unmatched": unmatched,
                "classified": len(feedback) - len(unclassified),
            },
            "engagement": engagement,
            "sentiment": sentiment_totals,
            "by_platform": by_platform,
            "top_themes": sorted([{"theme": k, "count": v} for k, v in themes.items()], key=lambda x: -x["count"])[:8],
        }

    @router.get("/posts")
    async def list_posts(
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        platform: Optional[str] = None,
        limit: int = 30,
        _: Any = Depends(get_current_user),
    ):
        await _ensure_seed()
        query: Dict[str, Any] = {}
        if platform:
            query["platform"] = platform
        if date_from and date_to:
            query["posted_at"] = {"$gte": date_from, "$lte": date_to + "T23:59:59"}
        cursor = db.social_posts.find(query, {"_id": 0}).sort("likes", -1).limit(limit)
        return await cursor.to_list(limit)

    @router.get("/feedback")
    async def list_feedback(
        platform: Optional[str] = None,
        sentiment: Optional[str] = None,
        type: Optional[str] = None,
        customer_id: Optional[str] = None,
        unmatched: bool = False,
        q: Optional[str] = None,
        limit: int = 100,
        _: Any = Depends(get_current_user),
    ):
        await _ensure_seed()
        # ensure classified
        if await db.social_feedback.count_documents({"sentiment": None}) > 0:
            await classify_pending(db, limit=60)

        query: Dict[str, Any] = {}
        if platform:
            query["platform"] = platform
        if sentiment:
            query["sentiment"] = sentiment
        if type:
            query["type"] = type
        if customer_id:
            query["customer_id"] = customer_id
        if unmatched:
            query["customer_id"] = None
        if q:
            query["body"] = {"$regex": re.escape(q), "$options": "i"}
        cursor = db.social_feedback.find(query, {"_id": 0}).sort("posted_at", -1).limit(limit)
        return await cursor.to_list(limit)

    @router.get("/mentions")
    async def list_mentions(date_from: Optional[str] = None, date_to: Optional[str] = None, limit: int = 50, _: Any = Depends(get_current_user)):
        await _ensure_seed()
        query: Dict[str, Any] = {"type": "mention"}
        if date_from and date_to:
            query["posted_at"] = {"$gte": date_from, "$lte": date_to + "T23:59:59"}
        cursor = db.social_feedback.find(query, {"_id": 0}).sort("posted_at", -1).limit(limit)
        return await cursor.to_list(limit)

    @router.get("/influencers")
    async def list_influencers(date_from: Optional[str] = None, date_to: Optional[str] = None, limit: int = 15, _: Any = Depends(get_current_user)):
        await _ensure_seed()
        match: Dict[str, Any] = {}
        if date_from and date_to:
            match["posted_at"] = {"$gte": date_from, "$lte": date_to + "T23:59:59"}
        pipeline = [
            {"$match": match} if match else {"$match": {}},
            {
                "$group": {
                    "_id": {"handle": "$author_handle", "name": "$author_name"},
                    "platforms": {"$addToSet": "$platform"},
                    "feedback_count": {"$sum": 1},
                    "engagement": {"$sum": "$engagement_likes"},
                    "positive": {"$sum": {"$cond": [{"$eq": ["$sentiment", "positive"]}, 1, 0]}},
                    "negative": {"$sum": {"$cond": [{"$eq": ["$sentiment", "negative"]}, 1, 0]}},
                    "last_seen": {"$max": "$posted_at"},
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "handle": "$_id.handle",
                    "name": "$_id.name",
                    "platforms": 1,
                    "feedback_count": 1,
                    "engagement": 1,
                    "positive": 1,
                    "negative": 1,
                    "last_seen": 1,
                }
            },
            {"$sort": {"engagement": -1}},
            {"$limit": limit},
        ]
        return await db.social_feedback.aggregate(pipeline).to_list(limit)

    @router.get("/dms")
    async def list_dms(customer_id: Optional[str] = None, unmatched: bool = False, limit: int = 100, _: Any = Depends(get_current_user)):
        await _ensure_seed()
        query: Dict[str, Any] = {"type": "dm"}
        if customer_id:
            query["customer_id"] = customer_id
        if unmatched:
            query["customer_id"] = None
        cursor = db.social_feedback.find(query, {"_id": 0}).sort("posted_at", -1).limit(limit)
        return await cursor.to_list(limit)

    @router.get("/timeline/{customer_id}")
    async def customer_timeline(customer_id: str, _: Any = Depends(get_current_user)):
        # social feedback by linked handle OR by customer_id
        handles = await db.customer_social_handles.find({"customer_id": customer_id}, {"_id": 0}).to_list(50)
        handle_set = list({h["handle"] for h in handles})
        query: Dict[str, Any] = {"$or": [{"customer_id": customer_id}]}
        if handle_set:
            query["$or"].append({"author_handle": {"$in": handle_set}})
        feedback = await db.social_feedback.find(query, {"_id": 0}).sort("posted_at", -1).to_list(200)
        return {"handles": handles, "items": feedback}

    @router.get("/handles/{customer_id}")
    async def get_handles(customer_id: str, _: Any = Depends(get_current_user)):
        return await db.customer_social_handles.find({"customer_id": customer_id}, {"_id": 0}).to_list(50)

    @router.post("/handles/{customer_id}")
    async def add_handle(customer_id: str, payload: HandleIn, request: Request, user: Any = Depends(get_current_user)):
        if payload.platform not in PLATFORMS:
            raise HTTPException(status_code=400, detail="Invalid platform")
        handle = payload.handle.strip()
        if not handle.startswith("@") and payload.platform != "whatsapp":
            handle = "@" + handle
        doc = {
            "customer_id": customer_id,
            "platform": payload.platform,
            "handle": handle,
            "linked_by_user_id": user.user_id,
            "linked_by_name": user.name,
            "linked_at": iso(now_utc()),
        }
        await db.customer_social_handles.update_one(
            {"customer_id": customer_id, "platform": payload.platform},
            {"$set": doc},
            upsert=True,
        )
        # Backfill: link any existing feedback from that handle to this customer
        await db.social_feedback.update_many(
            {"author_handle": handle, "customer_id": None},
            {"$set": {"customer_id": customer_id}},
        )
        await audit_fn(user, "social.handle.add", "customer", customer_id, request)
        return doc

    @router.delete("/handles/{customer_id}/{platform}")
    async def remove_handle(customer_id: str, platform: str, request: Request, user: Any = Depends(get_current_user)):
        await db.customer_social_handles.delete_one({"customer_id": customer_id, "platform": platform})
        await audit_fn(user, "social.handle.remove", "customer", customer_id, request)
        return {"ok": True}

    @router.post("/feedback/{feedback_id}/link")
    async def link_feedback(feedback_id: str, payload: LinkIn, request: Request, user: Any = Depends(get_current_user)):
        await db.social_feedback.update_one(
            {"feedback_id": feedback_id},
            {"$set": {"customer_id": payload.customer_id}},
        )
        await audit_fn(user, "social.feedback.link", "customer", payload.customer_id, request)
        return {"ok": True}

    @router.post("/feedback/{feedback_id}/reply")
    async def reply_feedback(feedback_id: str, payload: ReplyIn, request: Request, user: Any = Depends(get_current_user)):
        await db.social_feedback.update_one(
            {"feedback_id": feedback_id},
            {"$set": {"reply_body": payload.body, "replied_at": iso(now_utc()), "replied_by_user_id": user.user_id, "replied_by_name": user.name}},
        )
        await audit_fn(user, "social.feedback.reply", "feedback", feedback_id, request)
        doc = await db.social_feedback.find_one({"feedback_id": feedback_id}, {"_id": 0})
        return doc

    @router.post("/classify-pending")
    async def run_classifier(_: Any = Depends(require_manager)):
        n = await classify_pending(db, limit=200)
        return {"classified": n}

    return router
