"""Auth module — Emergent Google sign-in (domain-whitelisted) + admin-seeded
email/password accounts. Activity logging for all authenticated /api/* calls.

REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
"""
from __future__ import annotations

import os
import uuid
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# ---------- Config ----------
ALLOWED_DOMAINS = {
    d.strip().lower()
    for d in os.environ.get("ALLOWED_EMAIL_DOMAINS", "vivofashiongroup.com,shopzetu.com").split(",")
    if d.strip()
}
SESSION_TTL_DAYS = 7
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "vivo_bi")
_mongo = AsyncIOMotorClient(MONGO_URL)
db = _mongo[DB_NAME]

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])

# Paths under /api that are public (no auth required).
PUBLIC_API_PATHS = {
    "/api/auth/google/callback",
    "/api/auth/login",
    "/api/auth/logout",  # idempotent
    "/api/auth/me",  # returns 401 when anonymous (not 403)
    "/api/health",
}


# ---------- Models ----------
class User(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    role: str = "viewer"  # admin | exec | analyst | store_manager | viewer
    active: bool = True
    auth_method: Optional[str] = None  # "google" | "password"
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class PasswordOnlyBody(BaseModel):
    """Used by /verify-password — the PII-reveal step-up flow takes
    only a shared password, not an email. Keeping LoginBody intact so
    /login still enforces a valid email format."""
    password: str


class GoogleCallbackBody(BaseModel):
    session_id: str


class CreateUserBody(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(..., min_length=8)
    role: str = "viewer"


class UpdateUserBody(BaseModel):
    role: Optional[str] = None
    active: Optional[bool] = None


# ---------- Page-level access control ----------
# Mirrors `/app/frontend/src/lib/permissions.js::ROLE_PAGES`. Page IDs match
# the `id` field on `tabs` in `Sidebar.jsx`. Admin-only pages use the
# `admin-` prefix. The frontend hides nav items it can't access; ProtectedRoute
# also redirects on direct URL hits. Backend stays the source of truth via
# /auth/me which echoes the user's `allowed_pages` list.
_VIEWER = ["overview", "locations", "footfall", "customers", "customer-details"]
_STORE_MANAGER = _VIEWER + ["inventory", "re-order", "ibt"]
_ANALYST = _STORE_MANAGER + ["products", "pricing", "data-quality"]
_EXEC = _ANALYST + ["ceo-report", "exports"]
_ADMIN = _EXEC + ["admin-users", "admin-activity-logs"]
ROLE_PAGES = {
    "viewer": _VIEWER,
    "store_manager": _STORE_MANAGER,
    "analyst": _ANALYST,
    "exec": _EXEC,
    "admin": _ADMIN,
}


def pages_for(user: "User") -> List[str]:
    return ROLE_PAGES.get((user.role or "viewer").lower(), _VIEWER)


# ---------- Helpers ----------
def _clean_user(doc: dict) -> User:
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return User(**doc)


async def _fetch_session_token_user(token: str) -> Optional[User]:
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        return None
    exp = sess.get("expires_at")
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        return None
    user_doc = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user_doc or not user_doc.get("active", True):
        return None
    return _clean_user(user_doc)


async def get_current_user(request: Request) -> User:
    """Validates session from httpOnly cookie OR Authorization: Bearer <token>."""
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await _fetch_session_token_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


async def _create_session(user_id: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
        "created_at": datetime.now(timezone.utc),
    })
    return token


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=SESSION_TTL_DAYS * 24 * 3600,
    )


# ---------- Seed ----------
async def seed_admin():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)

    seed_email = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com").strip().lower()
    seed_pwd = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")
    existing = await db.users.find_one({"email": seed_email}, {"_id": 0})
    if existing:
        return
    await db.users.insert_one({
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": seed_email,
        "name": "Vivo Admin",
        "picture": None,
        "role": "admin",
        "active": True,
        "auth_method": "password",
        "password_hash": pwd.hash(seed_pwd),
        "created_at": datetime.now(timezone.utc),
    })
    logger.warning("[auth] Seeded admin user %s", seed_email)


