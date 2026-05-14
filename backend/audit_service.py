"""Iter 79 — Self-audit service with 2-attempt auto-fix protocol.

The standing 2-hour audit lives here. Triggered by:
  • POST /api/run-audit?secret=…       — invoked by external cron-job.org.
  • CLI runner /app/backend/tests/audit_2hour.py (ad-hoc / GHA).

Auto-fix mandate (CEO spec):
  • Every issue gets TWO repair attempts before email escalation.
  • After each attempt the underlying check is re-run.
  • Email only sent if BOTH attempts fail (or for CRITICAL connectivity
    failures we can't auto-fix at all).

Audit record schema (Mongo `audit_log` collection):
    {
        timestamp: ISO,             # EAT
        status: HEALTHY|WARNING|CRITICAL,
        performance: {slowest_endpoint, slowest_ms, all_within_limits},
        data_accuracy: {kenya, uganda, rwanda, online, all_non_zero},
        system_health: {cache_hit_rate, repeat_miss_rate, rss_mb,
                        heavyguard_rejections, mongo_snapshots},
        connectivity: {dashboard, vivo_bi_api, attendance_api, training_api},
        issues_found, issues_auto_fixed, issues_escalated,
        fix_details: [
            {issue, attempt_1, attempt_1_result, attempt_2?,
             attempt_2_result?, resolved, escalated}
        ],
        email_dispatched: {sent_to:[], ok:bool, error?},
    }
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import logging
import os
from typing import Any, Dict, List, Tuple

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

from email_alert import send_alert

logger = logging.getLogger("server.audit_service")

EAT = _dt.timezone(_dt.timedelta(hours=3))

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "https://bi.vivofashionbrands.com")
EXTERNAL_APIS = [
    ("dashboard",     DASHBOARD_URL),
    ("vivo_bi_api",   "https://vivo-bi-api-666430550422.europe-west1.run.app"),
    ("attendance_api","https://vivo-attendance-api-666430550422.europe-west1.run.app"),
    ("training_api",  "https://vivo-training-api-666430550422.europe-west1.run.app"),
]

# warm-call SLA per endpoint (ms). Slowest defines the audit status.
ENDPOINT_BUDGETS = {
    "/api/kpis": 500,
    "/api/sales-summary": 500,
    "/api/country-summary": 500,
    "/api/analytics/ibt-warehouse-to-store": 500,
    "/api/analytics/sor-all-styles": 2000,
    "/api/analytics/replenishment-report": 3000,
}


# ───────────────────── helpers ──────────────────────


def _now_eat() -> _dt.datetime:
    return _dt.datetime.now(EAT)


async def _login_admin(client: httpx.AsyncClient, base: str) -> str:
    email = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
    pw = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")
    r = await client.post(f"{base}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    r.raise_for_status()
    d = r.json()
    tok = d.get("access_token") or d.get("token") or d.get("session_token")
    if not tok:
        raise RuntimeError("admin login response missing token")
    return tok


async def _time_get(client: httpx.AsyncClient, url: str, headers: dict, timeout: float = 90) -> Tuple[int, float, dict | list | None]:
    import time as _t
    t0 = _t.perf_counter()
    try:
        r = await client.get(url, headers=headers, timeout=timeout)
        ms = (_t.perf_counter() - t0) * 1000
        body: Any = None
        if r.status_code == 200:
            try:
                body = r.json()
            except Exception:
                body = None
        return r.status_code, round(ms, 1), body
    except Exception as e:
        return -1, round((_t.perf_counter() - t0) * 1000, 1), {"__err__": str(e)[:160]}


# ───────────────────── checks ───────────────────────


async def _check_performance(client: httpx.AsyncClient, base: str, headers: dict, df: str, dt_iso: str) -> Tuple[Dict, List[Tuple[str, int]]]:
    """Returns ({slowest_endpoint, slowest_ms, all_within_limits, per_endpoint},
                offenders: [(endpoint, ms)])."""
    rows = []
    offenders = []
    for raw_ep, budget in ENDPOINT_BUDGETS.items():
        path = raw_ep
        if "{df}" in path:
            path = path.format(df=df, dt=dt_iso)
        # cold + cached
        await _time_get(client, f"{base}{path}", headers)
        await asyncio.sleep(0.3)
        status, ms, _ = await _time_get(client, f"{base}{path}", headers)
        rows.append({"endpoint": raw_ep, "warm_ms": ms, "status": status, "budget_ms": budget})
        if status != 200 or ms >= budget:
            offenders.append((raw_ep, int(ms)))
    rows.sort(key=lambda r: r["warm_ms"], reverse=True)
    slowest = rows[0] if rows else {"endpoint": "?", "warm_ms": 0}
    return {
        "slowest_endpoint": slowest["endpoint"],
        "slowest_ms": int(slowest["warm_ms"]),
        "all_within_limits": not offenders,
        "per_endpoint": rows,
    }, offenders


async def _check_country_data(client: httpx.AsyncClient, base: str, headers: dict, today_iso: str) -> Tuple[Dict, List[str]]:
    """Returns ({kenya, uganda, rwanda, online, all_non_zero}, zero_countries[])."""
    out = {"kenya": 0, "uganda": 0, "rwanda": 0, "online": 0}
    try:
        status, _, body = await _time_get(
            client,
            f"{base}/api/country-summary?date_from={today_iso}&date_to={today_iso}",
            headers, timeout=30,
        )
        if status == 200 and isinstance(body, list):
            for d in body:
                c = (d.get("country") or "").lower()
                if c in out:
                    out[c] = float(d.get("total_sales") or 0)
    except Exception as e:
        logger.warning("[audit] country-summary fetch failed: %s", e)
    # Online may legitimately be 0 — treat as ⚠️ but NOT a failure.
    required = ("kenya", "uganda", "rwanda")
    zero_required = [c for c in required if out[c] <= 0]
    all_non_zero = not zero_required
    return {**out, "all_non_zero": all_non_zero}, zero_required


async def _check_reconciliation(client: httpx.AsyncClient, base: str, headers: dict) -> Tuple[Dict, List[str]]:
    """Iter 80 — Per CEO spec: the recon check
    `kpis.total_sales == Σ country_summary.total_sales` must pass at
    all times. Wraps `/api/admin/reconciliation-check` and returns its
    failed-check names so the audit can attempt auto-fix.
    """
    out: Dict[str, Any] = {"ok": False, "failed_checks": []}
    failed: List[str] = []
    try:
        status, _, body = await _time_get(
            client, f"{base}/api/admin/reconciliation-check",
            headers, timeout=60,
        )
        if status == 200 and isinstance(body, dict):
            out["ok"] = bool(body.get("ok"))
            for c in body.get("checks", []) or []:
                if c.get("ok") is False:
                    failed.append(c.get("name") or "?")
            out["failed_checks"] = failed
            out["source_of_truth"] = body.get("source_of_truth")
    except Exception as e:
        logger.warning("[audit] reconciliation-check fetch failed: %s", e)
        out["error"] = str(e)[:120]
        failed = ["recon_endpoint_unreachable"]
    return out, failed


async def _check_system_health(client: httpx.AsyncClient, base: str, headers: dict) -> Tuple[Dict, List[str]]:
    """Returns (system metrics dict, list of breached metrics)."""
    cs: dict = {}
    sn = {"count": 0}
    try:
        _, _, body = await _time_get(client, f"{base}/api/admin/cache-stats", headers, timeout=15)
        cs = body if isinstance(body, dict) else {}
    except Exception:
        pass
    try:
        _, _, body = await _time_get(client, f"{base}/api/admin/snapshot-count", headers, timeout=10)
        if isinstance(body, dict):
            sn = body
    except Exception:
        pass
    hit_rate = float(cs.get("counters_since_boot", {}).get("hit_rate_pct", 0) or 0)
    misses = cs.get("miss_analysis", {}).get("top_repeat_offenders", []) or []
    repeat_miss = int(misses[0].get("miss_count", 0)) if misses else 0
    rss = float(cs.get("process", {}).get("rss_mb", 0) or 0)
    heavy_rej = sum((v or 0) for v in (cs.get("heavy_guard", {}).get("rejections_since_boot", {}) or {}).values())
    snaps = int(sn.get("count", 0))

    breached: List[str] = []
    if hit_rate < 50:
        breached.append("cache_hit_rate_critical")
    if rss > 1100:
        breached.append("rss_critical")
    return {
        "cache_hit_rate": round(hit_rate, 1),
        "repeat_miss_rate": repeat_miss,
        "rss_mb": int(rss),
        "heavyguard_rejections": int(heavy_rej),
        "mongo_snapshots": snaps,
    }, breached


async def _check_connectivity(client: httpx.AsyncClient) -> Tuple[Dict, List[str]]:
    """Each upstream API gets a GET. Returns ({name:bool}, unreachable[])."""
    results: Dict[str, bool] = {}
    unreachable: List[str] = []
    for name, url in EXTERNAL_APIS:
        try:
            r = await client.get(url, timeout=10, follow_redirects=True)
            ok = r.status_code < 500
        except Exception:
            ok = False
        results[name] = ok
        if not ok:
            unreachable.append(name)
    return results, unreachable


# ───────────────────── auto-fix actions ─────────────


async def _flush_cache(client: httpx.AsyncClient, base: str, headers: dict) -> bool:
    try:
        r = await client.post(f"{base}/api/admin/flush-kpi-cache", headers=headers, timeout=20)
        return r.status_code in (200, 204)
    except Exception:
        return False


async def _trim_fetch_cache(client: httpx.AsyncClient, base: str, headers: dict) -> bool:
    """Best-effort trim — currently equivalent to flush, but isolated as
    a separate name so future iterations can implement a true LRU trim
    without changing the audit logic."""
    return await _flush_cache(client, base, headers)


async def _retry_connectivity_after(seconds: int) -> None:
    await asyncio.sleep(seconds)


# ───────────────────── orchestration ────────────────


async def run_audit(base_url: str, db: AsyncIOMotorDatabase, *, mode: str = "scheduled") -> Dict[str, Any]:
    """Execute the full audit. Writes one row to `audit_log` and returns
    the record. `mode` is one of "scheduled" (every 2 h) or "manual".

    Email policy:
      • CRITICAL state → send IMMEDIATELY (after auto-fix attempts fail).
      • WARNING state  → only email if the PREVIOUS audit was also WARNING
                          (persistent warning per CEO spec).
    """
    ts = _now_eat()
    today_iso = ts.date().isoformat()
    df = (ts.date() - _dt.timedelta(days=28)).isoformat()

    issues_found = 0
    issues_auto_fixed = 0
    issues_escalated = 0
    fix_details: List[Dict[str, Any]] = []
    critical_msgs: List[str] = []

    async with httpx.AsyncClient() as client:
        # Auth
        try:
            tok = await _login_admin(client, base_url)
        except Exception as e:
            record = {
                "timestamp": ts.isoformat(),
                "status": "CRITICAL",
                "performance": {"all_within_limits": False, "error": "auth_failed"},
                "data_accuracy": {},
                "system_health": {},
                "connectivity": {"dashboard": False, "vivo_bi_api": False,
                                 "attendance_api": False, "training_api": False},
                "issues_found": 1,
                "issues_auto_fixed": 0,
                "issues_escalated": 1,
                "fix_details": [{
                    "issue": "Admin login failed (audit cannot run)",
                    "attempt_1": "POST /api/auth/login with seed admin creds",
                    "attempt_1_result": f"failed — {e!s}",
                    "resolved": False, "escalated": True,
                }],
                "mode": mode,
            }
            await db.audit_log.insert_one({**record})
            return record
        headers = {"Authorization": f"Bearer {tok}"}

        # ── 1. Performance ────────────────────────────
        perf, offenders = await _check_performance(client, base_url, headers, df, today_iso)
        if offenders:
            issues_found += 1
            # Attempt 1: targeted flush + re-test
            fixed = await _flush_cache(client, base_url, headers)
            await asyncio.sleep(8)
            perf2, offenders2 = await _check_performance(client, base_url, headers, df, today_iso)
            if not offenders2 and fixed:
                issues_auto_fixed += 1
                fix_details.append({
                    "issue": f"Slow endpoint(s): {[e for e,_ in offenders]}",
                    "attempt_1": "Flush analytics_snapshots + Redis + L1 cache, re-warm",
                    "attempt_1_result": f"success — slowest now {perf2['slowest_ms']}ms",
                    "resolved": True, "escalated": False,
                })
                perf = perf2
            else:
                # Attempt 2: full flush + 30 s warmup wait, then re-test
                await _flush_cache(client, base_url, headers)
                await asyncio.sleep(30)
                perf3, offenders3 = await _check_performance(client, base_url, headers, df, today_iso)
                if not offenders3:
                    issues_auto_fixed += 1
                    fix_details.append({
                        "issue": f"Slow endpoint(s): {[e for e,_ in offenders]}",
                        "attempt_1": "Flush + 8s wait", "attempt_1_result": f"failed — slowest {perf2['slowest_ms']}ms",
                        "attempt_2": "Re-flush + 30s warmup", "attempt_2_result": f"success — slowest {perf3['slowest_ms']}ms",
                        "resolved": True, "escalated": False,
                    })
                    perf = perf3
                else:
                    issues_escalated += 1
                    msg = f"Performance regression on {[e for e,_ in offenders3]} (slowest {perf3['slowest_ms']}ms, budget {perf3['per_endpoint'][0]['budget_ms']}ms)"
                    critical_msgs.append(msg)
                    fix_details.append({
                        "issue": f"Slow endpoint(s): {[e for e,_ in offenders]}",
                        "attempt_1": "Flush + 8s wait", "attempt_1_result": f"failed — slowest {perf2['slowest_ms']}ms",
                        "attempt_2": "Re-flush + 30s warmup", "attempt_2_result": f"failed — slowest {perf3['slowest_ms']}ms",
                        "resolved": False, "escalated": True,
                    })
                    perf = perf3

        # ── 2. Country data ───────────────────────────
        cty, zero_required = await _check_country_data(client, base_url, headers, today_iso)
        if zero_required:
            issues_found += 1
            # Attempt 1: flush + re-fetch
            await _flush_cache(client, base_url, headers)
            await asyncio.sleep(8)
            cty2, zero_required2 = await _check_country_data(client, base_url, headers, today_iso)
            if not zero_required2:
                issues_auto_fixed += 1
                fix_details.append({
                    "issue": f"Country(ies) reporting zero today: {zero_required}",
                    "attempt_1": "Flush kpi+analytics cache, re-fetch /country-summary",
                    "attempt_1_result": "success — non-zero restored",
                    "resolved": True, "escalated": False,
                })
                cty = cty2
            else:
                await _flush_cache(client, base_url, headers)
                await asyncio.sleep(30)
                cty3, zero_required3 = await _check_country_data(client, base_url, headers, today_iso)
                if not zero_required3:
                    issues_auto_fixed += 1
                    fix_details.append({
                        "issue": f"Country(ies) reporting zero today: {zero_required}",
                        "attempt_1": "Flush + 8s", "attempt_1_result": "failed",
                        "attempt_2": "Full flush + 30s rebuild", "attempt_2_result": "success",
                        "resolved": True, "escalated": False,
                    })
                    cty = cty3
                else:
                    issues_escalated += 1
                    critical_msgs.append(f"Country(ies) still zero after 2 attempts: {zero_required3}")
                    fix_details.append({
                        "issue": f"Country(ies) reporting zero today: {zero_required}",
                        "attempt_1": "Flush + 8s", "attempt_1_result": "failed",
                        "attempt_2": "Full flush + 30s rebuild", "attempt_2_result": "failed",
                        "resolved": False, "escalated": True,
                    })
                    cty = cty3

        # ── 3. System health ──────────────────────────
        sys_h, breached = await _check_system_health(client, base_url, headers)
        if breached:
            issues_found += 1
            if "cache_hit_rate_critical" in breached:
                # No good auto-fix — flushing makes hit-rate worse temporarily.
                # Wait 60 s for natural warmup, then re-measure.
                await asyncio.sleep(60)
                sys_h2, breached2 = await _check_system_health(client, base_url, headers)
                if "cache_hit_rate_critical" not in breached2:
                    issues_auto_fixed += 1
                    fix_details.append({
                        "issue": f"Cache hit rate critically low ({sys_h['cache_hit_rate']}%)",
                        "attempt_1": "Wait 60s for natural request-driven warmup",
                        "attempt_1_result": f"success — hit rate now {sys_h2['cache_hit_rate']}%",
                        "resolved": True, "escalated": False,
                    })
                    sys_h = sys_h2
                else:
                    issues_escalated += 1
                    critical_msgs.append(f"Cache hit rate stuck at {sys_h2['cache_hit_rate']}% after 60s")
                    fix_details.append({
                        "issue": "Cache hit rate critically low",
                        "attempt_1": "Wait 60s", "attempt_1_result": f"failed — {sys_h2['cache_hit_rate']}%",
                        "resolved": False, "escalated": True,
                    })
                    sys_h = sys_h2
            if "rss_critical" in breached:
                # Attempt 1: trim _FETCH_CACHE (no destructive endpoint
                # exists today — we flush which is a superset).
                await _trim_fetch_cache(client, base_url, headers)
                await asyncio.sleep(10)
                sys_h3, breached3 = await _check_system_health(client, base_url, headers)
                if "rss_critical" not in breached3:
                    issues_auto_fixed += 1
                    fix_details.append({
                        "issue": f"RSS memory critically high ({sys_h['rss_mb']}MB)",
                        "attempt_1": "Trim _FETCH_CACHE via flush + 10s",
                        "attempt_1_result": f"success — RSS now {sys_h3['rss_mb']}MB",
                        "resolved": True, "escalated": False,
                    })
                    sys_h = sys_h3
                else:
                    issues_escalated += 1
                    critical_msgs.append(f"RSS still {sys_h3['rss_mb']}MB after trim — pod restart may be required")
                    fix_details.append({
                        "issue": "RSS memory critically high",
                        "attempt_1": "Trim _FETCH_CACHE + 10s",
                        "attempt_1_result": f"failed — {sys_h3['rss_mb']}MB",
                        "resolved": False, "escalated": True,
                    })
                    sys_h = sys_h3

        # ── 3.5 Reconciliation (Iter 80) ──────────────
        # CEO spec: kpis.total_sales == Σ country_summary.total_sales
        # must reconcile at all times. If recon has failures, attempt
        # the standard 2-attempt auto-fix (flush + warmup).
        recon, recon_fails = await _check_reconciliation(client, base_url, headers)
        if recon_fails:
            issues_found += 1
            await _flush_cache(client, base_url, headers)
            await asyncio.sleep(8)
            recon2, recon_fails2 = await _check_reconciliation(client, base_url, headers)
            if not recon_fails2:
                issues_auto_fixed += 1
                fix_details.append({
                    "issue": f"Reconciliation failed: {recon_fails}",
                    "attempt_1": "Flush KPI cache + 8s",
                    "attempt_1_result": "success — recon green",
                    "resolved": True, "escalated": False,
                })
                recon = recon2
            else:
                await _flush_cache(client, base_url, headers)
                await asyncio.sleep(30)
                recon3, recon_fails3 = await _check_reconciliation(client, base_url, headers)
                if not recon_fails3:
                    issues_auto_fixed += 1
                    fix_details.append({
                        "issue": f"Reconciliation failed: {recon_fails}",
                        "attempt_1": "Flush + 8s", "attempt_1_result": f"failed — {recon_fails2}",
                        "attempt_2": "Re-flush + 30s warmup", "attempt_2_result": "success",
                        "resolved": True, "escalated": False,
                    })
                    recon = recon3
                else:
                    issues_escalated += 1
                    critical_msgs.append(f"Reconciliation still failing after 2 attempts: {recon_fails3}")
                    fix_details.append({
                        "issue": f"Reconciliation failed: {recon_fails}",
                        "attempt_1": "Flush + 8s", "attempt_1_result": f"failed — {recon_fails2}",
                        "attempt_2": "Re-flush + 30s", "attempt_2_result": f"failed — {recon_fails3}",
                        "resolved": False, "escalated": True,
                    })
                    recon = recon3

        # ── 4. Connectivity ───────────────────────────
        conn, unreachable = await _check_connectivity(client)
        if unreachable:
            issues_found += 1
            # Attempt 1: wait 60s
            await _retry_connectivity_after(60)
            conn2, unreachable2 = await _check_connectivity(client)
            if not unreachable2:
                issues_auto_fixed += 1
                fix_details.append({
                    "issue": f"API unreachable: {unreachable}",
                    "attempt_1": "Wait 60s, retry",
                    "attempt_1_result": "success — all APIs responding",
                    "resolved": True, "escalated": False,
                })
                conn = conn2
            else:
                # Attempt 2: wait 120 s
                await _retry_connectivity_after(120)
                conn3, unreachable3 = await _check_connectivity(client)
                if not unreachable3:
                    issues_auto_fixed += 1
                    fix_details.append({
                        "issue": f"API unreachable: {unreachable}",
                        "attempt_1": "Wait 60s", "attempt_1_result": f"failed — {unreachable2}",
                        "attempt_2": "Wait 120s", "attempt_2_result": "success",
                        "resolved": True, "escalated": False,
                    })
                    conn = conn3
                else:
                    issues_escalated += 1
                    critical_msgs.append(f"API(s) still unreachable after retries: {unreachable3}")
                    fix_details.append({
                        "issue": f"API unreachable: {unreachable}",
                        "attempt_1": "Wait 60s", "attempt_1_result": f"failed — {unreachable2}",
                        "attempt_2": "Wait 120s", "attempt_2_result": f"failed — {unreachable3}",
                        "resolved": False, "escalated": True,
                    })
                    conn = conn3

    # Aggregate status
    status = "HEALTHY"
    if issues_escalated > 0 or critical_msgs:
        status = "CRITICAL"
    elif issues_found > 0:
        status = "WARNING"

    record: Dict[str, Any] = {
        "timestamp": ts.isoformat(),
        "status": status,
        "performance": perf,
        "data_accuracy": cty,
        "reconciliation": locals().get("recon") or {"ok": True, "failed_checks": []},
        "system_health": sys_h,
        "connectivity": conn,
        "issues_found": issues_found,
        "issues_auto_fixed": issues_auto_fixed,
        "issues_escalated": issues_escalated,
        "fix_details": fix_details,
        "mode": mode,
        "email_dispatched": {"sent_to": [], "ok": False, "error": "not_attempted"},
    }

    # Email policy: CRITICAL always; WARNING only if previous was WARNING.
    should_email = False
    if status == "CRITICAL":
        should_email = True
    elif status == "WARNING":
        prev = await db.audit_log.find_one({}, sort=[("timestamp", -1)], projection={"_id": 0, "status": 1})
        if prev and prev.get("status") == "WARNING":
            should_email = True

    if should_email:
        subj_label = "CRITICAL" if status == "CRITICAL" else "WARNING"
        subject = f"[{subj_label}] Vivo BI Dashboard — Audit Alert {ts.strftime('%Y-%m-%d %H:%M')} EAT"
        body = _format_alert_body(record, critical_msgs)
        send_res = send_alert(subject, body)
        record["email_dispatched"] = send_res

    await db.audit_log.insert_one({**record})
    return record


# ───────────────────── email body ───────────────────


def _format_alert_body(record: Dict[str, Any], critical_msgs: List[str]) -> str:
    ts_str = record["timestamp"]
    cty = record.get("data_accuracy", {}) or {}
    sys_h = record.get("system_health", {}) or {}
    perf = record.get("performance", {}) or {}
    conn = record.get("connectivity", {}) or {}
    issues = "\n".join(f"- {m}" for m in critical_msgs) or "- (see fix_details)"
    attempted = "\n".join(
        f"- {f.get('issue')} — " + ("RESOLVED" if f.get("resolved") else "ESCALATED")
        for f in record.get("fix_details", [])
    ) or "- (none)"
    zero_countries = [c for c in ("kenya", "uganda", "rwanda", "online") if (cty.get(c) or 0) <= 0]
    unreachable_apis = [k for k, v in conn.items() if not v]
    return f"""\
