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
from fastapi import APIRouter, Body, Cookie, Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
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


# Vivo's product feed surfaces complimentary "Vivo shopping bags" lines (KES 0)
# alongside paid-for garments. They skew per-customer style insight + NBA so we
# strip them out of any product list returned by the BI proxy.
_EXCLUDED_PRODUCT_TOKENS = ("shopping bag", "shopping bags")


def _is_excluded_product(p: Dict[str, Any]) -> bool:
    if not isinstance(p, dict):
        return False
    haystack = " ".join(
        str(p.get(k) or "") for k in ("style_name", "product_title", "subcategory", "sku", "product_name")
    ).lower()
    return any(tok in haystack for tok in _EXCLUDED_PRODUCT_TOKENS)


def _filter_products(items: Any) -> Any:
    if isinstance(items, list):
        return [p for p in items if not _is_excluded_product(p)]
    return items


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
    dob: Optional[str] = None  # YYYY-MM-DD or MM-DD
    key_dates: Optional[List[Dict[str, str]]] = None  # [{label, date or date_md}]
    colour_palette: Optional[List[str]] = None  # e.g. ["mustard", "navy", "ivory"]
    style_avoids: Optional[List[str]] = None  # e.g. ["short hemlines", "polyester"]
    preferred_store: Optional[str] = None  # home branch
    preferred_channel: Optional[str] = None  # whatsapp | sms | email | in-store


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

# Email-domain allowlist for sign-in. Comma-separated env override; defaults to
# Vivo Fashion Group corporate domains.
ALLOWED_EMAIL_DOMAINS = {
    d.strip().lower()
    for d in os.environ.get("ALLOWED_EMAIL_DOMAINS", "vivofashiongroup.com,shopzetu.com").split(",")
    if d.strip()
}


def _email_domain_allowed(email: str) -> bool:
    if not ALLOWED_EMAIL_DOMAINS:
        return True  # disabled when env is explicitly empty
    return email.lower().rsplit("@", 1)[-1] in ALLOWED_EMAIL_DOMAINS


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


async def _resolve_role(email: str) -> str:  # noqa: ARG001 — email reserved for future role mapping
    # Vivo policy (Feb 2026): every authenticated user is granted manager rights.
    return "manager"


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

    # Domain allowlist — only @vivofashiongroup.com / @shopzetu.com staff can sign in.
    if not _email_domain_allowed(email):
        allowed = ", ".join(sorted(ALLOWED_EMAIL_DOMAINS))
        raise HTTPException(
            status_code=403,
            detail=f"Access restricted to Vivo Fashion Group staff. Sign in with your @{allowed.split(', ')[0]} or @{allowed.split(', ')[-1]} account.",
        )

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
        # Upgrade everyone to manager per current policy.
        if user_doc.get("role") != "manager":
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
    products = _filter_products(products)
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
    return _filter_products(await bi_get("/customer-products", {"customer_id": customer_id}) or [])


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
    return _filter_products(await bi_get("/top-skus", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel, "limit": limit}) or [])


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
    # Backfill bsp_status for legacy templates so the UI never sees undefined.
    for d in docs:
        d.setdefault("bsp_status", "draft")
    return docs