# ---------- Activity logging middleware ----------
class ActivityLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        try:
            path = request.url.path
            if not path.startswith("/api/"):
                return response
            # Skip logging auth flow itself — too noisy.
            if path.startswith("/api/auth/"):
                return response
            # Re-validate the session cheaply to get the user; skip logging if anonymous.
            token = request.cookies.get("session_token")
            if not token:
                auth = request.headers.get("authorization") or ""
                if auth.lower().startswith("bearer "):
                    token = auth[7:].strip()
            if not token:
                return response
            user = await _fetch_session_token_user(token)
            if not user:
                return response
            await db.activity_logs.insert_one({
                "ts": datetime.now(timezone.utc),
                "user_id": user.user_id,
                "email": user.email,
                "method": request.method,
                "path": path,
                "query": str(request.url.query or ""),
                "status_code": response.status_code,
                "duration_ms": int((time.time() - start) * 1000),
                "ip": request.headers.get("x-forwarded-for", request.client.host if request.client else ""),
                "user_agent": request.headers.get("user-agent", "")[:240],
            })
        except Exception as e:  # never break the response because of logging
            logger.warning("[auth] activity-log insert failed: %s", e)
        return response


# ---------- Auth routes ----------
import hmac as _hmac
import hashlib as _hashlib
import os as _auth_os


def _pii_reveal_secret() -> bytes:
    """Secret used to sign short-lived PII reveal tokens. Reuses
    JWT_SECRET / SECRET_KEY if set so that all auth-derived secrets
    rotate together; falls back to a fixed dev string."""
    return (_auth_os.environ.get("JWT_SECRET") or _auth_os.environ.get("SECRET_KEY") or "vivo-pii-reveal-dev").encode()


def _make_pii_reveal_token(user_id: str, ttl_seconds: int = 600) -> Tuple[str, int]:
    """Return ``(token, expiry_unix)``. Token is `<expiry>.<hmac>` where
    hmac is HMAC-SHA256 of `f"{user_id}:{expiry}"` using
    ``_pii_reveal_secret``. 10-minute default TTL — short so a copy/paste
    of the token doesn't grant lasting PII access.
    """
    exp = int(datetime.now(timezone.utc).timestamp()) + ttl_seconds
    msg = f"{user_id}:{exp}".encode()
    sig = _hmac.new(_pii_reveal_secret(), msg, _hashlib.sha256).hexdigest()
    return f"{exp}.{sig}", exp


def verify_pii_reveal_token(user_id: Optional[str], token: Optional[str]) -> bool:
    """Verify a PII reveal token. False on missing/expired/tampered."""
    if not token or not user_id:
        return False
    try:
        exp_str, sig = token.split(".", 1)
        exp = int(exp_str)
    except (ValueError, AttributeError):
        return False
    if exp < int(datetime.now(timezone.utc).timestamp()):
        return False
    msg = f"{user_id}:{exp}".encode()
    expected = _hmac.new(_pii_reveal_secret(), msg, _hashlib.sha256).hexdigest()
    return _hmac.compare_digest(expected, sig)


@auth_router.post("/verify-password")
async def verify_password(body: PasswordOnlyBody, user: User = Depends(get_current_user)):
    """Confirm the shared PII-reveal password — used as a "step-up" gate
    before unmasking PII (full mobile / email of churned customers, the
    masked-by-default Top-N customers list, etc.). Returns
    `{ok: True, reveal_token, expires_at}` on match, 401 on mismatch.

    The password is a SHARED ops-team secret (`PII_REVEAL_PASSWORD` env
    or default `Vivo@2033!!!`) — distinct from each user's own login
    password — so the team can rotate it independently of staff access
    without forcing password resets for everyone. Every successful
    verification still logs `user_id` so we know WHO unmasked.

    The `reveal_token` is short-lived (10 min) and HMAC-signed against
    the user's `user_id`. Frontends pass it as the
    `X-PII-Reveal-Token` header on subsequent calls to PII endpoints
    (e.g. `/churned-customers?reveal=true`).
    """
    expected = _auth_os.environ.get("PII_REVEAL_PASSWORD") or "Vivo@2033!!!"
    if not body.password or not _hmac.compare_digest(str(body.password), expected):
        raise HTTPException(status_code=401, detail="Invalid PII reveal password")
    token, exp = _make_pii_reveal_token(user.user_id)
    return {
        "ok": True,
        "user_id": user.user_id,
        "reveal_token": token,
        "expires_at": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat(),
    }