Vivo BI Dashboard — Automated Audit Alert
Time: {ts_str}
Status: {record['status']}

Issue detected:
{issues}

Auto-fix attempted:
{attempted}

Current system state:
- Cache hit rate:      {sys_h.get('cache_hit_rate', '?')}%
- RSS memory:          {sys_h.get('rss_mb', '?')}MB
- HeavyGuard rejections: {sys_h.get('heavyguard_rejections', '?')}
- Slowest endpoint:    {perf.get('slowest_endpoint', '?')} @ {perf.get('slowest_ms', '?')}ms
- Countries with 0 data: {zero_countries or 'none'}
- APIs unreachable:    {unreachable_apis or 'none'}

Action required:
{'Investigate the items above — auto-fix exhausted 2 attempts and could not restore service.' if record.get('issues_escalated', 0) else 'Auto-fix succeeded — informational only, no action required.'}

Next audit scheduled: {(_now_eat() + _dt.timedelta(hours=2)).strftime('%Y-%m-%d %H:%M EAT')}

—
Vivo BI Automated Monitor
{DASHBOARD_URL}
"""


# ───────────────────── daily summary ────────────────


async def send_daily_summary(db: AsyncIOMotorDatabase) -> Dict[str, Any]:
    """Compose + send the 07:00 EAT daily-summary email. Pulls the last
    24 h of audit records from Mongo and aggregates them.
    """
    now = _now_eat()
    cutoff = (now - _dt.timedelta(hours=24)).isoformat()
    cursor = db.audit_log.find(
        {"timestamp": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("timestamp", -1).limit(50)
    records = [doc async for doc in cursor]

    totals = {"HEALTHY": 0, "WARNING": 0, "CRITICAL": 0}
    auto_fixed = 0
    escalated = 0
    issues_lines: List[str] = []
    for r in records:
        totals[r.get("status", "HEALTHY")] = totals.get(r.get("status", "HEALTHY"), 0) + 1
        auto_fixed += int(r.get("issues_auto_fixed", 0))
        escalated += int(r.get("issues_escalated", 0))
        for f in r.get("fix_details", []):
            tag = "Auto-fixed" if f.get("resolved") else "Escalated"
            issues_lines.append(f"- [{r['timestamp'][11:16]} EAT] — {f.get('issue')} — {tag}")

    latest = records[0] if records else {}
    sys_h = latest.get("system_health", {}) or {}
    perf = latest.get("performance", {}) or {}
    cty = latest.get("data_accuracy", {}) or {}
    conn = latest.get("connectivity", {}) or {}

    body = f"""\