@api.put("/templates/{template_id}/bsp-status")
async def update_template_bsp_status(template_id: str, payload: Dict[str, str] = Body(...), user: User = Depends(require_manager)):
    """Flip the WhatsApp BSP approval state for a template (draft → pending → approved / rejected)."""
    status = (payload or {}).get("bsp_status", "draft")
    if status not in {"draft", "pending", "approved", "rejected"}:
        raise HTTPException(status_code=400, detail="bsp_status must be draft|pending|approved|rejected")
    res = await db.message_templates.update_one(
        {"template_id": template_id},
        {"$set": {"bsp_status": status, "bsp_status_updated_at": iso(now_utc()), "bsp_status_updated_by": user.name}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"template_id": template_id, "bsp_status": status}


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
    now_dt = now_utc()
    week_ago = (now_dt - timedelta(days=7)).isoformat()
    two_weeks_ago = (now_dt - timedelta(days=14)).isoformat()
    today_iso_str = now_dt.date().isoformat()
    msgs_week = await db.message_logs.count_documents({"sender_user_id": user.user_id, "sent_at": {"$gte": week_ago}})
    customers_week = await db.message_logs.distinct("customer_id", {"sender_user_id": user.user_id, "sent_at": {"$gte": week_ago}})
    # Prior 7d (8-14 days ago) for delta calc
    msgs_prev = await db.message_logs.count_documents({"sender_user_id": user.user_id, "sent_at": {"$gte": two_weeks_ago, "$lt": week_ago}})
    customers_prev = await db.message_logs.distinct("customer_id", {"sender_user_id": user.user_id, "sent_at": {"$gte": two_weeks_ago, "$lt": week_ago}})
    tasks_open = await db.customer_tasks.find(
        {"assignee_user_id": user.user_id, "completed": False},
        {"_id": 0},
    ).sort("due_date", 1).to_list(50)
    notes_recent = await db.customer_notes.find(
        {"author_user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(10)
    overdue = [t for t in tasks_open if t.get("due_date") and t["due_date"] < today_iso_str]

    # Daily outreach goal — per-user setting, default 5
    goal_doc = await db.outreach_goals.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    daily_goal = int(goal_doc.get("daily_goal") or 5)
    today_start = now_dt.date().isoformat()
    contacts_today = len(await db.message_logs.distinct(
        "customer_id",
        {"sender_user_id": user.user_id, "sent_at": {"$gte": today_start}},
    ))

    def _pct(cur, prev):
        if not prev:
            return None
        return round((cur - prev) / abs(prev) * 100, 1)

    return {
        "messages_this_week": msgs_week,
        "messages_prev_week": msgs_prev,
        "messages_delta_pct": _pct(msgs_week, msgs_prev),
        "customers_contacted_this_week": len(customers_week),
        "customers_contacted_prev_week": len(customers_prev),
        "customers_delta_pct": _pct(len(customers_week), len(customers_prev)),
        "open_tasks": len(tasks_open),
        "overdue_tasks": len(overdue),
        "tasks": tasks_open,
        "recent_notes": notes_recent,
        "daily_goal": daily_goal,
        "contacts_today": contacts_today,
        "goal_progress_pct": round(min(contacts_today, daily_goal) * 100.0 / daily_goal, 0) if daily_goal else 0,
    }


@api.put("/dashboard/me/goal")
async def update_outreach_goal(payload: Dict[str, int] = Body(...), user: User = Depends(get_current_user)):
    goal = max(1, min(50, int(payload.get("daily_goal", 5))))
    await db.outreach_goals.update_one(
        {"user_id": user.user_id},
        {"$set": {"user_id": user.user_id, "daily_goal": goal, "updated_at": iso(now_utc())}},
        upsert=True,
    )
    return {"daily_goal": goal}


@api.get("/dashboard/manager")
async def dashboard_manager(_: User = Depends(require_manager)):
    now_dt = now_utc()
    week_ago = (now_dt - timedelta(days=7)).isoformat()
    two_weeks_ago = (now_dt - timedelta(days=14)).isoformat()
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

    # Prior 7d for delta computation
    prev_messages = await db.message_logs.count_documents({"sent_at": {"$gte": two_weeks_ago, "$lt": week_ago}})
    prev_lookbooks = await db.lookbooks.count_documents({"created_at": {"$gte": two_weeks_ago, "$lt": week_ago}})

    def _pct(cur, prev):
        if not prev:
            return None
        return round((cur - prev) / abs(prev) * 100, 1)

    return {
        "totals": {
            "messages_week": total_messages,
            "messages_prev_week": prev_messages,
            "messages_delta_pct": _pct(total_messages, prev_messages),
            "lookbooks_week": total_lookbooks,
            "lookbooks_prev_week": prev_lookbooks,
            "lookbooks_delta_pct": _pct(total_lookbooks, prev_lookbooks),
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
    # --- English (13) ---
    {
        "name": "Welcome - new visitor",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, this is {associate_name} from Vivo. Lovely to meet you today — let me know if you'd like me to set anything aside for your next visit.",
    },
    {
        "name": "New arrival in your size",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, {associate_name} here from Vivo. We just received {item_name} in your size — would you like me to hold it for you?",
    },
    {
        "name": "Thank you - after purchase",
        "channel": "sms",
        "body": "Thank you for your purchase, {customer_name}! Reply STOP to opt out. — Vivo Fashion",
    },
    {
        "name": "Post-purchase follow-up (7 days)",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, hope you're loving the {item_name}! Any feedback on the fit or styling? I'd love to hear how it's working out. — {associate_name}, Vivo",
    },
    {
        "name": "Win-back - 90 days lapsed",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, we miss you at Vivo. Our new {collection} collection just landed — pop in and I'll show you the pieces I have in mind for you. — {associate_name}",
    },
    {
        "name": "Birthday - milestone outreach",
        "channel": "whatsapp",
        "body": "Happy birthday, {customer_name}! Wishing you a wonderful year ahead. Drop into any Vivo store this month for a little birthday treat from us. — {associate_name}",
    },
    {
        "name": "Restock alert",
        "channel": "whatsapp",
        "body": "Great news {customer_name} — {item_name} is back in stock in your size. I've held one aside for you for 48 hours, just say the word. — {associate_name}",
    },
    {
        "name": "Lookbook share",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, I put together a few pieces I think you'll love based on what you've been wearing. Take a look: {lookbook_link} — {associate_name}, Vivo",
    },
    {
        "name": "VIP exclusive preview",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, as one of our VIPs you get first look at {collection} — quietly, before it goes public. Want me to set aside your favourites? — {associate_name}",
    },
    {
        "name": "Return / exchange follow-up",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, I wanted to follow up on the return — was everything sorted to your satisfaction? Happy to help find an alternative if useful. — {associate_name}",
    },
    {
        "name": "Event invite - in-store",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, we're hosting a styling evening at {store} on {date}. Bubbly + first picks of the new collection — would love to see you there. RSVP just by replying. — {associate_name}",
    },
    {
        "name": "Tier upgrade - new VIP",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, you're officially one of our top customers this year — thank you. We've moved you into the VIP circle: priority styling, advance previews, and a little surprise on your next visit. — {associate_name}, Vivo",
    },
    {
        "name": "Referral request",
        "channel": "whatsapp",
        "body": "Hi {customer_name}, thanks again for being part of the Vivo family. If you've a friend who'd love what we do, send them our way — we'll look after them. — {associate_name}",
    },

    # --- Swahili variants for the top 5 ---
    {
        "name": "Karibu - mteja mpya (SW)",
        "channel": "whatsapp",
        "body": "Habari {customer_name}, mimi ni {associate_name} kutoka Vivo. Asante kwa kutembelea leo — nijulishe ikiwa ungependa nikuwekee chochote kabla ya ziara yako ijayo.",
    },
    {
        "name": "Bidhaa mpya kwa saizi yako (SW)",
        "channel": "whatsapp",
        "body": "Habari {customer_name}, mimi {associate_name} kutoka Vivo. Tumeingiza {item_name} katika saizi yako — ungependa nikuwekee?",
    },
    {
        "name": "Asante baada ya ununuzi (SW)",
        "channel": "sms",
        "body": "Asante kwa ununuzi wako, {customer_name}! Jibu STOP kuondoa. — Vivo Fashion",
    },
    {
        "name": "Tumekukosa - siku 90 (SW)",
        "channel": "whatsapp",
        "body": "Habari {customer_name}, tumekukosa Vivo. Mkusanyiko mpya wa {collection} umewasili — tembelea na nitakuonyesha vipande nilivyofikiria kwako. — {associate_name}",
    },
    {
        "name": "Siku ya kuzaliwa (SW)",
        "channel": "whatsapp",
        "body": "Heri ya siku ya kuzaliwa, {customer_name}! Tunakutakia mwaka mzuri sana. Tembelea Vivo wakati wa mwezi huu kwa zawadi ndogo. — {associate_name}",
    },
]


@app.on_event("startup")
async def startup():
    # Idempotent template seed — only insert names that don't yet exist.
    existing_names = set(await db.message_templates.distinct("name"))
    to_seed = [t for t in DEFAULT_TEMPLATES if t["name"] not in existing_names]
    if to_seed:
        seeded = [{
            "template_id": new_id("tpl_"),
            "name": t["name"],
            "channel": t["channel"],
            "body": t["body"],
            "created_by": "system",
            "created_at": iso(now_utc()),
        } for t in to_seed]
        await db.message_templates.insert_many([dict(d) for d in seeded])
        logger.info("Seeded %d new message templates", len(seeded))

    # One-time backfill: mark older seeded mock social items so the UI can hide them.
    try:
        r1 = await db.social_posts.update_many(
            {"post_id": {"$regex": "^post_"}, "is_mock": {"$exists": False}},
            {"$set": {"is_mock": True}},
        )
        r2 = await db.social_feedback.update_many(
            {"feedback_id": {"$regex": "^fb_[0-9]{5}$"}, "is_mock": {"$exists": False}},
            {"$set": {"is_mock": True}},
        )
        if r1.modified_count or r2.modified_count:
            logger.info("Backfilled is_mock on %d posts + %d feedback", r1.modified_count, r2.modified_count)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Mock backfill failed: %s", exc)

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

    # Background Facebook sync (every N minutes, default 15) — only starts if pages are linked.
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: WPS433
        from facebook_sync import sync_facebook_page  # noqa: WPS433
        global _fb_scheduler
        interval_min = int(os.environ.get("FACEBOOK_SYNC_INTERVAL_MIN", "15"))

        async def _job():
            pages = await db.facebook_pages.find({}, {"_id": 0}).to_list(50)
            if pages:
                for p in pages:
                    try:
                        await sync_facebook_page(db, p["page_id"], p["page_access_token"])
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Auto-sync failed for %s: %s", p.get("page_name"), exc)
                try:
                    from social import classify_pending  # noqa: WPS433
                    await classify_pending(db, limit=200)
                except Exception:  # noqa: BLE001
                    pass
            try:
                # Daily-ish moments scheduler — cheap, idempotent
                r = await _run_moments_scheduler()
                if r.get("tasks_created"):
                    logger.info("Moments scheduler created %d follow-up tasks", r["tasks_created"])
            except Exception as exc:  # noqa: BLE001
                logger.warning("Moments scheduler error: %s", exc)

        _fb_scheduler = AsyncIOScheduler(timezone="UTC")
        _fb_scheduler.add_job(_job, "interval", minutes=interval_min, id="fb_sync", next_run_time=now_utc() + timedelta(seconds=20))
        _fb_scheduler.start()
        logger.info("Facebook auto-sync scheduler started: every %d min", interval_min)
    except Exception as exc:  # noqa: BLE001
        logger.warning("FB scheduler startup failed: %s", exc)


@app.on_event("shutdown")
async def shutdown():
    try:
        sched = globals().get("_fb_scheduler")
        if sched and getattr(sched, "running", False):
            sched.shutdown(wait=False)
    except Exception:  # noqa: BLE001
        pass
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
    Triggers a background precompute when cache is missing for any surfaced row,
    so a quick poll will hydrate the badges.
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

    pending_nba: List[str] = []
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
                    row["nba_script"] = r.get("script")
                else:
                    pending_nba.append(row["customer_id"])
            rows.sort(key=lambda c: URGENCY_RANK.get(c.get("nba_urgency"), 3))

        # Fire-and-forget background precompute for missing rows (cap at 12 to
        # respect LLM budget). Subsequent polls will pick up cached results.
        if pending_nba:
            try:
                import asyncio as _asyncio
                _asyncio.create_task(_precompute_nba_for(pending_nba[:12]))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not schedule NBA precompute: %s", exc)

    return {
        "date": today_iso,
        "anniversaries": buckets["anniversaries"],
        "at_risk": buckets["at_risk"],
        "vip_silent": buckets["vip_silent"],
        "churned": buckets["churned"],
        "ai_enriched": with_nba,
        "ai_pending": len(pending_nba) if with_nba else 0,
    }


async def _precompute_nba_for(customer_ids: List[str]) -> None:
    """Compute NBA for a list of customer IDs, populating nba_cache. Best-effort."""
    sysuser = type("U", (), {"user_id": "system", "name": "system"})()  # type: ignore[arg-type]
    for cid in customer_ids:
        try:
            await customer_nba(cid, user=sysuser)
        except Exception as exc:  # noqa: BLE001
            logger.warning("NBA precompute failed for %s: %s", cid, exc)


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
    pages = await db.facebook_pages.find({}, {"_id": 0, "page_access_token": 0}).to_list(50)
    # Aggregate freshness
    last_synced_at = None
    for p in pages:
        ts = p.get("last_synced_at")
        if ts and (last_synced_at is None or ts > last_synced_at):
            last_synced_at = ts
    # Real-vs-mock counts so the UI can show "X live items / Y mock"
    real_posts = await db.social_posts.count_documents({"source": "facebook_graph"})
    real_feedback = await db.social_feedback.count_documents({"source": "facebook_graph"})
    mock_posts = await db.social_posts.count_documents({"is_mock": True})
    mock_feedback = await db.social_feedback.count_documents({"is_mock": True})
    # Scheduler status
    sched = globals().get("_fb_scheduler")
    next_run = None
    if sched and getattr(sched, "running", False):
        jobs = sched.get_jobs()
        if jobs:
            nr = jobs[0].next_run_time
            next_run = nr.isoformat() if nr else None
    return {
        "app_id_configured": bool(os.environ.get("FACEBOOK_APP_ID")),
        "app_secret_configured": bool(os.environ.get("FACEBOOK_APP_SECRET")),
        "client_token_configured": bool(os.environ.get("FACEBOOK_CLIENT_TOKEN")),
        "page_id_configured": bool(os.environ.get("FACEBOOK_PAGE_ID")) or len(pages) > 0,
        "page_access_token_configured": bool(os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN")) or len(pages) > 0,
        "discovered_pages": pages,
        "ready_to_sync": (bool(os.environ.get("FACEBOOK_PAGE_ID")) and bool(os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN"))) or len(pages) > 0,
        "missing": [
            *([] if (os.environ.get("FACEBOOK_PAGE_ID") or pages) else ["FACEBOOK_PAGE_ID (or run /api/social/facebook/discover with a User Access Token)"]),
            *([] if (os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN") or pages) else ["FACEBOOK_PAGE_ACCESS_TOKEN"]),
        ],
        "instructions_url": "https://developers.facebook.com/tools/explorer/",
        "last_synced_at": last_synced_at,
        "auto_sync_minutes": int(os.environ.get("FACEBOOK_SYNC_INTERVAL_MIN", "15")),
        "next_run_at": next_run,
        "counts": {
            "real_posts": real_posts,
            "real_feedback": real_feedback,
            "mock_posts": mock_posts,
            "mock_feedback": mock_feedback,
        },
    }


@api.post("/social/facebook/discover")
async def facebook_discover(payload: Dict[str, str] = Body(...), request: Request = None, user: User = Depends(require_manager)):
    """Discover Facebook Pages this user admins via /me/accounts.

    Body: {user_access_token}
    Get a User Access Token from https://developers.facebook.com/tools/explorer/
    with these scopes selected: pages_show_list, pages_read_engagement,
    pages_read_user_generated_content. Each returned Page comes with its own
    long-lived Page Access Token which we store and use for /sync."""
    user_token = (payload or {}).get("user_access_token", "").strip()
    if not user_token:
        raise HTTPException(status_code=400, detail="user_access_token required")

    api_version = os.environ.get("FACEBOOK_API_VERSION", "v19.0")
    url = f"https://graph.facebook.com/{api_version}/me/accounts"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(url, params={"access_token": user_token, "fields": "id,name,access_token,category,tasks", "limit": 100})
        if r.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Facebook /me/accounts failed: {r.text[:300]}")
        data = r.json()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Facebook call failed: {exc}")

    discovered = []
    for page in data.get("data", []):
        if not page.get("access_token"):
            continue  # need page-level token to read content
        doc = {
            "page_id": page["id"],
            "page_name": page.get("name"),
            "category": page.get("category"),
            "page_access_token": page["access_token"],
            "linked_by_user_id": user.user_id,
            "linked_by_name": user.name,
            "linked_at": iso(now_utc()),
        }
        await db.facebook_pages.update_one({"page_id": doc["page_id"]}, {"$set": doc}, upsert=True)
        discovered.append({k: v for k, v in doc.items() if k != "page_access_token"})

    await _audit(user, "facebook.discover", "system", str(len(discovered)), request)
    return {"discovered": len(discovered), "pages": discovered}


@api.get("/social/facebook/pages")
async def facebook_pages(_: User = Depends(require_manager)):
    """List Facebook Pages we've discovered and stored tokens for."""
    pages = await db.facebook_pages.find({}, {"_id": 0, "page_access_token": 0}).to_list(50)
    return pages


@api.delete("/social/facebook/pages/{page_id}")
async def facebook_remove_page(page_id: str, request: Request, user: User = Depends(require_manager)):
    res = await db.facebook_pages.delete_one({"page_id": page_id})
    await _audit(user, "facebook.page.remove", "page", page_id, request)
    return {"deleted": res.deleted_count}


# ---- Generic social platforms (Instagram, X, TikTok, Snapchat) ---- #

_PLATFORM_META = {
    "instagram": {
        "label": "Instagram",
        "scopes": "instagram_basic, instagram_manage_comments, instagram_manage_insights",
        "docs_url": "https://developers.facebook.com/docs/instagram-api/getting-started",
        "token_hint": "Instagram Graph API uses a Facebook Page-linked Business Account. Get a long-lived User Access Token via Graph API Explorer.",
    },
    "x": {
        "label": "X (Twitter)",
        "scopes": "tweet.read, users.read, offline.access",
        "docs_url": "https://developer.twitter.com/en/docs/authentication/oauth-2-0",
        "token_hint": "Create an X Developer app at developer.x.com and paste the OAuth 2.0 Bearer Token here.",
    },
    "tiktok": {
        "label": "TikTok",
        "scopes": "user.info.basic, video.list, comment.list",
        "docs_url": "https://developers.tiktok.com/doc/login-kit-web",
        "token_hint": "Register an app at developers.tiktok.com (TikTok for Business), then paste the long-lived access_token.",
    },
    "snapchat": {
        "label": "Snapchat",
        "scopes": "snapchat-marketing-api",
        "docs_url": "https://marketingapi.snapchat.com/docs/",
        "token_hint": "Requires Snapchat for Business access. Paste an OAuth access token from kit.snapchat.com.",
    },
}


@api.get("/social/platforms/status")
async def social_platforms_status(_: User = Depends(require_manager)):
    """Return connection state for every supported third-party social platform."""
    out = []
    for key, meta in _PLATFORM_META.items():
        stored = await db.social_platform_tokens.find_one({"platform": key}, {"_id": 0, "access_token": 0})
        out.append({
            "platform": key,
            "label": meta["label"],
            "scopes": meta["scopes"],
            "docs_url": meta["docs_url"],
            "token_hint": meta["token_hint"],
            "connected": bool(stored),
            "handle": (stored or {}).get("handle"),
            "connected_at": (stored or {}).get("connected_at"),
            "connected_by": (stored or {}).get("connected_by"),
        })
    return out


@api.post("/social/platforms/{platform}/connect")
async def social_platform_connect(platform: str, payload: Dict[str, str] = Body(...), request: Request = None, user: User = Depends(require_manager)):
    """Store access token + handle for a social platform. Used downstream by
    the sync workers we add per-platform (stubs for now — v1 stores tokens)."""
    if platform not in _PLATFORM_META:
        raise HTTPException(status_code=404, detail="Unknown platform")
    token = (payload or {}).get("access_token", "").strip()
    handle = (payload or {}).get("handle", "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="access_token required")
    doc = {
        "platform": platform,
        "access_token": token,
        "handle": handle or None,
        "connected_by": user.name,
        "connected_by_user_id": user.user_id,
        "connected_at": iso(now_utc()),
    }
    await db.social_platform_tokens.update_one({"platform": platform}, {"$set": doc}, upsert=True)
    await _audit(user, "social.platform.connect", "platform", platform, request)
    return {"connected": True, "platform": platform, "handle": handle or None}


@api.delete("/social/platforms/{platform}")
async def social_platform_disconnect(platform: str, request: Request, user: User = Depends(require_manager)):
    if platform not in _PLATFORM_META:
        raise HTTPException(status_code=404, detail="Unknown platform")
    res = await db.social_platform_tokens.delete_one({"platform": platform})
    await _audit(user, "social.platform.disconnect", "platform", platform, request)
    return {"disconnected": res.deleted_count > 0, "platform": platform}


@api.post("/social/platforms/{platform}/sync")
async def social_platform_sync(platform: str, request: Request, user: User = Depends(require_manager)):
    """V1 stub — validates the token is stored and returns a not-yet-implemented
    result. Each platform needs its own Graph/REST mapper into social_feedback
    (shipping after launch, driven by stakeholder priority)."""
    if platform not in _PLATFORM_META:
        raise HTTPException(status_code=404, detail="Unknown platform")
    stored = await db.social_platform_tokens.find_one({"platform": platform}, {"_id": 0})
    if not stored:
        raise HTTPException(status_code=400, detail=f"{platform} not connected yet — call /connect first")
    await _audit(user, "social.platform.sync", "platform", platform, request)
    return {
        "platform": platform,
        "status": "pending_implementation",
        "note": f"{_PLATFORM_META[platform]['label']} token is stored. Sync mapper lands in the next release — reach out if you'd like us to prioritise.",
        "has_token": True,
    }


@api.post("/social/facebook/sync")
async def facebook_sync(request: Request, payload: Optional[Dict[str, str]] = Body(default=None), user: User = Depends(require_manager)):
    """Pull Vivo Page content from Facebook into our social_posts + social_feedback
    collections.

    Modes:
    - body {page_id, page_access_token} → sync that page only.
    - body {page_id} only → look up the stored page token from /discover.
    - body empty/null → sync EVERY discovered page (or fall back to env vars)."""
    payload = payload or {}
    page_id = payload.get("page_id")
    page_token = payload.get("page_access_token")
    from facebook_sync import sync_facebook_page  # noqa: WPS433

    pages_to_sync: List[Dict[str, str]] = []
    if page_id and page_token:
        pages_to_sync = [{"page_id": page_id, "page_access_token": page_token}]
    elif page_id:
        stored = await db.facebook_pages.find_one({"page_id": page_id}, {"_id": 0})
        if not stored or not stored.get("page_access_token"):
            raise HTTPException(status_code=404, detail="Page token not found — run /api/social/facebook/discover first")
        pages_to_sync = [{"page_id": stored["page_id"], "page_access_token": stored["page_access_token"], "page_name": stored.get("page_name")}]
    else:
        stored_all = await db.facebook_pages.find({}, {"_id": 0}).to_list(50)
        if stored_all:
            pages_to_sync = [
                {"page_id": p["page_id"], "page_access_token": p["page_access_token"], "page_name": p.get("page_name")}
                for p in stored_all if p.get("page_access_token")
            ]
        else:
            env_id = os.environ.get("FACEBOOK_PAGE_ID", "")
            env_token = os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN", "")
            if env_id and env_token:
                pages_to_sync = [{"page_id": env_id, "page_access_token": env_token}]

    if not pages_to_sync:
        raise HTTPException(status_code=400, detail="No pages to sync. POST /api/social/facebook/discover with a user_access_token first, or set FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN in env.")

    aggregated = {"pages_synced": 0, "posts": 0, "comments": 0, "reviews": 0, "mentions": 0, "errors": [], "scopes_missing": [], "by_page": []}
    for p in pages_to_sync:
        result = await sync_facebook_page(db, p["page_id"], p["page_access_token"])
        aggregated["pages_synced"] += 1
        for key in ("posts", "comments", "reviews", "mentions"):
            aggregated[key] += result.get(key, 0)
        aggregated["errors"].extend(result.get("errors", []))
        for s in result.get("scopes_missing", []):
            if s not in aggregated["scopes_missing"]:
                aggregated["scopes_missing"].append(s)
        aggregated["by_page"].append({"page_id": p["page_id"], "page_name": p.get("page_name"), "scopes_missing": result.get("scopes_missing", []), **{k: result.get(k, 0) for k in ("posts", "comments", "reviews", "mentions")}})
        await _audit(user, "facebook.sync", "page", p["page_id"], request)

    # Fire-and-forget classifier so the new content gets sentiment quickly
    try:
        from social import classify_pending  # noqa: WPS433
        import asyncio as _asyncio
        _asyncio.create_task(classify_pending(db, limit=200))
    except Exception:  # noqa: BLE001
        pass

    return aggregated


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
    products = _filter_products(products)
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


@api.get("/customers/{customer_id}/brief")
async def customer_brief(customer_id: str, refresh: bool = False, user: User = Depends(get_current_user)):
    """AI-generated 'tell me everything I need to know about this customer in 10 seconds.'

    Pulls profile + RFM + recent purchases + notes + messages + assignment,
    sends to Claude, returns a structured executive brief. Cached 24h."""

    cached = await db.customer_brief_cache.find_one({"customer_id": customer_id}, {"_id": 0})
    if cached and not refresh:
        age = now_utc() - datetime.fromisoformat(cached["computed_at"])
        if age < timedelta(hours=24):
            return cached["result"]

    # Gather context — pull from local customer cache + BI products endpoint.
    cached = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0, "cached_at": 0})
    if not cached:
        # Warm cache on first access
        big = await bi_get("/top-customers", {
            "date_from": "2020-01-01",
            "date_to": now_utc().date().isoformat(),
            "limit": 2000,
        }) or []
        await _cache_customers(big)
        cached = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0, "cached_at": 0})
    if not cached:
        raise HTTPException(status_code=404, detail="Customer not found")
    bi = cached
    products = await bi_get("/customer-products", {"customer_id": customer_id}) or []
    products = _filter_products(products)[:20] if products else []

    notes = await db.customer_notes.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).to_list(10)
    msgs = await db.message_logs.find({"customer_id": customer_id}, {"_id": 0}).sort("sent_at", -1).to_list(10)
    tasks = await db.customer_tasks.find({"customer_id": customer_id, "completed": False}, {"_id": 0}).to_list(10)
    assignment = await db.customer_assignments.find_one({"customer_id": customer_id}, {"_id": 0}) or {}
    feedback = await db.social_feedback.find({"customer_id": customer_id, "sentiment": {"$ne": None}}, {"_id": 0}).sort("posted_at", -1).to_list(5)

    context = {
        "profile": {
            "name": bi.get("customer_name") or "Customer",
            "phone": bi.get("phone"),
            "email": bi.get("email"),
            "city": bi.get("city"),
            "rfm_tier": bi.get("rfm_tier"),
            "first_purchase_date": bi.get("first_purchase_date"),
            "last_purchase_date": bi.get("last_purchase_date"),
            "total_sales_kes": bi.get("total_sales"),
            "total_orders": bi.get("total_orders"),
            "avg_basket_kes": bi.get("avg_basket"),
            "assignee": assignment.get("assignee_name"),
        },
        "recent_purchases": [{
            "name": p.get("product_name") or p.get("name"),
            "category": p.get("category"),
            "brand": p.get("brand"),
            "date": p.get("order_date") or p.get("date"),
            "amount_kes": p.get("net_sales") or p.get("amount"),
        } for p in products[:8]],
        "recent_notes": [{"text": n.get("body", "")[:200], "at": n.get("created_at")} for n in notes[:5]],
        "recent_messages": [{"channel": m.get("channel"), "body": (m.get("body") or "")[:160], "at": m.get("sent_at")} for m in msgs[:5]],
        "open_tasks": [{"title": t.get("title") or t.get("name"), "due": t.get("due_date")} for t in tasks[:5]],
        "recent_social_feedback": [{"sentiment": f.get("sentiment"), "body": (f.get("body") or "")[:120], "platform": f.get("platform")} for f in feedback[:3]],
        "today": now_utc().date().isoformat(),
    }

    sys_prompt = (
        "You are a senior client advisor at Vivo Fashion Group, a luxury East African fashion house. "
        "You write executive briefs for store associates BEFORE they reach out to a client. "
        "Tone: warm, observant, specific. No fluff. No generic compliments. Reference real signals from the data. "
        "Output STRICT JSON only, no markdown, no preamble. Schema: { "
        "\"summary\": \"<3-4 sentences: who she is, her shopping personality, what she likely needs now>\", "
        "\"talking_points\": [<2-4 short bullets the associate can mention>], "
        "\"recommended_action\": \"<one clear action — what to do TODAY>\", "
        "\"urgency\": \"high\"|\"medium\"|\"low\", "
        "\"opener\": \"<one warm WhatsApp-ready opener using her first name, 1-2 sentences>\", "
        "\"flags\": [<optional, short list of things to be careful about (e.g. recent complaint, didn't respond last 3 msgs)>] }"
    )

    result = {
        "summary": "Insufficient data — log a few notes or purchases to enable AI briefs.",
        "talking_points": [],
        "recommended_action": "wait",
        "urgency": "low",
        "opener": "",
        "flags": [],
    }
    llm_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if llm_key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
            chat = LlmChat(
                api_key=llm_key,
                session_id=f"vivo-brief-{customer_id}-{int(now_utc().timestamp())}",
                system_message=sys_prompt,
            ).with_model("anthropic", "claude-sonnet-4-5-20250929")
            raw = await chat.send_message(UserMessage(text=_json.dumps(context, ensure_ascii=False)))
            text = str(raw).strip()
            m = _re.search(r"\{[\s\S]*\}", text)
            if m:
                parsed = _json.loads(m.group(0))
                result = {
                    "summary": str(parsed.get("summary", ""))[:600],
                    "talking_points": [str(x)[:200] for x in (parsed.get("talking_points") or [])[:5]],
                    "recommended_action": str(parsed.get("recommended_action", ""))[:200],
                    "urgency": parsed.get("urgency") if parsed.get("urgency") in {"high", "medium", "low"} else "medium",
                    "opener": str(parsed.get("opener", ""))[:400],
                    "flags": [str(x)[:160] for x in (parsed.get("flags") or [])[:4]],
                }
        except Exception as exc:  # noqa: BLE001
            logger.warning("Brief LLM error for %s: %s", customer_id, exc)

    await db.customer_brief_cache.update_one(
        {"customer_id": customer_id},
        {"$set": {"customer_id": customer_id, "result": result, "computed_at": iso(now_utc())}},
        upsert=True,
    )
    await _audit(user, "customer.brief", "customer", customer_id, None)
    return result


# ---------------------------------------------------------------------- #
#  Customer Moments — life events that auto-create follow-up tasks       #
# ---------------------------------------------------------------------- #

MOMENT_TYPES = {"birthday", "anniversary", "graduation", "wedding", "baby", "promotion", "custom"}


class MomentBody(BaseModel):
    type: str
    date: str  # YYYY-MM-DD or MM-DD for recurring annual
    title: Optional[str] = None
    recurring_annual: bool = True
    notes: Optional[str] = None
    remind_days_before: int = 7


@api.get("/customers/{customer_id}/moments")
async def list_moments(customer_id: str, _: User = Depends(get_current_user)):
    out = await db.customer_moments.find({"customer_id": customer_id}, {"_id": 0}).sort("date", 1).to_list(50)
    return out


@api.post("/customers/{customer_id}/moments")
async def add_moment(customer_id: str, body: MomentBody, user: User = Depends(get_current_user)):
    if body.type not in MOMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid type. One of: {sorted(MOMENT_TYPES)}")
    doc = {
        "moment_id": new_id("mom_"),
        "customer_id": customer_id,
        "type": body.type,
        "date": body.date,
        "title": body.title or body.type.title(),
        "recurring_annual": bool(body.recurring_annual),
        "notes": body.notes,
        "remind_days_before": max(0, min(30, int(body.remind_days_before))),
        "created_by": user.user_id,
        "created_at": iso(now_utc()),
    }
    await db.customer_moments.insert_one(dict(doc))
    await _audit(user, "moment.add", "customer", customer_id, None)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.delete("/customers/{customer_id}/moments/{moment_id}")
async def delete_moment(customer_id: str, moment_id: str, user: User = Depends(get_current_user)):
    await db.customer_moments.delete_one({"moment_id": moment_id, "customer_id": customer_id})
    await _audit(user, "moment.delete", "customer", customer_id, None)
    return {"ok": True}


async def _run_moments_scheduler() -> Dict[str, Any]:
    """Background job: every morning, scan customer_moments for upcoming events
    within `remind_days_before` and create a follow-up task per (moment, year)
    that's idempotent so re-running the job won't duplicate."""
    today_dt = now_utc().date()
    created = 0
    async for m in db.customer_moments.find({}, {"_id": 0}):
        try:
            base = datetime.strptime(m["date"][-10:] if len(m["date"]) >= 10 else m["date"], "%Y-%m-%d").date() if "-" in m["date"] else None
            if base is None:
                continue
            if m.get("recurring_annual"):
                # This year's instance of the moment
                instance = base.replace(year=today_dt.year)
                if instance < today_dt:
                    instance = instance.replace(year=today_dt.year + 1)
            else:
                instance = base
            remind_at = instance - timedelta(days=int(m.get("remind_days_before") or 7))
            if today_dt < remind_at or today_dt > instance:
                continue
            # Idempotent key per moment-year
            year_key = f"{m['moment_id']}:{instance.year}"
            existing = await db.customer_tasks.find_one({"source_moment_key": year_key}, {"_id": 0})
            if existing:
                continue
            # Find assignee
            assignment = await db.customer_assignments.find_one({"customer_id": m["customer_id"]}, {"_id": 0}) or {}
            task = {
                "task_id": new_id("tsk_"),
                "customer_id": m["customer_id"],
                "title": f"{m.get('title') or m['type'].title()} reminder ({(instance - today_dt).days}d away)",
                "due_date": instance.isoformat(),
                "completed": False,
                "source": "moment",
                "source_moment_key": year_key,
                "assignee_user_id": assignment.get("assignee_user_id"),
                "assignee_name": assignment.get("assignee_name"),
                "created_at": iso(now_utc()),
            }
            await db.customer_tasks.insert_one(dict(task))
            created += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("moment scheduler error for %s: %s", m.get("moment_id"), exc)
    return {"tasks_created": created}


# ---------------------------------------------------------------------- #
#  WhatsApp Co-pilot — AI drafts an outbound message for any intent      #
# ---------------------------------------------------------------------- #

class DraftMessageBody(BaseModel):
    intent: str = "checkin"  # checkin | winback | birthday | new_arrivals | thank_you | custom
    custom_prompt: Optional[str] = None
    tone: str = "warm"  # warm | concise | playful | formal


@api.post("/customers/{customer_id}/draft-message")
async def draft_message(customer_id: str, body: DraftMessageBody, user: User = Depends(get_current_user)):
    cached = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0, "cached_at": 0})
    if not cached:
        raise HTTPException(status_code=404, detail="Customer not found")
    notes = await db.customer_notes.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).to_list(5)
    last_msgs = await db.message_logs.find({"customer_id": customer_id}, {"_id": 0}).sort("sent_at", -1).to_list(3)
    products = (await bi_get("/customer-products", {"customer_id": customer_id}) or [])[:5]

    intent_prompts = {
        "checkin": "Casual warm check-in. Not pushy. Reference something specific from her history if possible.",
        "winback": "She hasn't shopped in a while. Express genuine warmth. Don't be salesy. Hint at something new she'd love.",
        "birthday": "It's her birthday or near it. Celebrate her. Mention a small gift/perk if appropriate.",
        "new_arrivals": "Tell her about new pieces that fit her style based on her purchase history.",
        "thank_you": "Thank her for a recent purchase. Reference the specific items.",
        "custom": f"Follow this brief from the associate: {body.custom_prompt or 'be warm and helpful'}",
    }
    intent_text = intent_prompts.get(body.intent, intent_prompts["checkin"])

    sys = (
        f"You are a senior stylist at Vivo Fashion Group (East Africa luxury fashion). "
        f"You write WhatsApp messages to clients on behalf of {user.name}. "
        f"Tone: {body.tone}. Use the client's first name. Keep it 2-4 sentences. "
        f"NO emojis unless asked. NO generic 'how are you' fluff. NO hashtags. "
        f"Reference real details from her data when relevant. End with a soft open-ended question. "
        "Output STRICT JSON only: {\"variants\": [{\"label\": \"<short label>\", \"text\": \"<the message>\"}, ...]} "
        "Always return exactly 3 variants with different angles."
    )

    payload = {
        "intent": body.intent,
        "intent_brief": intent_text,
        "from_associate": user.name,
        "profile": {
            "first_name": (cached.get("customer_name") or "").split(" ")[0] or "there",
            "full_name": cached.get("customer_name"),
            "city": cached.get("city"),
            "rfm_tier": cached.get("rfm_tier"),
            "last_purchase_date": cached.get("last_purchase_date"),
            "total_orders": cached.get("total_orders"),
        },
        "recent_purchases": [{
            "name": p.get("product_name") or p.get("name"),
            "brand": p.get("brand"),
            "category": p.get("category"),
            "date": p.get("order_date") or p.get("date"),
        } for p in products],
        "recent_notes": [n.get("body", "")[:160] for n in notes],
        "recent_messages_we_sent": [m.get("body", "")[:120] for m in last_msgs],
    }

    variants = [{"label": "Default", "text": f"Hi {payload['profile']['first_name']}, hope you're doing well — let me know if you'd like help with anything new from Vivo."}]
    llm_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if llm_key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
            chat = LlmChat(
                api_key=llm_key,
                session_id=f"vivo-draft-{customer_id}-{int(now_utc().timestamp())}",
                system_message=sys,
            ).with_model("anthropic", "claude-sonnet-4-5-20250929")
            raw = await chat.send_message(UserMessage(text=_json.dumps(payload, ensure_ascii=False)))
            m = _re.search(r"\{[\s\S]*\}", str(raw))
            if m:
                parsed = _json.loads(m.group(0))
                if isinstance(parsed.get("variants"), list) and parsed["variants"]:
                    variants = [{"label": str(v.get("label", "Variant"))[:40], "text": str(v.get("text", ""))[:500]} for v in parsed["variants"][:3]]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Draft LLM error for %s: %s", customer_id, exc)

    await _audit(user, "message.draft", "customer", customer_id, None)
    return {"variants": variants, "intent": body.intent, "tone": body.tone}


# ---------------------------------------------------------------------- #
#  Voice Notes — Whisper transcription + Claude tag extraction           #
# ---------------------------------------------------------------------- #

@api.post("/customers/{customer_id}/voice-note")
async def voice_note(customer_id: str, audio: UploadFile = File(...), user: User = Depends(get_current_user)):
    """Accept an audio recording, transcribe via Whisper, extract structured tags
    via Claude, and save as a customer note. Returns transcript + tags."""
    if audio.content_type not in {"audio/webm", "audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/m4a", "audio/mp4", "audio/ogg", "audio/x-m4a"}:
        # Allow it through — browser content-types vary
        logger.info("voice-note content-type: %s", audio.content_type)

    llm_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not llm_key:
        raise HTTPException(status_code=503, detail="EMERGENT_LLM_KEY not configured")

    # Save to temp file (Whisper expects a file-like)
    import tempfile
    suffix = ".webm"
    if audio.filename:
        for ext in (".mp3", ".m4a", ".wav", ".webm", ".mp4", ".ogg"):
            if audio.filename.lower().endswith(ext):
                suffix = ext
                break
    raw = await audio.read()
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit")
    transcript = ""
    try:
        from emergentintegrations.llm.openai import OpenAISpeechToText  # type: ignore
        stt = OpenAISpeechToText(api_key=llm_key)
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
            tf.write(raw)
            tf.flush()
            with open(tf.name, "rb") as fh:
                resp = await stt.transcribe(file=fh, model="whisper-1", response_format="json")
            transcript = (getattr(resp, "text", "") or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Whisper transcription failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

    # Extract structured tags from transcript via Claude
    tags = {"interests": [], "size_notes": [], "sentiment": "neutral", "follow_up": None}
    if transcript:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
            sys = (
                "Extract structured shopping/styling signals from a store associate's voice memo about a client. "
                "Output STRICT JSON: {\"interests\": [<short product types/categories>], "
                "\"size_notes\": [<sizing/fit observations>], "
                "\"sentiment\": \"positive|neutral|negative\", "
                "\"follow_up\": \"<short action the associate should do, or null>\"}"
            )
            chat = LlmChat(api_key=llm_key, session_id=f"vivo-vn-{customer_id}-{int(now_utc().timestamp())}", system_message=sys
            ).with_model("anthropic", "claude-sonnet-4-5-20250929")
            r = await chat.send_message(UserMessage(text=transcript))
            m = _re.search(r"\{[\s\S]*\}", str(r))
            if m:
                p = _json.loads(m.group(0))
                tags = {
                    "interests": [str(x)[:80] for x in (p.get("interests") or [])[:6]],
                    "size_notes": [str(x)[:80] for x in (p.get("size_notes") or [])[:4]],
                    "sentiment": p.get("sentiment") if p.get("sentiment") in {"positive", "neutral", "negative"} else "neutral",
                    "follow_up": (str(p["follow_up"])[:200] if p.get("follow_up") else None),
                }
        except Exception as exc:  # noqa: BLE001
            logger.warning("Voice-note tagging failed: %s", exc)

    # Persist as a customer note + return
    note = {
        "note_id": new_id("note_"),
        "customer_id": customer_id,
        "body": transcript,
        "source": "voice",
        "tags": tags,
        "author_user_id": user.user_id,
        "author_name": user.name,
        "created_at": iso(now_utc()),
    }
    await db.customer_notes.insert_one(dict(note))
    await _audit(user, "voice_note.add", "customer", customer_id, None)
    return {k: v for k, v in note.items() if k != "_id"}


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
# v2 — Vivo CRM Dev Feedback responses                                        #
# --------------------------------------------------------------------------- #


@api.get("/customers/{customer_id}/timeline")
async def customer_timeline(customer_id: str, _: User = Depends(get_current_user)):
    """Unified chronological feed across purchases, messages, notes, tasks and
    social mentions for one customer. Newest first."""
    events: List[Dict[str, Any]] = []

    products = await bi_get("/customer-products", {"customer_id": customer_id}) or []
    products = _filter_products(products)
    for p in products:
        if p.get("last_bought"):
            events.append({
                "kind": "purchase",
                "ts": str(p["last_bought"]),
                "label": p.get("style_name") or p.get("product_title") or "Purchase",
                "detail": f"KES {int(p.get('total_spend') or 0):,} · {p.get('units_bought') or 1} unit(s)",
                "amount_kes": float(p.get("total_spend") or 0),
            })

    for m in await db.message_logs.find({"customer_id": customer_id}, {"_id": 0}).to_list(500):
        events.append({
            "kind": "message",
            "ts": m.get("sent_at"),
            "label": f"{(m.get('channel') or 'whatsapp').title()} · by {m.get('sender_name')}",
            "detail": (m.get("body") or "")[:180],
        })

    for n in await db.customer_notes.find({"customer_id": customer_id}, {"_id": 0}).to_list(500):
        events.append({
            "kind": "note",
            "ts": n.get("created_at"),
            "label": f"Note · {n.get('author_name')}",
            "detail": (n.get("body") or "")[:300],
        })

    for t in await db.customer_tasks.find({"customer_id": customer_id}, {"_id": 0}).to_list(500):
        events.append({
            "kind": "task",
            "ts": t.get("created_at"),
            "label": f"Follow-up: {t.get('title')}" + (" · ✓ done" if t.get("completed") else ""),
            "detail": (t.get("notes") or "") + (f" · due {t['due_date']}" if t.get("due_date") else ""),
        })

    for s in await db.social_feedback.find({"customer_id": customer_id}, {"_id": 0}).to_list(200):
        events.append({
            "kind": "social",
            "ts": s.get("posted_at"),
            "label": f"{(s.get('platform') or 'social').title()} · {s.get('sentiment') or 'neutral'}",
            "detail": (s.get("body") or "")[:300],
        })

    events.sort(key=lambda e: str(e.get("ts") or ""), reverse=True)
    return {"customer_id": customer_id, "events": events[:200]}


@api.get("/customers/{customer_id}/churn-reasoning")
async def churn_reasoning(customer_id: str, _: User = Depends(get_current_user)):
    """Plain-English reasoning behind the AI risk priority for one customer."""
    cached = await db.customer_cache.find_one({"customer_id": customer_id}, {"_id": 0})
    if not cached:
        raise HTTPException(status_code=404, detail="Customer not found")

    def _parse(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(str(s)[:10])
        except Exception:
            return None

    first = _parse(cached.get("first_purchase_date"))
    last = _parse(cached.get("last_purchase_date"))
    orders = int(cached.get("total_orders") or 0)
    tier = cached.get("rfm_tier") or "new"
    now_dt = now_utc().replace(tzinfo=None)

    days_since_last = (now_dt - last).days if last else None
    avg_cadence = None
    if first and last and orders >= 2:
        avg_cadence = max(1, (last - first).days) / max(1, orders - 1)

    score = 0.0
    reasons: List[str] = []
    if days_since_last is not None and days_since_last > 365:
        score += 60
        reasons.append(f"{days_since_last} days since last purchase")
    elif days_since_last is not None and days_since_last > 180:
        score += 40
        reasons.append(f"{days_since_last} days since last purchase")
    elif avg_cadence and days_since_last and days_since_last > avg_cadence * 1.5:
        score += 30
        reasons.append(f"{days_since_last}d since last, vs. typical {avg_cadence:.0f}d cadence")
    if tier in ("at_risk", "churned"):
        score += 20
        reasons.append(f"RFM tier currently {tier.replace('_', ' ')}")
    if orders == 1 and days_since_last and days_since_last > 60:
        score += 15
        reasons.append("never placed a 2nd order")
    contacted_30 = await db.message_logs.count_documents({
        "customer_id": customer_id,
        "sent_at": {"$gte": (now_utc() - timedelta(days=30)).isoformat()},
    })
    if contacted_30 == 0:
        score += 10
        reasons.append("no outreach in the last 30 days")

    score = max(0.0, min(100.0, score))
    band = "high" if score >= 60 else "medium" if score >= 30 else "low"
    return {
        "customer_id": customer_id,
        "risk_score": round(score, 1),
        "risk_band": band,
        "reasons": reasons,
        "days_since_last_purchase": days_since_last,
        "avg_cadence_days": round(avg_cadence, 0) if avg_cadence else None,
        "rfm_tier": tier,
    }


def _slim_customer(r: Dict[str, Any]) -> Dict[str, Any]:
    return {k: r.get(k) for k in ("customer_id", "customer_name", "city", "rfm_tier", "total_sales", "total_orders", "last_purchase_date")}


@api.get("/customers/duplicates")
async def find_duplicates(_: User = Depends(require_manager)):
    """Likely duplicate customers (same phone, or same normalised name)."""
    rows = await db.customer_cache.find({}, {"_id": 0}).to_list(50000)
    by_phone: Dict[str, List[Dict[str, Any]]] = {}
    by_name: Dict[str, List[Dict[str, Any]]] = {}

    for r in rows:
        ph_digits = "".join(c for c in str(r.get("phone") or r.get("phone_number") or "") if c.isdigit())
        ph = ph_digits[-9:] if len(ph_digits) >= 9 else ""
        if ph:
            by_phone.setdefault(ph, []).append(r)
        nm = " ".join((str(r.get("customer_name") or "")).lower().split())
        if nm and len(nm) > 4:
            by_name.setdefault(nm, []).append(r)

    groups: List[Dict[str, Any]] = []
    seen_pairs: set = set()
    for ph, lst in by_phone.items():
        if len(lst) < 2:
            continue
        key = tuple(sorted(r.get("customer_id") for r in lst))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        groups.append({"match_on": "phone", "value": ph, "customers": [_slim_customer(r) for r in lst]})
    for nm, lst in by_name.items():
        if len(lst) < 2:
            continue
        key = tuple(sorted(r.get("customer_id") for r in lst))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        groups.append({"match_on": "name", "value": nm.title(), "customers": [_slim_customer(r) for r in lst]})

    groups.sort(key=lambda g: -len(g["customers"]))
    return {"groups": groups[:100], "potential_duplicates": sum(len(g["customers"]) for g in groups)}


@api.get("/bi/upt")
async def bi_upt(date_from: str, date_to: str, country: Optional[str] = None, channel: Optional[str] = None, _: User = Depends(require_manager)):
    """Units per transaction across BI /orders."""
    orders = await bi_get("/orders", {"date_from": date_from, "date_to": date_to, "country": country, "channel": channel, "limit": 10000}) or []
    if not isinstance(orders, list) or not orders:
        return {"upt": 0, "total_orders": 0, "total_units": 0}
    total_units = sum(int(o.get("units") or o.get("quantity") or 1) for o in orders)
    total_orders = len(orders)
    return {"upt": round(total_units / total_orders, 2) if total_orders else 0, "total_orders": total_orders, "total_units": total_units}


@api.get("/bi/return-rate-trend")
async def bi_return_rate_trend(_: User = Depends(require_manager)):
    """Return-rate buckets at 7d / 30d / 90d windows."""
    today = now_utc().date()
    out = []
    for label, days in (("7d", 7), ("30d", 30), ("90d", 90)):
        dfrom = (today - timedelta(days=days)).isoformat()
        kpi = await bi_get("/kpis", {"date_from": dfrom, "date_to": today.isoformat()}) or {}
        out.append({
            "window": label,
            "return_rate_pct": float(kpi.get("return_rate") or kpi.get("return_rate_pct") or 0),
            "returns": int(kpi.get("returns") or 0),
            "orders": int(kpi.get("total_orders") or 0),
        })
    return {"windows": out}


@api.get("/bi/channel-attribution")
async def bi_channel_attribution(days: int = 90, _: User = Depends(require_manager)):
    """Acquisition-channel breakdown for first orders in the window."""
    date_from = (now_utc().date() - timedelta(days=days)).isoformat()
    orders = await bi_get("/orders", {"date_from": date_from, "date_to": now_utc().date().isoformat(), "limit": 5000}) or []
    if not isinstance(orders, list):
        orders = []
    first_orders: Dict[str, Dict[str, Any]] = {}
    for o in orders:
        cid = o.get("customer_id")
        if not cid:
            continue
        existing = first_orders.get(cid)
        if not existing or str(o.get("order_date") or "") < str(existing.get("order_date") or ""):
            first_orders[cid] = o
    from collections import defaultdict as _dd
    by_channel: Dict[str, Dict[str, Any]] = _dd(lambda: {"customers": 0, "revenue_kes": 0.0})
    for o in first_orders.values():
        ch = (o.get("channel") or o.get("source") or o.get("sales_channel") or "Unspecified")
        by_channel[ch]["customers"] += 1
        by_channel[ch]["revenue_kes"] += float(o.get("net") or o.get("total") or 0)
    rows = sorted(
        [{"channel": k, **v, "revenue_kes": round(v["revenue_kes"], 0)} for k, v in by_channel.items()],
        key=lambda r: -r["customers"],
    )
    return {"window_days": days, "rows": rows, "total_new_customers": len(first_orders)}


@api.get("/templates/performance")
async def template_performance(_: User = Depends(require_manager)):
    """Per-template sent count + crude response rate (purchase within window after send)."""
    tpls = await db.message_templates.find({}, {"_id": 0}).to_list(200)
    if not tpls:
        return {"templates": []}
    cutoff_30d = (now_utc() - timedelta(days=30)).isoformat()
    out = []
    for tpl in tpls:
        sent = await db.message_logs.find(
            {"template_id": tpl.get("template_id"), "sent_at": {"$gte": cutoff_30d}},
            {"_id": 0, "customer_id": 1, "sent_at": 1},
        ).to_list(500)
        responded = 0
        for s in sent:
            cached = await db.customer_cache.find_one({"customer_id": s.get("customer_id")}, {"_id": 0, "last_purchase_date": 1})
            if cached and cached.get("last_purchase_date") and str(cached["last_purchase_date"])[:10] >= str(s.get("sent_at"))[:10]:
                responded += 1
        out.append({
            "template_id": tpl.get("template_id"),
            "name": tpl.get("name"),
            "channel": tpl.get("channel"),
            "sent_30d": len(sent),
            "response_30d": responded,
            "response_rate_pct": round(responded * 100.0 / len(sent), 1) if sent else 0.0,
        })
    out.sort(key=lambda r: -r["sent_30d"])
    return {"templates": out}


@api.post("/dropoff/winback-bulk")
async def dropoff_winback_bulk(payload: Dict[str, Any] = Body(...), request: Request = None, user: User = Depends(require_manager)):
    """Create personalised win-back follow-ups for HIGH-risk new customers."""
    band = (payload.get("band") or "high").lower()
    limit = int(payload.get("limit") or 25)
    template_id = payload.get("template_id")
    days = int(payload.get("days") or 90)
    cutoff = (now_utc() - timedelta(days=days)).isoformat()
    new_rows = await db.customer_cache.find({"first_purchase_date": {"$gte": cutoff}}, {"_id": 0}).to_list(10000)

    tpl_body = ""
    if template_id:
        tpl = await db.message_templates.find_one({"template_id": template_id}, {"_id": 0})
        if tpl:
            tpl_body = tpl.get("body") or ""
    if not tpl_body:
        tpl_body = "Hi {customer_name}, missed seeing you at Vivo. I've some pieces I think you'd love — pop in this week and I'll set them aside. — {associate_name}"

    created = 0
    for r in new_rows[:limit]:
        body = tpl_body.format(
            customer_name=(r.get("customer_name") or "there").split()[0],
            associate_name=user.name or "Vivo",
            item_name="our new pieces",
            collection="latest",
            store=r.get("city") or "Vivo",
            lookbook_link="",
            date="",
        )
        await db.customer_tasks.insert_one({
            "task_id": new_id(),
            "customer_id": r.get("customer_id"),
            "customer_name": r.get("customer_name"),
            "assignee_user_id": user.user_id,
            "assignee_name": user.name,
            "title": f"Win-back outreach ({band})",
            "notes": f"AI-suggested win-back. Draft script:\n\n{body}",
            "due_date": (now_utc().date() + timedelta(days=2)).isoformat(),
            "completed": False,
            "completed_at": None,
            "created_at": iso(now_utc()),
            "auto_generated": True,
            "auto_theme": "winback_bulk",
        })
        created += 1
    await _audit(user, "winback.bulk", "band", band, request)
    return {"created": created, "band": band}


# --------------------------------------------------------------------------- #
# Customer ↔ associate assignment                                             #
# --------------------------------------------------------------------------- #


@api.get("/users")
async def list_users(_: User = Depends(get_current_user)):
    """Lightweight roster for assignment dropdowns. Email/picture excluded."""
    docs = await db.users.find({}, {"_id": 0, "user_id": 1, "name": 1, "role": 1}).sort("name", 1).to_list(200)
    return docs


@api.get("/customers/{customer_id}/assignment")
async def get_assignment(customer_id: str, _: User = Depends(get_current_user)):
    doc = await db.customer_assignments.find_one({"customer_id": customer_id}, {"_id": 0})
    return doc or {"customer_id": customer_id, "assignee_user_id": None, "assignee_name": None}


@api.put("/customers/{customer_id}/assignment")
async def set_assignment(customer_id: str, payload: Dict[str, Optional[str]] = Body(...), request: Request = None, user: User = Depends(get_current_user)):
    """Anyone can claim an unassigned customer. Reassigning requires manager."""
    new_user_id = payload.get("assignee_user_id") or None
    new_name = payload.get("assignee_name") or None
    existing = await db.customer_assignments.find_one({"customer_id": customer_id}, {"_id": 0})
    if existing and existing.get("assignee_user_id") and existing["assignee_user_id"] != user.user_id and user.role != "manager":
        raise HTTPException(status_code=403, detail="Only the assigned associate or a manager can reassign.")

    if new_user_id:
        # Resolve name from users collection if not given
        if not new_name:
            u = await db.users.find_one({"user_id": new_user_id}, {"_id": 0, "name": 1})
            new_name = (u or {}).get("name") or new_user_id
        doc = {
            "customer_id": customer_id,
            "assignee_user_id": new_user_id,
            "assignee_name": new_name,
            "assigned_at": iso(now_utc()),
            "assigned_by": user.name,
        }
        await db.customer_assignments.update_one({"customer_id": customer_id}, {"$set": doc}, upsert=True)
        await _audit(user, "customer.assign", "customer", customer_id, request)
        return doc
    else:
        await db.customer_assignments.delete_one({"customer_id": customer_id})
        await _audit(user, "customer.unassign", "customer", customer_id, request)
        return {"customer_id": customer_id, "assignee_user_id": None, "assignee_name": None}


@api.get("/my-customers")
async def my_customers(user: User = Depends(get_current_user)):
    """Customers assigned to the current user, enriched with cache data."""
    rows = await db.customer_assignments.find({"assignee_user_id": user.user_id}, {"_id": 0}).to_list(2000)
    customer_ids = [r["customer_id"] for r in rows]
    if not customer_ids:
        return []
    cached = await db.customer_cache.find({"customer_id": {"$in": customer_ids}}, {"_id": 0}).to_list(2000)
    by_id = {c["customer_id"]: c for c in cached}
    out = []
    for r in rows:
        c = by_id.get(r["customer_id"], {})
        out.append({
            **c,
            "assigned_at": r.get("assigned_at"),
            "assigned_by": r.get("assigned_by"),
        })
    return out


# --------------------------------------------------------------------------- #
# Mount router + middleware                                                   #
# --------------------------------------------------------------------------- #

app.include_router(api)

# Social listening + customer feedback module
from social import make_router as _social_router  # noqa: E402

_social = _social_router(get_current_user, require_manager, db, _audit)
app.include_router(_social, prefix="/api")

# Insights: cohorts, LTV forecast, reorder, lookalikes, life-events, daily brief,
# walk-ins, wishlist, suggest-reply, leaderboard.
from insights import make_router as _insights_router  # noqa: E402

_insights = _insights_router(get_current_user, require_manager, db, _audit, bi_get)
app.include_router(_insights, prefix="/api")

# Training analytics — proxy to external vivo-training-api with -3h timezone fix.
from training import make_router as _training_router  # noqa: E402

_training = _training_router(require_manager)
app.include_router(_training, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
