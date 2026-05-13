"""Vivo Training API proxy — wraps the upstream training analytics service,
adjusts lateness values by -3h (Nairobi/UTC offset fix), and exposes the
endpoints under /api/training/*. Manager-only."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger("vivo.training")

TRAINING_API = os.environ.get(
    "TRAINING_API_URL",
    "https://vivo-training-api-666430550422.europe-west1.run.app",
).rstrip("/")

# How many hours to subtract from every "lateness" reading. The upstream API
# computes (check_in_utc - training_start_local), which leaves UTC+3 baked in.
LATENESS_OFFSET_HOURS = float(os.environ.get("TRAINING_LATENESS_OFFSET_H", "3"))


async def _bi_get(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{TRAINING_API}{path}"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(url, params=params or {})
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Training API {path} {r.status_code}: {r.text[:200]}")
        return r.json()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Training API call failed: {exc}")


def _shift_lateness(node: Any) -> Any:
    """Recursively subtract LATENESS_OFFSET_HOURS from any *_lateness_hours field."""
    if isinstance(node, dict):
        return {k: (_shift_lateness(v) if isinstance(v, (dict, list)) else _shift_value(k, v)) for k, v in node.items()}
    if isinstance(node, list):
        return [_shift_lateness(x) for x in node]
    return node


def _shift_value(k: str, v: Any) -> Any:
    if "lateness" in k and isinstance(v, (int, float)):
        adjusted = round(float(v) - LATENESS_OFFSET_HOURS, 2)
        # Floor at 0 — if someone "checked in 5 minutes early" don't show -3h
        return max(0.0, adjusted)
    return v


def make_router(require_manager):
    router = APIRouter(prefix="/training", tags=["training"])

    @router.get("/health")
    async def health(_: Any = Depends(require_manager)):
        try:
            r = await _bi_get("/")
            return {"upstream": r, "offset_hours": LATENESS_OFFSET_HOURS, "url": TRAINING_API}
        except HTTPException as exc:
            return {"error": exc.detail}

    @router.get("/filters")
    async def filters(_: Any = Depends(require_manager)):
        return await _bi_get("/filters")

    @router.get("/overview")
    async def overview(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        delivery_method: Optional[str] = None,
        location: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        params = _pack(locals())
        return await _bi_get("/overview", params)

    @router.get("/training-status")
    async def training_status(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        delivery_method: Optional[str] = None,
        location: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/training-status", _pack(locals()))

    @router.get("/by-department")
    async def by_department(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        delivery_method: Optional[str] = None,
        location: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/by-department", _pack(locals()))

    @router.get("/by-delivery-method")
    async def by_delivery_method(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        delivery_method: Optional[str] = None,
        location: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/by-delivery-method", _pack(locals()))

    @router.get("/duration")
    async def duration(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/duration", _pack(locals()))

    @router.get("/budget")
    async def budget(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/budget", _pack(locals()))

    @router.get("/lateness")
    async def lateness(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        raw = await _bi_get("/lateness", _pack(locals()))
        # ⚡ Adjust the time-zone-skewed lateness values by -3h.
        return _shift_lateness(raw)

    @router.get("/top-employees")
    async def top_employees(
        limit: int = Query(10, ge=1, le=50),
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        department: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/top-employees", _pack(locals()))

    @router.get("/employee-history")
    async def employee_history(
        employee_code: Optional[str] = None,
        employee_name: Optional[str] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/employee-history", _pack(locals()))

    @router.get("/monthly-trend")
    async def monthly_trend(
        category: Optional[str] = None,
        training_name: Optional[str] = None,
        year: Optional[int] = None,
        _: Any = Depends(require_manager),
    ):
        return await _bi_get("/monthly-trend", _pack(locals()))

    @router.get("/facilitators")
    async def facilitators(_: Any = Depends(require_manager)):
        return await _bi_get("/facilitators")

    return router


def _pack(local_vars: Dict[str, Any]) -> Dict[str, Any]:
    """Pack non-None, non-underscore locals as upstream query params."""
    return {
        k: v for k, v in local_vars.items()
        if v is not None and not k.startswith("_")
    }
