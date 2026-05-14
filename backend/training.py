"""
Vivo Training API proxy.

Wraps the external `vivo-training-api` (Google Cloud Run) under our `/api/training/*`
namespace so the frontend can talk to it through the same origin / auth-protected stack.

All endpoints require an authenticated session (manager-only). Lateness values are
adjusted by -3 hours (UTC -> Africa/Nairobi) and clamped at 0 so we don't show
negative late-times.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

TRAINING_API_BASE = "https://vivo-training-api-666430550422.europe-west1.run.app"
NAIROBI_OFFSET_HOURS = 3  # UTC -> EAT


def _adjust_hours(value: Any) -> Any:
    """Subtract Nairobi offset from a numeric hours value, clamp at 0."""
    if value is None:
        return value
    try:
        adjusted = float(value) - NAIROBI_OFFSET_HOURS
    except (TypeError, ValueError):
        return value
    return round(max(adjusted, 0.0), 2)


def _adjust_lateness_payload(payload: Any) -> Any:
    """Apply -3h to every lateness metric returned by `/lateness`."""
    if not isinstance(payload, dict):
        return payload

    by_training = payload.get("by_training") or []
    for row in by_training:
        if not isinstance(row, dict):
            continue
        if "avg_lateness_hours" in row:
            row["avg_lateness_hours"] = _adjust_hours(row.get("avg_lateness_hours"))
        if "max_lateness_hours" in row:
            row["max_lateness_hours"] = _adjust_hours(row.get("max_lateness_hours"))

    detail = payload.get("detail") or []
    for row in detail:
        if isinstance(row, dict) and "lateness_hours" in row:
            row["lateness_hours"] = _adjust_hours(row.get("lateness_hours"))

    payload["timezone_adjusted"] = True
    payload["timezone_offset_hours"] = NAIROBI_OFFSET_HOURS
    return payload


async def _proxy(path: str, params: dict[str, Any]) -> Any:
    clean = {k: v for k, v in params.items() if v is not None and v != ""}
    url = f"{TRAINING_API_BASE}{path}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(url, params=clean)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=f"Training API: {r.text[:300]}")
        return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Training API unreachable: {e}") from e


def make_router(require_manager: Callable) -> APIRouter:
    router = APIRouter(prefix="/training", tags=["training"])

    @router.get("/overview")
    async def overview(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        department: Optional[str] = Query(None),
        delivery_method: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/overview", {
            "date_from": date_from, "date_to": date_to, "category": category,
            "training_name": training_name, "department": department,
            "delivery_method": delivery_method,
        })

    @router.get("/filters")
    async def filters(_user=Depends(require_manager)):
        return await _proxy("/filters", {})

    @router.get("/training-status")
    async def training_status(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        department: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/training-status", {
            "date_from": date_from, "date_to": date_to,
            "category": category, "department": department,
        })

    @router.get("/by-department")
    async def by_department(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/by-department", {
            "date_from": date_from, "date_to": date_to,
            "category": category, "training_name": training_name,
        })

    @router.get("/by-delivery-method")
    async def by_delivery_method(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/by-delivery-method", {
            "date_from": date_from, "date_to": date_to,
            "category": category, "training_name": training_name,
        })

    @router.get("/duration")
    async def duration(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/duration", {
            "date_from": date_from, "date_to": date_to,
            "category": category, "training_name": training_name,
        })

    @router.get("/budget")
    async def budget(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/budget", {
            "date_from": date_from, "date_to": date_to,
            "category": category, "training_name": training_name,
        })

    @router.get("/lateness")
    async def lateness(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        department: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        raw = await _proxy("/lateness", {
            "date_from": date_from, "date_to": date_to,
            "training_name": training_name, "department": department,
        })
        return _adjust_lateness_payload(raw)

    @router.get("/top-employees")
    async def top_employees(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        department: Optional[str] = Query(None),
        limit: int = Query(10, ge=1, le=100),
        _user=Depends(require_manager),
    ):
        return await _proxy("/top-employees", {
            "date_from": date_from, "date_to": date_to, "category": category,
            "training_name": training_name, "department": department, "limit": limit,
        })

    @router.get("/employee-history")
    async def employee_history(
        employee: str = Query("", description="Employee name (substring match)"),
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/employee-history", {
            "employee": employee, "date_from": date_from, "date_to": date_to,
        })

    @router.get("/monthly-trend")
    async def monthly_trend(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        category: Optional[str] = Query(None),
        training_name: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/monthly-trend", {
            "date_from": date_from, "date_to": date_to,
            "category": category, "training_name": training_name,
        })

    @router.get("/facilitators")
    async def facilitators(
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        _user=Depends(require_manager),
    ):
        return await _proxy("/facilitators", {"date_from": date_from, "date_to": date_to})

    return router