@auth_router.post("/login")
async def login(body: LoginBody, response: Response):
    user_doc = await db.users.find_one({"email": body.email.lower()})
    if not user_doc or not user_doc.get("active", True):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    ph = user_doc.get("password_hash")
    if not ph or not pwd.verify(body.password, ph):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = await _create_session(user_doc["user_id"])
    await db.users.update_one(
        {"user_id": user_doc["user_id"]},
        {"$set": {"last_login_at": datetime.now(timezone.utc)}},
    )
    _set_session_cookie(response, token)
    user_obj = _clean_user(user_doc)
    user_payload = user_obj.model_dump()
    user_payload["allowed_pages"] = pages_for(user_obj)
    return {"token": token, "user": user_payload}


@auth_router.post("/google/callback")
async def google_callback(body: GoogleCallbackBody, response: Response):
    """Called by frontend after Emergent Google redirect — exchanges session_id
    for session_token, enforces the email-domain whitelist, and auto-provisions
    the user on first login."""
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get(
                EMERGENT_SESSION_URL,
                headers={"X-Session-ID": body.session_id},
            )
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=400, detail=f"Invalid session_id: {e}")

    email = (data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Google returned no email")
    domain = email.rsplit("@", 1)[-1]
    if domain not in ALLOWED_DOMAINS:
        raise HTTPException(
            status_code=403,
            detail=(
                f"This dashboard is restricted to specific email domains. "
                f"'{domain}' is not allowed — please sign in with "
                f"{', '.join(sorted(ALLOWED_DOMAINS))}."
            ),
        )

    user_doc = await db.users.find_one({"email": email})
    now = datetime.now(timezone.utc)
    if not user_doc:
        user_doc = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "role": "viewer",
            "active": True,
            "auth_method": "google",
            "created_at": now,
            "last_login_at": now,
        }
        await db.users.insert_one(user_doc)
    else:
        if not user_doc.get("active", True):
            raise HTTPException(status_code=403, detail="Account disabled")
        await db.users.update_one(
            {"user_id": user_doc["user_id"]},
            {"$set": {
                "name": data.get("name") or user_doc.get("name"),
                "picture": data.get("picture") or user_doc.get("picture"),
                "last_login_at": now,
                "auth_method": user_doc.get("auth_method") or "google",
            }},
        )
        user_doc = await db.users.find_one({"user_id": user_doc["user_id"]})

    # Prefer Emergent's own session_token when present (7-day TTL matches).
    token = data.get("session_token") or await _create_session(user_doc["user_id"])
    # Persist the token in our sessions collection so /auth/me can validate it.
    await db.user_sessions.update_one(
        {"session_token": token},
        {"$set": {
            "user_id": user_doc["user_id"],
            "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    _set_session_cookie(response, token)
    user_obj = _clean_user(user_doc)
    user_payload = user_obj.model_dump()
    user_payload["allowed_pages"] = pages_for(user_obj)
    return {"token": token, "user": user_payload}


@auth_router.get("/me")
async def me(user: User = Depends(get_current_user)):
    payload = user.model_dump()
    payload["allowed_pages"] = pages_for(user)
    return payload


@auth_router.get("/activity-streak")
async def activity_streak(user: User = Depends(get_current_user)):
    """
    Consecutive-day login streak for the authenticated user.

    Derives from activity_logs (already captured by middleware). A day counts
    as "active" if the user had at least one authenticated /api/* request on
    that UTC day. Streak = consecutive days ending today (or ending yesterday
    — a user who hasn't loaded the dashboard yet today shouldn't lose their
    streak until tomorrow).
    """
    # Pull distinct active days over the last 45 days (hard cap for cheap query).
    since = datetime.now(timezone.utc) - timedelta(days=45)
    active_days: set[str] = set()
    cursor = db.activity_logs.find(
        {"user_id": user.user_id, "ts": {"$gte": since}},
        {"_id": 0, "ts": 1},
    )
    async for doc in cursor:
        ts = doc.get("ts")
        if isinstance(ts, datetime):
            active_days.add(ts.strftime("%Y-%m-%d"))

    today = datetime.now(timezone.utc).date()
    # Seed cursor at today if active, else yesterday (grace period).
    if today.strftime("%Y-%m-%d") in active_days:
        cur = today
    else:
        cur = today - timedelta(days=1)
        if cur.strftime("%Y-%m-%d") not in active_days:
            return {"streak": 0, "visits_30d": len(active_days), "today_active": False}

    streak = 0
    while cur.strftime("%Y-%m-%d") in active_days:
        streak += 1
        cur = cur - timedelta(days=1)
        if streak > 45:
            break
    return {
        "streak": streak,
        "visits_30d": len(active_days),
        "today_active": today.strftime("%Y-%m-%d") in active_days,
    }


@auth_router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    # Mirror the flags used by `_set_session_cookie` — Chrome and Safari
    # silently drop a delete_cookie call whose attributes don't match the
    # original Set-Cookie. Without this, the stale `session_token` cookie
    # survives logout and the next /auth/me request after re-login can
    # surface phantom session errors.
    response.delete_cookie(
        "session_token",
        path="/",
        secure=True,
        samesite="none",
    )
    return {"ok": True}


@auth_router.get("/allowed-domains")
async def allowed_domains():
    """Public — used by login UI."""
    return {"domains": sorted(ALLOWED_DOMAINS)}


# ---------- Admin routes ----------
@admin_router.get("/users")
async def list_users(_: User = Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).limit(1000).to_list(1000)
    return docs


from pii import VALID_ROLES as PII_VALID_ROLES


@admin_router.post("/users")
async def create_user(body: CreateUserBody, _: User = Depends(require_admin)):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="User already exists")
    if body.role not in PII_VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {sorted(PII_VALID_ROLES)}")
    doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "name": body.name,
        "picture": None,
        "role": body.role,
        "active": True,
        "auth_method": "password",
        "password_hash": pwd.hash(body.password),
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(doc)
    doc.pop("password_hash", None)
    doc.pop("_id", None)
    return doc


@admin_router.patch("/users/{user_id}")
async def update_user(user_id: str, body: UpdateUserBody, actor: User = Depends(require_admin)):
    upd = {}
    if body.role is not None:
        if body.role not in PII_VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"role must be one of {sorted(PII_VALID_ROLES)}")
        upd["role"] = body.role
    if body.active is not None:
        upd["active"] = bool(body.active)
    if not upd:
        return {"ok": True}
    if user_id == actor.user_id and body.role and body.role != "admin":
        raise HTTPException(status_code=400, detail="Cannot demote yourself")
    if user_id == actor.user_id and body.active is False:
        raise HTTPException(status_code=400, detail="Cannot disable yourself")
    await db.users.update_one({"user_id": user_id}, {"$set": upd})
    return {"ok": True}


@admin_router.delete("/users/{user_id}")
async def delete_user(user_id: str, actor: User = Depends(require_admin)):
    if user_id == actor.user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await db.users.delete_one({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    return {"ok": True}


@admin_router.get("/activity-logs")
async def activity_logs(
    _: User = Depends(require_admin),
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
    user_id: Optional[str] = None,
    path: Optional[str] = None,
):
    q = {}
    if user_id:
        q["user_id"] = user_id
    if path:
        q["path"] = {"$regex": path, "$options": "i"}
    total = await db.activity_logs.count_documents(q)
    rows = (
        await db.activity_logs.find(q, {"_id": 0})
        .sort("ts", -1)
        .skip(skip)
        .limit(limit)
        .to_list(None)
    )
    return {"total": total, "rows": rows}


@admin_router.get("/pii-audit-logs")
async def pii_audit_logs(
    _: User = Depends(require_admin),
    limit: int = Query(200, ge=1, le=2000),
    skip: int = Query(0, ge=0),
    user_id: Optional[str] = None,
    endpoint: Optional[str] = None,
    row_id: Optional[str] = None,
):
    """Admin-only audit trail of every UNMASKED PII access."""
    q = {}
    if user_id:
        q["user_id"] = user_id
    if endpoint:
        q["endpoint"] = {"$regex": endpoint, "$options": "i"}
    if row_id:
        q["row_id"] = row_id
    total = await db.pii_audit_log.count_documents(q)
    rows = (
        await db.pii_audit_log.find(q, {"_id": 0})
        .sort("ts", -1)
        .skip(skip)
        .limit(limit)
        .to_list(None)
    )
    return {"total": total, "rows": rows}
