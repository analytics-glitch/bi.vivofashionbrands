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


@api.get("/bi/top-customers")
async def bi_top_customers(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, limit: int = 20, _: User = Depends(get_current_user)):
    return await bi_get("/top-customers", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel, "limit": limit}) or []


@api.get("/bi/customer-search")
async def bi_customer_search(q: str = Query(..., min_length=1), _: User = Depends(get_current_user)):
    return await bi_get("/customer-search", {"q": q}) or []


@api.get("/bi/customer/{customer_id}")
async def bi_customer_profile(customer_id: str, user: User = Depends(get_current_user)):
    products = await bi_get("/customer-products", {"customer_id": customer_id}) or []
    profile_card = None
    if isinstance(products, list) and products:
        first = products[0]
        profile_card = {
            "customer_id": first.get("customer_id", customer_id),
            "customer_name": first.get("customer_name"),
            "phone": first.get("phone"),
            "email": first.get("email"),
            "city": first.get("city"),
            "customer_country": first.get("customer_country"),
            "total_orders": first.get("total_orders"),
            "total_units": first.get("total_units"),
            "total_sales": first.get("total_sales"),
            "avg_basket": first.get("avg_basket"),
            "last_purchase_date": first.get("last_purchase_date"),
            "first_purchase_date": first.get("first_purchase_date"),
        }
    await _audit(user, "customer.view", "customer", customer_id)
    return {"profile": profile_card, "products": products}


@api.get("/bi/customer/{customer_id}/products")
async def bi_customer_products(customer_id: str, _: User = Depends(get_current_user)):
    return await bi_get("/customer-products", {"customer_id": customer_id}) or []


@api.get("/bi/churned-customers")
async def bi_churned(days: int = 90, limit: int = 20, _: User = Depends(get_current_user)):
    return await bi_get("/churned-customers", {"days": days, "limit": limit}) or []


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


@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()


# --------------------------------------------------------------------------- #
# Mount router + middleware                                                   #
# --------------------------------------------------------------------------- #

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
