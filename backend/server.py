"""Vivo Clienteling backend.

- Auth: Emergent-managed Google Auth (session_id -> session_token cookie + Bearer fallback).
- Reads live customer/sales/inventory data from the Vivo BI API.
- MongoDB persists clienteling-specific data only (notes, tasks, preferences,
  message logs, lookbooks, consent records, audit log, message templates).
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Body, Cookie, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.cors import CORSMiddleware

# --------------------------------------------------------------------------- #
# Setup                                                                       #
# --------------------------------------------------------------------------- #

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
logger = logging.getLogger("vivo")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
BI_API_URL = os.environ.get("BI_API_URL", "https://vivo-bi-api-666430550422.europe-west1.run.app")
MANAGER_EMAILS = {e.strip().lower() for e in os.environ.get("MANAGER_EMAILS", "").split(",") if e.strip()}

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

app = FastAPI(title="Vivo Clienteling")
api = APIRouter(prefix="/api")


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}" if prefix else uuid.uuid4().hex


# --------------------------------------------------------------------------- #
# BI client (with simple in-memory TTL cache)                                  #
# --------------------------------------------------------------------------- #

_BI_CACHE: Dict[str, tuple[float, Any]] = {}
_BI_TTL_SECONDS = 60.0


async def bi_get(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    params = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    cache_key = f"{path}?{sorted(params.items())}"
    cached = _BI_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _BI_TTL_SECONDS:
        return cached[1]
    url = f"{BI_API_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url, params=params)
            if r.status_code != 200:
                logger.warning("BI API %s -> %s : %s", path, r.status_code, r.text[:200])
                return None
            data = r.json()
            _BI_CACHE[cache_key] = (time.time(), data)
            return data
    except Exception as exc:  # noqa: BLE001
        logger.warning("BI API call failed %s: %s", path, exc)
        return None


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: str = "associate"  # 'associate' or 'manager'
    created_at: datetime


class NoteIn(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    body: str


class TaskIn(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    title: str
    due_date: Optional[str] = None  # YYYY-MM-DD
    notes: Optional[str] = None


class PreferencesIn(BaseModel):
    sizes: Optional[Dict[str, str]] = None  # {top, bottom, shoes}
    fits: Optional[List[str]] = None
    fabrics: Optional[List[str]] = None
    occasions: Optional[List[str]] = None
    brands: Optional[List[str]] = None


class TemplateIn(BaseModel):
    name: str
    channel: str  # whatsapp | sms
    body: str


class MessageIn(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    channel: str  # whatsapp | sms
    template_id: Optional[str] = None
    template_name: Optional[str] = None
    body: str
    placeholders: Optional[Dict[str, str]] = None


class ConsentIn(BaseModel):
    customer_id: str
    channel: str
    opted_in: bool
    method: Optional[str] = "in_store"


class LookbookIn(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    title: Optional[str] = "A selection for you"
    note: Optional[str] = None
    items: List[Dict[str, Any]] = []  # [{sku, product_title, image, price, ...}]


class InterestIn(BaseModel):
    sku: str
    product_title: Optional[str] = None


# --------------------------------------------------------------------------- #
# Auth                                                                        #
# --------------------------------------------------------------------------- #

EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


async def _audit(actor: User, action: str, target: str = "", target_id: str = "", request: Optional[Request] = None) -> None:
    try:
        await db.audit_log.insert_one({
            "audit_id": new_id(),
            "actor_user_id": actor.user_id,
            "actor_name": actor.name,
            "actor_email": actor.email,
            "action": action,
            "target": target,
            "target_id": target_id,
            "ip": request.client.host if (request and request.client) else None,
            "timestamp": iso(now_utc()),
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("audit log failed: %s", exc)


async def _resolve_role(email: str) -> str:
    if email.lower() in MANAGER_EMAILS:
        return "manager"
    # Bootstrap: first ever user becomes manager so the demo can showcase the manager view.
    has_manager = await db.users.find_one({"role": "manager"}, {"_id": 0})
    if has_manager is None:
        return "manager"
    return "associate"


async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> User:
    token = session_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = sess.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    if isinstance(user_doc.get("created_at"), str):
        user_doc["created_at"] = datetime.fromisoformat(user_doc["created_at"])
    return User(**user_doc)


def require_manager(user: User = Depends(get_current_user)) -> User:
    if user.role != "manager":
        raise HTTPException(status_code=403, detail="Manager role required")
    return user


# --------------------------------------------------------------------------- #
# Routes - root                                                               #
# --------------------------------------------------------------------------- #

@api.get("/")
async def root():
    return {"app": "Vivo Clienteling", "version": "1.0"}


@api.get("/health")
async def health():
    bi_ok = await bi_get("/locations") is not None
    return {"status": "ok", "bi_api_reachable": bi_ok, "time": iso(now_utc())}


# --------------------------------------------------------------------------- #
# Routes - auth                                                               #
# --------------------------------------------------------------------------- #

@api.post("/auth/session")
async def auth_session(request: Request, response: Response, payload: Dict[str, str] = Body(...)):
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data["email"].lower()

    user_doc = await db.users.find_one({"email": email}, {"_id": 0})
    if not user_doc:
        role = await _resolve_role(email)
        user_doc = {
            "user_id": new_id("usr_"),
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture"),
            "role": role,
            "created_at": iso(now_utc()),
        }
        await db.users.insert_one(dict(user_doc))
    else:
        # Refresh role allowlist if env changed
        if email in MANAGER_EMAILS and user_doc.get("role") != "manager":
            await db.users.update_one({"email": email}, {"$set": {"role": "manager"}})
            user_doc["role"] = "manager"

    expires = now_utc() + timedelta(days=7)
    session_token = data["session_token"]
    await db.user_sessions.insert_one({
        "user_id": user_doc["user_id"],
        "session_token": session_token,
        "expires_at": iso(expires),
        "created_at": iso(now_utc()),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 3600,
        path="/",
        httponly=True,
        secure=True,
        samesite="none",
    )
    return {
        "user": {
            "user_id": user_doc["user_id"],
            "email": user_doc["email"],
            "name": user_doc["name"],
            "picture": user_doc.get("picture"),
            "role": user_doc.get("role", "associate"),
        }
    }


@api.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return {
        "user_id": user.user_id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "role": user.role,
    }


@api.post("/auth/logout")
async def auth_logout(response: Response, session_token: Optional[str] = Cookie(default=None), authorization: Optional[str] = Header(default=None)):
    token = session_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Routes - BI proxy                                                           #
# --------------------------------------------------------------------------- #

@api.get("/bi/kpis")
async def bi_kpis(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, _: User = Depends(get_current_user)):
    return await bi_get("/kpis", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel}) or {}


@api.get("/bi/sales-summary")
async def bi_sales_summary(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, _: User = Depends(get_current_user)):
    return await bi_get("/sales-summary", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel}) or []


@api.get("/bi/country-summary")
async def bi_country(date_from: str, date_to: str, _: User = Depends(get_current_user)):
    return await bi_get("/country-summary", {"date_from": date_from, "date_to": date_to}) or []


@api.get("/bi/daily-trend")
async def bi_daily(date_from: str, date_to: str, country: Optional[str] = None, _: User = Depends(get_current_user)):
    return await bi_get("/daily-trend", {"date_from": date_from, "date_to": date_to, "country": country}) or []


async def _cache_customers(items):
    """Upsert customer profile rows seen in BI responses for fast id-lookup."""
    if not isinstance(items, list):
        return
    for c in items:
        cid = c.get("customer_id")
        if not cid:
            continue
        profile = {
            "customer_id": cid,
            "customer_name": c.get("customer_name"),
            "phone": c.get("phone"),
            "email": c.get("email"),
            "city": c.get("city"),
            "customer_country": c.get("customer_country"),
            "total_orders": c.get("total_orders"),
            "total_units": c.get("total_units"),
            "total_sales": c.get("total_sales") or c.get("lifetime_spend"),
            "avg_basket": c.get("avg_basket"),
            "last_purchase_date": c.get("last_purchase_date"),
            "first_purchase_date": c.get("first_purchase_date"),
        }
        profile["rfm_tier"] = compute_rfm_tier(profile)
        profile["cached_at"] = iso(now_utc())
        await db.customer_cache.update_one(
            {"customer_id": cid},
            {"$set": profile},
            upsert=True,
        )


def compute_rfm_tier(profile):
    """Classify a customer into a tier based on Recency, Frequency, Monetary.

    Thresholds tuned to Vivo BI data (KES). Returns one of:
    vip, loyal, promising, at_risk, churned, new
    """
    last = profile.get("last_purchase_date")
    orders = int(profile.get("total_orders") or 0)
    sales = float(profile.get("total_sales") or 0)
    if not last:
        return "new"
    try:
        last_dt = datetime.fromisoformat(str(last)[:10])
    except Exception:
        return "new"
    days = (now_utc().date() - last_dt.date()).days
    if days > 365:
        return "churned"
    if days > 180:
        return "at_risk"
    # Active (purchase within 6 months)
    if orders >= 10 and sales >= 200000:
        return "vip"
    if orders >= 5 and sales >= 50000:
        return "loyal"
    if orders >= 2:
        return "promising"
    return "new"


@api.get("/bi/top-customers")
async def bi_top_customers(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, limit: int = 20, _: User = Depends(get_current_user)):
    data = await bi_get("/top-customers", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel, "limit": limit}) or []
    await _cache_customers(data)
    if isinstance(data, list):
        for c in data:
            c["rfm_tier"] = compute_rfm_tier(c)
    return data


@api.get("/bi/customer-search")
async def bi_customer_search(q: str = Query(..., min_length=1), _: User = Depends(get_current_user)):
    data = await bi_get("/customer-search", {"q": q}) or []
    await _cache_customers(data)
    if isinstance(data, list):
        for c in data:
            c["rfm_tier"] = compute_rfm_tier(c)
    return data


@api.get("/bi/customer/{customer_id}")
async def bi_customer_profile(customer_id: str, user: User = Depends(get_current_user)):
    products = await bi_get("/customer-products", {"customer_id": customer_id}) or []
    # Profile fields don't live on /customer-products. Use the cache populated by
    # any prior /customer-search, /top-customers or /churned-customers call.
    cached = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0, "cached_at": 0})

    if not cached:
        # First-time load fallback: a wide top-customers sweep so the profile resolves.
        big = await bi_get("/top-customers", {
            "date_from": "2020-01-01",
            "date_to": now_utc().date().isoformat(),
            "limit": 2000,
        }) or []
        await _cache_customers(big)
        cached = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0, "cached_at": 0})

    profile_card = cached or {"customer_id": customer_id}
    await _audit(user, "customer.view", "customer", customer_id)
    return {"profile": profile_card, "products": products}


@api.get("/bi/customer/{customer_id}/products")
async def bi_customer_products(customer_id: str, _: User = Depends(get_current_user)):
    return await bi_get("/customer-products", {"customer_id": customer_id}) or []


@api.get("/bi/churned-customers")
async def bi_churned(days: int = 90, limit: int = 20, _: User = Depends(get_current_user)):
    data = await bi_get("/churned-customers", {"days": days, "limit": limit}) or []
    await _cache_customers(data)
    if isinstance(data, list):
        for c in data:
            c["rfm_tier"] = compute_rfm_tier(c)
    return data


@api.get("/bi/locations")
async def bi_locations(_: User = Depends(get_current_user)):
    return await bi_get("/locations") or []


@api.get("/bi/orders")
async def bi_orders(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, limit: int = 50, _: User = Depends(get_current_user)):
    return await bi_get("/orders", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel, "limit": limit}) or []


@api.get("/bi/inventory")
async def bi_inventory(location: Optional[str] = None, product: Optional[str] = None, country: Optional[str] = None, _: User = Depends(get_current_user)):
    return await bi_get("/inventory", {"location": location, "product": product, "country": country}) or []


@api.get("/bi/top-skus")
async def bi_top_skus(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, limit: int = 30, _: User = Depends(get_current_user)):
    return await bi_get("/top-skus", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel, "limit": limit}) or []


@api.get("/bi/customer-frequency")
async def bi_freq(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, _: User = Depends(get_current_user)):
    return await bi_get("/customer-frequency", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel}) or []


# --------------------------------------------------------------------------- #
# Routes - Notes                                                              #
# --------------------------------------------------------------------------- #

@api.get("/notes")
async def list_notes(customer_id: str, _: User = Depends(get_current_user)):
    docs = await db.customer_notes.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@api.post("/notes")
async def create_note(payload: NoteIn, request: Request, user: User = Depends(get_current_user)):
    doc = {
        "note_id": new_id(),
        "customer_id": payload.customer_id,
        "customer_name": payload.customer_name,
        "author_user_id": user.user_id,
        "author_name": user.name,
        "body": payload.body,
        "created_at": iso(now_utc()),
    }
    await db.customer_notes.insert_one(dict(doc))
    await _audit(user, "note.create", "customer", payload.customer_id, request)
    return doc


@api.delete("/notes/{note_id}")
async def delete_note(note_id: str, request: Request, user: User = Depends(get_current_user)):
    res = await db.customer_notes.delete_one({"note_id": note_id})
    await _audit(user, "note.delete", "note", note_id, request)
    return {"deleted": res.deleted_count}


# --------------------------------------------------------------------------- #
# Routes - Tasks                                                              #
# --------------------------------------------------------------------------- #

@api.get("/tasks")
async def list_tasks(customer_id: Optional[str] = None, mine: bool = False, user: User = Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if customer_id:
        query["customer_id"] = customer_id
    if mine:
        query["assignee_user_id"] = user.user_id
    docs = await db.customer_tasks.find(query, {"_id": 0}).sort("due_date", 1).to_list(500)
    return docs


@api.post("/tasks")
async def create_task(payload: TaskIn, request: Request, user: User = Depends(get_current_user)):
    doc = {
        "task_id": new_id(),
        "customer_id": payload.customer_id,
        "customer_name": payload.customer_name,
        "assignee_user_id": user.user_id,
        "assignee_name": user.name,
        "title": payload.title,
        "due_date": payload.due_date,
        "notes": payload.notes,
        "completed": False,
        "completed_at": None,
        "created_at": iso(now_utc()),
    }
    await db.customer_tasks.insert_one(dict(doc))
    await _audit(user, "task.create", "customer", payload.customer_id, request)
    return doc


@api.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, request: Request, user: User = Depends(get_current_user)):
    await db.customer_tasks.update_one({"task_id": task_id}, {"$set": {"completed": True, "completed_at": iso(now_utc())}})
    await _audit(user, "task.complete", "task", task_id, request)
    doc = await db.customer_tasks.find_one({"task_id": task_id}, {"_id": 0})
    return doc


@api.delete("/tasks/{task_id}")
async def delete_task(task_id: str, request: Request, user: User = Depends(get_current_user)):
    res = await db.customer_tasks.delete_one({"task_id": task_id})
    await _audit(user, "task.delete", "task", task_id, request)
    return {"deleted": res.deleted_count}


# --------------------------------------------------------------------------- #
# Routes - Preferences                                                        #
# --------------------------------------------------------------------------- #

@api.get("/preferences/{customer_id}")
async def get_prefs(customer_id: str, _: User = Depends(get_current_user)):
    doc = await db.customer_preferences.find_one({"customer_id": customer_id}, {"_id": 0})
    return doc or {"customer_id": customer_id, "sizes": {}, "fits": [], "fabrics": [], "occasions": [], "brands": []}


@api.put("/preferences/{customer_id}")
async def put_prefs(customer_id: str, payload: PreferencesIn, request: Request, user: User = Depends(get_current_user)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update.update({"customer_id": customer_id, "updated_at": iso(now_utc()), "updated_by": user.name})
    await db.customer_preferences.update_one({"customer_id": customer_id}, {"$set": update}, upsert=True)
    await _audit(user, "preferences.update", "customer", customer_id, request)
    doc = await db.customer_preferences.find_one({"customer_id": customer_id}, {"_id": 0})
    return doc


# --------------------------------------------------------------------------- #
# Routes - Templates                                                          #
# --------------------------------------------------------------------------- #

@api.get("/templates")
async def list_templates(_: User = Depends(get_current_user)):
    docs = await db.message_templates.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return docs


@api.post("/templates")
async def create_template(payload: TemplateIn, request: Request, user: User = Depends(require_manager)):
    doc = {
        "template_id": new_id("tpl_"),
        "name": payload.name,
        "channel": payload.channel,
        "body": payload.body,
        "created_by": user.name,
        "created_at": iso(now_utc()),
    }
    await db.message_templates.insert_one(dict(doc))
    await _audit(user, "template.create", "template", doc["template_id"], request)
    return doc


@api.put("/templates/{template_id}")
async def update_template(template_id: str, payload: TemplateIn, request: Request, user: User = Depends(require_manager)):
    await db.message_templates.update_one(
        {"template_id": template_id},
        {"$set": {"name": payload.name, "channel": payload.channel, "body": payload.body}},
    )
    await _audit(user, "template.update", "template", template_id, request)
    return await db.message_templates.find_one({"template_id": template_id}, {"_id": 0})


@api.delete("/templates/{template_id}")
async def delete_template(template_id: str, request: Request, user: User = Depends(require_manager)):
    res = await db.message_templates.delete_one({"template_id": template_id})
    await _audit(user, "template.delete", "template", template_id, request)
    return {"deleted": res.deleted_count}


# --------------------------------------------------------------------------- #
# Routes - Messages (mock provider)                                           #
# --------------------------------------------------------------------------- #

@api.get("/messages")
async def list_messages(customer_id: str, _: User = Depends(get_current_user)):
    docs = await db.message_logs.find({"customer_id": customer_id}, {"_id": 0}).sort("sent_at", -1).to_list(500)
    return docs


@api.post("/messages")
async def send_message(payload: MessageIn, request: Request, user: User = Depends(get_current_user)):
    # Check consent: if explicit opt-out exists, refuse.
    consent = await db.consent_records.find_one(
        {"customer_id": payload.customer_id, "channel": payload.channel},
        {"_id": 0},
        sort=[("timestamp", -1)],
    )
    if consent and consent.get("opted_in") is False:
        raise HTTPException(status_code=400, detail=f"Customer has opted out of {payload.channel}")

    body = payload.body
    if payload.placeholders:
        for key, val in payload.placeholders.items():
            body = body.replace("{" + key + "}", str(val))

    doc = {
        "message_id": new_id("msg_"),
        "customer_id": payload.customer_id,
        "customer_name": payload.customer_name,
        "customer_phone": payload.customer_phone,
        "channel": payload.channel,
        "template_id": payload.template_id,
        "template_name": payload.template_name,
        "body": body,
        "sender_user_id": user.user_id,
        "sender_name": user.name,
        "sent_at": iso(now_utc()),
        "delivery_status": "mock_delivered",
        "provider": "mock",
    }
    await db.message_logs.insert_one(dict(doc))
    await _audit(user, "message.send", "customer", payload.customer_id, request)
    return doc


# --------------------------------------------------------------------------- #
# Routes - Consent                                                            #
# --------------------------------------------------------------------------- #

@api.get("/consent/{customer_id}")
async def get_consent(customer_id: str, _: User = Depends(get_current_user)):
    docs = await db.consent_records.find({"customer_id": customer_id}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    return docs


@api.post("/consent")
async def post_consent(payload: ConsentIn, request: Request, user: User = Depends(get_current_user)):
    doc = {
        "consent_id": new_id(),
        "customer_id": payload.customer_id,
        "channel": payload.channel,
        "opted_in": payload.opted_in,
        "method": payload.method,
        "captured_by_user_id": user.user_id,
        "captured_by_name": user.name,
        "timestamp": iso(now_utc()),
    }
    await db.consent_records.insert_one(dict(doc))
    await _audit(user, "consent.update", "customer", payload.customer_id, request)
    return doc


# --------------------------------------------------------------------------- #
# Routes - Lookbooks                                                          #
# --------------------------------------------------------------------------- #

@api.post("/lookbooks")
async def create_lookbook(payload: LookbookIn, request: Request, user: User = Depends(get_current_user)):
    expires = now_utc() + timedelta(days=30)
    doc = {
        "lookbook_id": new_id("lb_"),
        "share_token": uuid.uuid4().hex,
        "customer_id": payload.customer_id,
        "customer_name": payload.customer_name,
        "associate_user_id": user.user_id,
        "associate_name": user.name,
        "title": payload.title,
        "note": payload.note,
        "items": payload.items,
        "views": 0,
        "interests": [],
        "created_at": iso(now_utc()),
        "expires_at": iso(expires),
    }
    await db.lookbooks.insert_one(dict(doc))
    await _audit(user, "lookbook.create", "customer", payload.customer_id, request)
    return doc


@api.get("/lookbooks")
async def list_lookbooks(customer_id: Optional[str] = None, _: User = Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if customer_id:
        query["customer_id"] = customer_id
    docs = await db.lookbooks.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/lookbooks/{lookbook_id}")
async def get_lookbook(lookbook_id: str, _: User = Depends(get_current_user)):
    doc = await db.lookbooks.find_one({"lookbook_id": lookbook_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


# Public (no auth) - by share token
@api.get("/public/lookbooks/{share_token}")
async def public_lookbook(share_token: str):
    doc = await db.lookbooks.find_one({"share_token": share_token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Lookbook not found or expired")
    expires = doc.get("expires_at")
    if isinstance(expires, str):
        try:
            exp_dt = datetime.fromisoformat(expires)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt < now_utc():
                raise HTTPException(status_code=410, detail="Lookbook expired")
        except ValueError:
            pass
    await db.lookbooks.update_one({"share_token": share_token}, {"$inc": {"views": 1}})
    return doc


@api.post("/public/lookbooks/{share_token}/interest")
async def public_lookbook_interest(share_token: str, payload: InterestIn):
    doc = await db.lookbooks.find_one({"share_token": share_token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Lookbook not found")
    interest = {"sku": payload.sku, "product_title": payload.product_title, "timestamp": iso(now_utc())}
    await db.lookbooks.update_one({"share_token": share_token}, {"$push": {"interests": interest}})
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Routes - Audit                                                              #
# --------------------------------------------------------------------------- #

@api.get("/audit")
async def get_audit(limit: int = 100, _: User = Depends(require_manager)):
    docs = await db.audit_log.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return docs


# --------------------------------------------------------------------------- #
# Routes - Dashboards                                                         #
# --------------------------------------------------------------------------- #

@api.get("/dashboard/me")
async def dashboard_me(user: User = Depends(get_current_user)):
    week_ago = (now_utc() - timedelta(days=7)).isoformat()
    today = now_utc().date().isoformat()
    msgs_week = await db.message_logs.count_documents({"sender_user_id": user.user_id, "sent_at": {"$gte": week_ago}})
    customers_week = await db.message_logs.distinct("customer_id", {"sender_user_id": user.user_id, "sent_at": {"$gte": week_ago}})
    tasks_open = await db.customer_tasks.find(
        {"assignee_user_id": user.user_id, "completed": False},
        {"_id": 0},
    ).sort("due_date", 1).to_list(50)
    notes_recent = await db.customer_notes.find(
        {"author_user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(10)
    overdue = [t for t in tasks_open if t.get("due_date") and t["due_date"] < today]
    return {
        "messages_this_week": msgs_week,
        "customers_contacted_this_week": len(customers_week),
        "open_tasks": len(tasks_open),
        "overdue_tasks": len(overdue),
        "tasks": tasks_open,
        "recent_notes": notes_recent,
    }


@api.get("/dashboard/manager")
async def dashboard_manager(_: User = Depends(require_manager)):
    week_ago = (now_utc() - timedelta(days=7)).isoformat()
    pipeline = [
        {"$match": {"sent_at": {"$gte": week_ago}}},
        {
            "$group": {
                "_id": {"associate": "$sender_name"},
                "messages": {"$sum": 1},
                "customers": {"$addToSet": "$customer_id"},
            }
        },
        {"$project": {"associate": "$_id.associate", "messages": 1, "customers_contacted": {"$size": "$customers"}, "_id": 0}},
        {"$sort": {"messages": -1}},
    ]
    by_associate = await db.message_logs.aggregate(pipeline).to_list(100)
    total_messages = await db.message_logs.count_documents({"sent_at": {"$gte": week_ago}})
    total_lookbooks = await db.lookbooks.count_documents({"created_at": {"$gte": week_ago}})
    open_tasks = await db.customer_tasks.count_documents({"completed": False})
    associates = await db.users.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)

    return {
        "totals": {
            "messages_week": total_messages,
            "lookbooks_week": total_lookbooks,
            "open_tasks": open_tasks,
            "associates": len(associates),
        },
        "by_associate": by_associate,
        "associates": associates,
    }


# --------------------------------------------------------------------------- #
# Bootstrap                                                                   #
# --------------------------------------------------------------------------- #

DEFAULT_TEMPLATES = [
    {
        "name": "Welcome - new visitor",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, this is {associate_name} from Vivo. Lovely to meet you today — let me know if you'd like me to set anything aside for your next visit.",
    },
    {
        "name": "New Arrival in your size",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, {associate_name} here from Vivo. We just received {item_name} in your size — would you like me to hold it for you?",
    },
    {
        "name": "Thank you - after purchase",
        "channel": "sms",
        "body": "Thank you for your purchase, {customer_name}! Reply STOP to opt out. — Vivo Fashion",
    },
    {
        "name": "Win-back - 90 days lapsed",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, we miss you at Vivo. Our new {collection} collection just landed — pop in and I'll show you the pieces I have in mind for you. — {associate_name}",
    },
]


@app.on_event("startup")
async def startup():
    if await db.message_templates.count_documents({}) == 0:
        seeded = []
        for t in DEFAULT_TEMPLATES:
            seeded.append({
                "template_id": new_id("tpl_"),
                "name": t["name"],
                "channel": t["channel"],
                "body": t["body"],
                "created_by": "system",
                "created_at": iso(now_utc()),
            })
        await db.message_templates.insert_many([dict(d) for d in seeded])
        logger.info("Seeded %d default message templates", len(seeded))

    # Best-effort weekly auto-task run (only fires on Monday + idempotent per ISO week)
    try:
        from social import maybe_run_weekly  # noqa: WPS433
        result = await maybe_run_weekly(db)
        if result.get("tasks_created"):
            logger.info("Weekly auto-tasks: created %d tasks for week %s", result["tasks_created"], result["week_start"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Weekly auto-task check failed: %s", exc)

    # Eager-warm customer cache: top customers across all time (best-effort)
    if await db.customer_cache.count_documents({}) < 100:
        try:
            today_iso = now_utc().date().isoformat()
            data = await bi_get("/top-customers", {"date_from": "2020-01-01", "date_to": today_iso, "limit": 2000}) or []
            await _cache_customers(data)
            logger.info("Eager-cached %d customer rows", len(data) if isinstance(data, list) else 0)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Customer cache warm failed: %s", exc)


@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()


# --------------------------------------------------------------------------- #
# Insights: RFM tiers, daily call list, attribution, NBA, anniversaries, DPA  #
# --------------------------------------------------------------------------- #

import json as _json
import re as _re


@api.get("/dashboard/call-list")
async def call_list(with_nba: bool = False, _: User = Depends(get_current_user)):
    """Daily action queue for an associate. Combines anniversaries, at-risk,
    silent VIPs and churned win-backs.
    
    If with_nba=true, attaches cached AI urgency/action to each row (no fresh
    LLM calls — only reads nba_cache) and re-sorts each bucket by urgency rank.
    """
    today_md = now_utc().strftime("%m-%d")
    today_iso = now_utc().date().isoformat()

    # 1. Today's shopping anniversaries (first_purchase_date MM-DD == today)
    anniversaries = await db.customer_cache.find(
        {"first_purchase_date": {"$regex": f"-{today_md}$"}},
        {"_id": 0},
    ).sort("total_sales", -1).limit(10).to_list(10)

    # 2. At-risk (lapsed 180-365d) — top by lifetime spend
    at_risk = await db.customer_cache.find(
        {"rfm_tier": "at_risk"}, {"_id": 0},
    ).sort("total_sales", -1).limit(8).to_list(8)

    # 3. VIPs not contacted in 30d
    cutoff_30 = (now_utc() - timedelta(days=30)).isoformat()
    contacted_ids = await db.message_logs.distinct("customer_id", {"sent_at": {"$gte": cutoff_30}})
    vip_silent = await db.customer_cache.find(
        {"rfm_tier": "vip", "customer_id": {"$nin": contacted_ids}}, {"_id": 0},
    ).sort("total_sales", -1).limit(8).to_list(8)

    # 4. Churned (top by lifetime — best win-back candidates)
    churned = await db.customer_cache.find(
        {"rfm_tier": "churned"}, {"_id": 0},
    ).sort("total_sales", -1).limit(6).to_list(6)

    buckets = {"anniversaries": anniversaries, "at_risk": at_risk, "vip_silent": vip_silent, "churned": churned}

    if with_nba:
        URGENCY_RANK = {"high": 0, "medium": 1, "low": 2}
        for name, rows in buckets.items():
            for row in rows:
                cache = await db.nba_cache.find_one({"customer_id": row["customer_id"]}, {"_id": 0})
                if cache and cache.get("result"):
                    r = cache["result"]
                    row["nba_action"] = r.get("action")
                    row["nba_urgency"] = r.get("urgency")
                    row["nba_why"] = r.get("why")
            rows.sort(key=lambda c: URGENCY_RANK.get(c.get("nba_urgency"), 3))

    return {
        "date": today_iso,
        "anniversaries": buckets["anniversaries"],
        "at_risk": buckets["at_risk"],
        "vip_silent": buckets["vip_silent"],
        "churned": buckets["churned"],
        "ai_enriched": with_nba,
    }


@api.post("/dashboard/call-list/precompute-nba")
async def precompute_call_list_nba(_: User = Depends(require_manager)):
    """Eagerly compute NBA for every customer surfaced on today's call list,
    so /call-list?with_nba=true is fast for associates. Use this in an
    overnight job."""
    cl = await call_list(with_nba=False)
    seen = set()
    customers = []
    for key in ("anniversaries", "at_risk", "vip_silent", "churned"):
        for c in cl.get(key, []):
            cid = c.get("customer_id")
            if cid and cid not in seen:
                seen.add(cid)
                customers.append(cid)
    n = 0
    for cid in customers:
        existing = await db.nba_cache.find_one({"customer_id": cid}, {"_id": 0})
        if existing:
            try:
                ts = datetime.fromisoformat(existing["computed_at"])
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if (now_utc() - ts).total_seconds() < 6 * 3600:
                    continue
            except Exception:
                pass
        try:
            await customer_nba(cid, user=type("U", (), {"user_id": "system", "name": "system"})())  # type: ignore[arg-type]
            n += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Precompute NBA failed for %s: %s", cid, exc)
    return {"computed": n, "of_customers": len(customers)}


# ---- Facebook Graph API sync ---- #

@api.get("/social/facebook/status")
async def facebook_status(_: User = Depends(require_manager)):
    """Tells the manager what's wired and what's still needed."""
    return {
        "app_id_configured": bool(os.environ.get("FACEBOOK_APP_ID")),
        "app_secret_configured": bool(os.environ.get("FACEBOOK_APP_SECRET")),
        "client_token_configured": bool(os.environ.get("FACEBOOK_CLIENT_TOKEN")),
        "page_id_configured": bool(os.environ.get("FACEBOOK_PAGE_ID")),
        "page_access_token_configured": bool(os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN")),
        "ready_to_sync": bool(os.environ.get("FACEBOOK_PAGE_ID") and os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN")),
        "missing": [
            *([] if os.environ.get("FACEBOOK_PAGE_ID") else ["FACEBOOK_PAGE_ID"]),
            *([] if os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN") else ["FACEBOOK_PAGE_ACCESS_TOKEN (long-lived Page Access Token from Graph API Explorer)"]),
        ],
        "instructions_url": "https://developers.facebook.com/tools/explorer/",
    }


@api.post("/social/facebook/sync")
async def facebook_sync(request: Request, payload: Optional[Dict[str, str]] = Body(default=None), user: User = Depends(require_manager)):
    """Pull Vivo Page content from Facebook into our social_posts + social_feedback
    collections. Body can override env: {page_id, page_access_token}."""
    payload = payload or {}
    page_id = payload.get("page_id") or os.environ.get("FACEBOOK_PAGE_ID", "")
    page_token = payload.get("page_access_token") or os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN", "")
    if not page_id or not page_token:
        raise HTTPException(status_code=400, detail="page_id + page_access_token required (env or body)")
    from facebook_sync import sync_facebook_page  # noqa: WPS433
    result = await sync_facebook_page(db, page_id, page_token)
    await _audit(user, "facebook.sync", "page", page_id, request)
    return result


# --------------------------------------------------------------------------- #
# Mount router + middleware                                                   #
# --------------------------------------------------------------------------- #

app.include_router(api)


@api.get("/dashboard/attribution")
async def attribution(days: int = 30, _: User = Depends(require_manager)):
    """Crude clienteling-attribution KPI: customers messaged in window who
    have a last_purchase_date >= their first_message_at[:10]. Returns
    overall + per-associate breakdown. Window granularity is daily."""
    cutoff = (now_utc() - timedelta(days=days)).isoformat()
    msgs = await db.message_logs.find({"sent_at": {"$gte": cutoff}}, {"_id": 0}).to_list(5000)

    by_customer: Dict[str, Dict[str, Any]] = {}
    for m in msgs:
        cid = m.get("customer_id")
        if not cid:
            continue
        if cid not in by_customer:
            by_customer[cid] = {"first_msg": m["sent_at"], "senders": {m.get("sender_name", "")}}
        else:
            if m["sent_at"] < by_customer[cid]["first_msg"]:
                by_customer[cid]["first_msg"] = m["sent_at"]
            by_customer[cid]["senders"].add(m.get("sender_name", ""))

    purchased: List[str] = []
    revenue = 0.0
    for cid, info in by_customer.items():
        cached = await db.customer_cache.find_one({"customer_id": cid}, {"_id": 0})
        if cached and cached.get("last_purchase_date"):
            if str(cached["last_purchase_date"])[:10] >= info["first_msg"][:10]:
                purchased.append(cid)
                revenue += float(cached.get("avg_basket") or 0)

    purchased_set = set(purchased)
    by_associate: Dict[str, Dict[str, Any]] = {}
    for m in msgs:
        sn = m.get("sender_name") or "Unknown"
        cid = m.get("customer_id")
        row = by_associate.setdefault(sn, {"associate": sn, "messages": 0, "customers": set(), "purchased": set()})
        row["messages"] += 1
        if cid:
            row["customers"].add(cid)
            if cid in purchased_set:
                row["purchased"].add(cid)

    rows = []
    for sn, data in by_associate.items():
        c_total = len(data["customers"])
        c_purchased = len(data["purchased"])
        rows.append({
            "associate": sn,
            "messages": data["messages"],
            "customers_contacted": c_total,
            "customers_purchased": c_purchased,
            "conversion_rate": round((c_purchased / c_total * 100) if c_total else 0.0, 1),
        })
    rows.sort(key=lambda r: -r["customers_purchased"])

    return {
        "window_days": days,
        "messaged_customers": len(by_customer),
        "purchased_within_window": len(purchased),
        "estimated_revenue_kes": round(revenue, 2),
        "conversion_rate": round((len(purchased) / len(by_customer) * 100) if by_customer else 0.0, 1),
        "by_associate": rows,
        "method": "Heuristic: customer counted if last_purchase_date >= date of first message in window. Treats avg_basket as the per-customer revenue contribution.",
    }


@api.get("/customers/{customer_id}/nba")
async def customer_nba(customer_id: str, user: User = Depends(get_current_user)):
    """AI Next-Best-Action for a customer (Claude Sonnet 4.5). Cached 6h."""
    cache = await db.nba_cache.find_one({"customer_id": customer_id}, {"_id": 0})
    if cache:
        try:
            ts = datetime.fromisoformat(cache["computed_at"])
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if (now_utc() - ts).total_seconds() < 6 * 3600:
                return cache["result"]
        except Exception:
            pass

    profile = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0}) or {}
    notes = await db.customer_notes.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).limit(3).to_list(3)
    msgs = await db.message_logs.find({"customer_id": customer_id}, {"_id": 0}).sort("sent_at", -1).limit(2).to_list(2)
    products = await bi_get("/customer-products", {"customer_id": customer_id}) or []
    prefs = await db.customer_preferences.find_one({"customer_id": customer_id}, {"_id": 0}) or {}

    context = {
        "name": profile.get("customer_name"),
        "tier": profile.get("rfm_tier"),
        "lifetime_spend_kes": profile.get("total_sales"),
        "last_purchase": profile.get("last_purchase_date"),
        "orders": profile.get("total_orders"),
        "city": profile.get("city"),
        "preferences": {k: prefs.get(k) for k in ["sizes", "fits", "fabrics", "occasions", "brands"] if prefs.get(k)},
        "recent_purchases": [
            {"product": p.get("style_name") or p.get("product_title"), "date": p.get("last_bought") or p.get("last_purchase_date")}
            for p in (products[:5] if isinstance(products, list) else [])
        ],
        "recent_notes": [n.get("body") for n in notes],
        "last_outreach_at": msgs[0]["sent_at"] if msgs else None,
        "today": now_utc().date().isoformat(),
    }

    sys_prompt = (
        "You are a personal stylist's assistant for Vivo Fashion (a Kenyan fashion retailer). "
        "Given customer context, output STRICT JSON only — no prose, no markdown. "
        "Schema: {\"action\": one of [\"call\",\"message\",\"wait\",\"lookbook\",\"invite\"], "
        "\"why\": \"<one short sentence justifying the action>\", "
        "\"script\": \"<one warm 1-2 sentence WhatsApp-ready opener using the customer's first name>\", "
        "\"urgency\": one of [\"high\",\"medium\",\"low\"]}."
    )

    result: Dict[str, Any] = {"action": "wait", "why": "Insufficient context", "script": "", "urgency": "low"}
    llm_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if llm_key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
            chat = LlmChat(
                api_key=llm_key,
                session_id=f"vivo-nba-{customer_id}-{int(now_utc().timestamp())}",
                system_message=sys_prompt,
            ).with_model("anthropic", "claude-sonnet-4-5-20250929")
            raw = await chat.send_message(UserMessage(text=_json.dumps(context, ensure_ascii=False)))
            text = str(raw).strip()
            m = _re.search(r"\{[\s\S]*\}", text)
            if m:
                parsed = _json.loads(m.group(0))
                if parsed.get("action") in {"call", "message", "wait", "lookbook", "invite"}:
                    result = {
                        "action": parsed["action"],
                        "why": str(parsed.get("why", ""))[:280],
                        "script": str(parsed.get("script", ""))[:400],
                        "urgency": parsed.get("urgency", "medium") if parsed.get("urgency") in {"high", "medium", "low"} else "medium",
                    }
        except Exception as exc:  # noqa: BLE001
            logger.warning("NBA LLM error for %s: %s", customer_id, exc)

    await db.nba_cache.update_one(
        {"customer_id": customer_id},
        {"$set": {"customer_id": customer_id, "result": result, "computed_at": iso(now_utc())}},
        upsert=True,
    )
    return result


@api.post("/customers/{customer_id}/forget")
async def forget_customer(customer_id: str, request: Request, user: User = Depends(require_manager)):
    """Kenya-DPA 'right to be forgotten'. Anonymizes all our records.
    BI-side data lives upstream in BigQuery and is not touched here."""
    redacted = "[redacted]"
    res = {
        "cache_deleted": (await db.customer_cache.delete_many({"customer_id": customer_id})).deleted_count,
        "preferences_deleted": (await db.customer_preferences.delete_many({"customer_id": customer_id})).deleted_count,
        "social_handles_deleted": (await db.customer_social_handles.delete_many({"customer_id": customer_id})).deleted_count,
        "nba_deleted": (await db.nba_cache.delete_many({"customer_id": customer_id})).deleted_count,
        "notes_redacted": (await db.customer_notes.update_many({"customer_id": customer_id}, {"$set": {"body": redacted, "author_name": redacted}})).modified_count,
        "tasks_redacted": (await db.customer_tasks.update_many({"customer_id": customer_id}, {"$set": {"customer_name": redacted, "title": redacted, "notes": redacted}})).modified_count,
        "messages_redacted": (await db.message_logs.update_many({"customer_id": customer_id}, {"$set": {"customer_name": redacted, "customer_phone": redacted, "body": redacted}})).modified_count,
        "lookbooks_expired": (await db.lookbooks.update_many({"customer_id": customer_id}, {"$set": {"customer_name": redacted, "expires_at": iso(now_utc())}})).modified_count,
        "consent_recorded_optout": (await db.consent_records.update_many({"customer_id": customer_id}, {"$set": {"opted_in": False}})).modified_count,
        "social_feedback_unlinked": (await db.social_feedback.update_many({"customer_id": customer_id}, {"$unset": {"customer_id": ""}})).modified_count,
    }
    await db.forget_log.insert_one({
        "forget_id": new_id(),
        "customer_id": customer_id,
        "by_user_id": user.user_id,
        "by_name": user.name,
        "at": iso(now_utc()),
        "summary": res,
    })
    await _audit(user, "customer.forget", "customer", customer_id, request)
    return {"forgotten": True, "customer_id": customer_id, "summary": res, "note": "BI-side data lives upstream in BigQuery and is not deleted by this endpoint."}


@api.post("/anniversaries/run")
async def run_anniversaries(request: Request, user: User = Depends(require_manager)):
    """Daily idempotent run: create one task per customer whose first_purchase_date MM-DD matches today."""
    today_md = now_utc().strftime("%m-%d")
    today_iso = now_utc().date().isoformat()

    existing = await db.anniversary_runs.find_one({"date": today_iso})
    if existing:
        return {"already_run": True, "date": today_iso, "tasks_created": 0}

    customers = await db.customer_cache.find(
        {"first_purchase_date": {"$regex": f"-{today_md}$"}},
        {"_id": 0},
    ).to_list(500)

    managers = await db.users.find({"role": "manager"}, {"_id": 0}).to_list(50)
    if not managers:
        return {"already_run": False, "date": today_iso, "tasks_created": 0, "note": "no managers"}

    mgr = managers[0]
    tasks_created = 0
    for c in customers:
        try:
            year_first = int(str(c.get("first_purchase_date", ""))[:4])
            years = now_utc().year - year_first
        except Exception:
            years = 0
        if years <= 0:
            continue
        spend = float(c.get("total_sales") or 0)
        title = f"{c.get('customer_name') or 'Customer'} — {years}-year shopping anniversary today"
        notes_body = (
            f"Auto-generated anniversary follow-up.\n"
            f"Lifetime spend: KES {spend:,.0f} · Tier: {c.get('rfm_tier','—')}.\n"
            f"Send a personal message celebrating {years} year{'s' if years != 1 else ''} as a Vivo customer."
        )
        await db.customer_tasks.insert_one({
            "task_id": new_id(),
            "customer_id": c["customer_id"],
            "customer_name": c.get("customer_name"),
            "assignee_user_id": mgr["user_id"],
            "assignee_name": mgr.get("name") or mgr["email"],
            "title": title,
            "due_date": today_iso,
            "notes": notes_body,
            "completed": False,
            "completed_at": None,
            "created_at": iso(now_utc()),
            "auto_generated": True,
            "auto_theme": "anniversary",
            "auto_count": years,
            "auto_week_start": today_iso,
        })
        tasks_created += 1

    await db.anniversary_runs.insert_one({
        "run_id": new_id(),
        "date": today_iso,
        "tasks_created": tasks_created,
        "ran_at": iso(now_utc()),
    })
    await _audit(user, "anniversary.run", "system", today_iso, request)
    return {"already_run": False, "date": today_iso, "tasks_created": tasks_created, "customer_count": len(customers)}


# --------------------------------------------------------------------------- #
# Mount router + middleware                                                   #
# --------------------------------------------------------------------------- #

app.include_router(api)

# Social listening + customer feedback module
from social import make_router as _social_router  # noqa: E402

_social = _social_router(get_current_user, require_manager, db, _audit)
# Mount with /api prefix
app.include_router(_social, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
