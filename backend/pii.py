"""PII masking + audit logging for the /customers endpoint family.

Business rule (per user spec, Kenya DPA compliance):
  Role hierarchy:          viewer < store_manager < analyst < exec, admin
  Email + phone:           fully visible for roles >= analyst;
                           masked to last 4 chars for store_manager and viewer.
  Name:                    fully visible for roles >= store_manager;
                           "R. Nyambura" (initial + surname) for viewer.
  Every access to UNMASKED PII is written to `pii_audit_log` — one row
  per user+customer+endpoint+timestamp.

Masking happens at the VIEW LAYER (not the UI), so CSV exports coming
from the same endpoints carry the same masking.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger(__name__)

# --- role helpers ------------------------------------------------------------

# Ordered lowest → highest. "admin" grants everything.
_ROLE_RANK = {"viewer": 0, "store_manager": 1, "analyst": 2, "exec": 3, "admin": 4}

VALID_ROLES = set(_ROLE_RANK.keys())


def role_rank(role: Optional[str]) -> int:
    return _ROLE_RANK.get((role or "viewer").lower(), 0)


def can_see_full_contact(role: Optional[str]) -> bool:
    """email + phone fully visible?"""
    return role_rank(role) >= _ROLE_RANK["analyst"]


def can_see_full_name(role: Optional[str]) -> bool:
    """name fully visible?"""
    return role_rank(role) >= _ROLE_RANK["store_manager"]


# --- masking primitives ------------------------------------------------------

def _mask_tail(value: Optional[str], keep: int = 4) -> Optional[str]:
    if not value:
        return value
    s = str(value)
    if len(s) <= keep:
        return "•" * len(s)
    return ("•" * (len(s) - keep)) + s[-keep:]


def _mask_name(value: Optional[str]) -> Optional[str]:
    """Convert 'Ruth Nyambura Wairimu' → 'R. Wairimu'. Single-word names
    stay as the initial + first-3 characters masked."""
    if not value:
        return value
    parts = [p for p in str(value).strip().split() if p]
    if not parts:
        return value
    if len(parts) == 1:
        return parts[0][:1] + "."
    initial = parts[0][:1]
    surname = parts[-1]
    return f"{initial}. {surname}"


# --- row-level masking -------------------------------------------------------

# Field keys commonly present in upstream customer objects. The masker also
# tolerates per-row aliases like `customer_phone` / `primary_email`.
_CONTACT_FIELDS = ("email", "phone", "mobile", "customer_phone", "customer_email", "primary_email", "primary_phone")
_NAME_FIELDS = ("customer_name", "name", "full_name", "display_name")


def mask_row(row: Dict[str, Any], role: Optional[str]) -> Dict[str, Any]:
    """Return a NEW dict with PII masked per the user's role."""
    if not isinstance(row, dict):
        return row
    full_contact = can_see_full_contact(role)
    full_name = can_see_full_name(role)
    if full_contact and full_name:
        return row  # admin / exec / analyst → unchanged
    out = dict(row)
    if not full_contact:
        for k in _CONTACT_FIELDS:
            if k in out and out[k] not in (None, ""):
                out[k] = _mask_tail(out[k], 4)
    if not full_name:
        for k in _NAME_FIELDS:
            if k in out and out[k] not in (None, ""):
                out[k] = _mask_name(out[k])
    return out


def mask_rows(rows: Iterable[Dict[str, Any]], role: Optional[str]) -> List[Dict[str, Any]]:
    return [mask_row(r, role) for r in (rows or [])]


# --- audit log (async, non-blocking) -----------------------------------------

_db_client: AsyncIOMotorClient | None = None


def _db():
    """Lazy-import the Mongo client to avoid a circular dependency on server.py.
    Uses the same MONGO_URL / DB_NAME as the rest of the app."""
    global _db_client
    if _db_client is None:
        _db_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return _db_client[os.environ["DB_NAME"]]


async def log_unmasked_access(
    *,
    user,
    endpoint: str,
    row_ids: List[str],
    fields: List[str],
    request_ip: Optional[str] = None,
) -> None:
    """Write ONE audit row per customer row touched. Non-fatal on error.

    Per acceptance spec: "Audit log has one row per unmasked-PII access
    with user, row_id, timestamp." We batch the inserts into one
    insert_many() call for efficiency when a list endpoint returns many
    customers in one shot.
    """
    if not row_ids:
        return
    now = datetime.now(timezone.utc)
    docs = [
        {
            "id": str(uuid.uuid4()),
            "user_id": getattr(user, "user_id", None),
            "user_email": getattr(user, "email", None),
            "user_role": getattr(user, "role", None),
            "endpoint": endpoint,
            "row_id": rid,
            "fields": fields,
            "request_ip": request_ip,
            "ts": now.isoformat(),
            "created_at": now,
        }
        for rid in row_ids
    ]
    try:
        await _db().pii_audit_log.insert_many(docs, ordered=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("pii_audit_log insert failed: %s", exc)


def _row_id(row: Dict[str, Any]) -> Optional[str]:
    # Prefer a stable business id, fall back to a few common alternates.
    for k in ("customer_id", "id", "cust_id"):
        if k in row and row[k] not in (None, ""):
            return str(row[k])
    return None


async def mask_and_audit(
    rows: Iterable[Dict[str, Any]],
    *,
    user,
    endpoint: str,
    request_ip: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """One-shot helper: mask rows AND, when the caller could see unmasked
    PII, write the audit trail. Use this on list endpoints that return
    customer PII."""
    rows_list = list(rows or [])
    # Only audit when PII is actually in the payload.
    has_pii = any(
        any(k in r for k in _NAME_FIELDS + _CONTACT_FIELDS)
        for r in rows_list if isinstance(r, dict)
    )
    if has_pii and (can_see_full_contact(getattr(user, "role", None)) or can_see_full_name(getattr(user, "role", None))):
        ids = [rid for rid in (_row_id(r) for r in rows_list if isinstance(r, dict)) if rid]
        # Which fields are actually unmasked for this role?
        visible = []
        if can_see_full_contact(getattr(user, "role", None)):
            visible += ["email", "phone"]
        if can_see_full_name(getattr(user, "role", None)):
            visible += ["name"]
        await log_unmasked_access(
            user=user,
            endpoint=endpoint,
            row_ids=ids,
            fields=visible,
            request_ip=request_ip,
        )
    return mask_rows(rows_list, getattr(user, "role", None))