Vivo BI Dashboard — Daily Health Report
Date: {now.strftime('%Y-%m-%d')}
Period: Last 24 hours

Audit summary:
- Total audits run:                {len(records)} (expected 12)
- Healthy:                         {totals.get('HEALTHY', 0)}
- Warning:                         {totals.get('WARNING', 0)}
- Critical:                        {totals.get('CRITICAL', 0)}
- Issues auto-fixed:               {auto_fixed}
- Issues requiring human action:   {escalated}

Current system health:
- Cache hit rate:        {sys_h.get('cache_hit_rate', '?')}%
- RSS memory:            {sys_h.get('rss_mb', '?')}MB
- Slowest endpoint (cached): {perf.get('slowest_endpoint', '?')} @ {perf.get('slowest_ms', '?')}ms
- All 4 countries live:  {'Yes' if cty.get('all_non_zero') else 'No (' + ', '.join(c for c in ('kenya','uganda','rwanda','online') if (cty.get(c) or 0) <= 0) + ')'}
- All APIs reachable:    {'Yes' if all(conn.values()) else 'No (' + ', '.join(k for k,v in conn.items() if not v) + ')'}

{'Issues in last 24 hours:' if issues_lines else 'No issues detected in the last 24 hours.'}
{chr(10).join(issues_lines[:30]) if issues_lines else ''}

—
Vivo BI Automated Monitor
{DASHBOARD_URL}
"""
    subject = f"[DAILY REPORT] Vivo BI Dashboard Health — {now.strftime('%Y-%m-%d')}"
    return send_alert(subject, body)
