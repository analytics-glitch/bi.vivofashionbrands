"""Iter 78 — Standing 2-hour self-audit (cron-ready).

Produces the EXACT report format requested by the CEO:

  Performance Pulse — every endpoint, response time, ✅/⚠️/❌
  Data Accuracy Pulse — all 4 countries non-zero today
  System Health Pulse — cache hit %, RSS, HeavyGuard, snapshots
  Login & Connectivity — login page, API health, upstream APIs

Auto-fix protocol:
  • ❌ endpoint > 2 s cached      → POST /api/admin/flush-kpi-cache, retry
  • ❌ country shows 0            → POST /api/admin/flush-kpi-cache, retry
  • ❌ cache hit rate < 50%       → POST /api/admin/flush-kpi-cache, retry
  • ❌ RSS > 1100 MB              → log a warning (no destructive fix)
  • ❌ login page unreachable     → CRITICAL alert, no auto-fix possible

After auto-fix, re-runs the affected check. If still ❌ after 2 attempts,
emits CRITICAL line at the top of the summary.

USAGE
-----

Run once (CI / cron / manual):

    PERF_AUDIT_BASE_URL=https://bi.vivofashionbrands.com \\
    PERF_AUDIT_EMAIL=admin@vivofashiongroup.com \\
    PERF_AUDIT_PASSWORD=$VIVO_ADMIN_PW \\
    python backend/tests/audit_2hour.py

Cron (every 2 h at HH:00 EAT — which is UTC -3):

    0 */2 * * *  cd /app && python backend/tests/audit_2hour.py >> /var/log/vivo_audit.log 2>&1

GitHub Actions: see .github/workflows/perf-audit-2hour.yml (template).

Output: prints the summary to STDOUT. Exit code:
  0 = ALL HEALTHY (or recovered after auto-fix)
  1 = at least one ❌ remained after auto-fix
  2 = could not authenticate (creds wrong / app down)
"""
import os
import sys
import time
import json
import datetime as _dt
import requests

# --- CONFIG ----------------------------------------------------------
BASE_URL = os.environ.get(
    "PERF_AUDIT_BASE_URL", "https://bi-platform-2.preview.emergentagent.com"
).rstrip("/")
EMAIL = os.environ.get("PERF_AUDIT_EMAIL", "admin@vivofashiongroup.com")
PASSWORD = os.environ.get("PERF_AUDIT_PASSWORD", "VivoAdmin!2026")
# Each endpoint's SLA (warm-call, ms). The audit script makes 2 calls
# back-to-back per endpoint and judges the SECOND call against this SLA.
ENDPOINTS = [
    ("/api/kpis", 500),
    ("/api/sales-summary?date_from={df}&date_to={dt}", 500),
    ("/api/country-summary?date_from={df}&date_to={dt}", 500),
    ("/api/analytics/ibt-warehouse-to-store?country=Kenya", 500),
    ("/api/analytics/sor-all-styles?date_from={df}&date_to={dt}", 2000),
    ("/api/analytics/replenishment-report", 3000),
]
COUNTRIES = ["Kenya", "Uganda", "Rwanda", "Online"]
# Upstream APIs the dashboard depends on. /admin/diagnostics in
# preview reports their reachability; if that route doesn't exist
# (e.g. older deployments), the connectivity section degrades to ⚠️.
UPSTREAMS = [
    ("Vivo BI API",     "/api/diagnostics/upstream/vivo"),
    ("Attendance API",  "/api/diagnostics/upstream/attendance"),
    ("Training API",    "/api/diagnostics/upstream/training"),
]
EAT_OFFSET = _dt.timezone(_dt.timedelta(hours=3))

# --- helpers ---------------------------------------------------------

def _eat_now():
    return _dt.datetime.now(EAT_OFFSET)


def _login(session: requests.Session):
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=20,
    )
    r.raise_for_status()
    d = r.json()
    tok = d.get("access_token") or d.get("token") or d.get("session_token")
    if not tok:
        raise RuntimeError("login response missing token")
    session.headers["Authorization"] = f"Bearer {tok}"


def _hit(session: requests.Session, path: str, timeout: int = 90):
    t0 = time.perf_counter()
    try:
        r = session.get(f"{BASE_URL}{path}", timeout=timeout)
        ms = (time.perf_counter() - t0) * 1000
        return r.status_code, round(ms, 1), r
    except Exception as e:  # noqa: BLE001
        return f"ERR:{type(e).__name__}", round((time.perf_counter() - t0) * 1000, 1), None


def _icon(ms: float, sla: int) -> str:
    if not isinstance(ms, (int, float)):
        return "❌"
    if ms < sla:
        return "✅"
    if ms < sla * 2.5:
        return "⚠️"
    return "❌"


def _flush_cache(session: requests.Session) -> bool:
    """Best-effort cache flush. Returns True if the admin endpoint
    accepted the flush (200), False otherwise."""
    try:
        r = session.post(f"{BASE_URL}/api/admin/flush-kpi-cache", timeout=15)
        return r.status_code in (200, 204)
    except Exception:
        return False


# --- audit phases ----------------------------------------------------

def _section1_performance(session, df, dt):
    """Hit every endpoint twice. Returns (lines, slowest_ms, all_pass)."""
    lines = []
    slowest = 0.0
    all_pass = True
    for raw_path, sla in ENDPOINTS:
        path = raw_path.format(df=df, dt=dt)
        _hit(session, path)          # cold
        time.sleep(0.3)
        status, ms, _ = _hit(session, path)  # cached
        icon = _icon(ms, sla)
        ok = status == 200 and icon == "✅"
        if not ok:
            all_pass = False
        if isinstance(ms, (int, float)) and ms > slowest:
            slowest = ms
        # path label trimmed for readability
        label = path.split("?")[0]
        lines.append(f"{label:<48s} — {ms:>6.0f}ms {icon}")
    return lines, slowest, all_pass


def _section2_country_data(session, today_iso):
    """Confirm every country has non-zero sales today."""
    out = []
    all_pass = True
    try:
        r = session.get(
            f"{BASE_URL}/api/country-summary",
            params={"date_from": today_iso, "date_to": today_iso},
            timeout=30,
        )
        data = r.json() if r.status_code == 200 else []
        # `data` is List[{"country": str, "total_sales": float, ...}]
        by_country = {d.get("country"): float(d.get("total_sales") or 0) for d in data}
    except Exception:
        by_country = {}
    for c in COUNTRIES:
        v = by_country.get(c, 0.0)
        # "Online" can legitimately be zero on a quiet day; mark ⚠️ rather
        # than ❌. The other three countries should always have at least
        # one transaction by mid-afternoon EAT.
        if v > 0:
            icon = "✅"
        elif c == "Online":
            icon = "⚠️"
        else:
            icon = "❌"
            all_pass = False
        out.append(f"{c:<6s} — KES {v:,.0f} {icon}")
    return out, all_pass, by_country


def _section3_system_health(session):
    """Cache stats + memory breakdown."""
    out = []
    issues = []
    try:
        cs = session.get(f"{BASE_URL}/api/admin/cache-stats", timeout=15).json()
    except Exception:
        cs = {}
    try:
        mb = session.get(f"{BASE_URL}/api/admin/memory-breakdown", timeout=15).json()
    except Exception:
        mb = {}

    hit_rate = cs.get("counters_since_boot", {}).get("hit_rate_pct", 0)
    misses_top = cs.get("miss_analysis", {}).get("top_repeat_offenders", [])
    repeat_miss = misses_top[0].get("miss_count", 0) if misses_top else 0
    rss = cs.get("process", {}).get("rss_mb", 0)
    heavy_rej = cs.get("heavy_guard", {}).get("rejections_since_boot", {})
    heavy_rej_n = sum((v or 0) for v in heavy_rej.values())

    snap_entries = 0
    try:
        # /api/admin/snapshot-count is optional; some deployments lack it.
        sn = session.get(f"{BASE_URL}/api/admin/snapshot-count", timeout=10)
        if sn.status_code == 200:
            snap_entries = int(sn.json().get("count", 0))
    except Exception:
        pass

    # ---- thresholds ----
    hr_icon = "✅" if hit_rate >= 80 else ("⚠️" if hit_rate >= 50 else "❌")
    rm_icon = "✅" if repeat_miss <= 5 else ("⚠️" if repeat_miss <= 20 else "❌")
    rss_icon = "✅" if rss < 900 else ("⚠️" if rss < 1100 else "❌")
    hv_icon = "✅" if heavy_rej_n == 0 else "⚠️"
    sn_icon = "✅" if snap_entries >= 50 else ("⚠️" if snap_entries > 0 else "❌")

    if hr_icon == "❌":
        issues.append("cache_hit_rate")
    if rss_icon == "❌":
        issues.append("rss_high")

    out.extend([
        f"Cache hit rate       — {hit_rate}% {hr_icon}",
        f"Repeat miss rate     — {repeat_miss} {rm_icon}",
        f"RSS memory           — {rss}MB {rss_icon}",
        f"HeavyGuard rejections — {heavy_rej_n} {hv_icon}",
        f"Mongo snapshots      — {snap_entries} entries {sn_icon}",
    ])
    return out, issues


def _section4_connectivity(session):
    """Login page + API health + each upstream."""
    out = []
    all_pass = True

    # Login page (HTML, no auth)
    try:
        r = requests.get(f"{BASE_URL}/login", timeout=10)
        ok = r.status_code in (200, 302, 304)
    except Exception:
        ok = False
    out.append(f"Login page       — {'✅ reachable' if ok else '❌ unreachable'}")
    if not ok:
        all_pass = False

    # API health
    try:
        r = session.get(f"{BASE_URL}/api/health", timeout=10)
        ok = r.status_code == 200
    except Exception:
        ok = False
    out.append(f"API health       — {'✅ responding' if ok else '❌ down'}")
    if not ok:
        all_pass = False

    # Upstreams (best-effort — many deployments don't have these diag routes)
    for label, path in UPSTREAMS:
        try:
            r = session.get(f"{BASE_URL}{path}", timeout=10)
            if r.status_code == 200 and (r.json() or {}).get("ok"):
                out.append(f"{label:<16s} — ✅ responding")
            elif r.status_code == 404:
                out.append(f"{label:<16s} — ⚠️ diagnostic route not deployed")
            else:
                out.append(f"{label:<16s} — ❌ down (HTTP {r.status_code})")
                all_pass = False
        except Exception:
            out.append(f"{label:<16s} — ⚠️ probe failed (network)")
    return out, all_pass


# --- main ------------------------------------------------------------

def main() -> int:
    now = _eat_now()
    today_iso = now.date().isoformat()
    # 28-day rolling window the dashboard uses by default.
    df = (now.date() - _dt.timedelta(days=28)).isoformat()
    dt_iso = today_iso

    print(f"\n═══════════════════════════════════")
    print(f"🕐 2-HOUR AUDIT — {now.strftime('%Y-%m-%d %H:%M')} EAT")
    print(f"   target: {BASE_URL}")
    print(f"═══════════════════════════════════\n")

    session = requests.Session()
    try:
        _login(session)
    except Exception as e:
        print(f"CRITICAL — could not authenticate against {BASE_URL}: {e}")
        return 2

    issues_found = 0
    issues_fixed = 0
    issues_escalated = 0
    critical_alerts: list[str] = []

    # --- 1. Performance Pulse ---
    print("1. Performance Pulse")
    perf_lines, slowest, perf_ok = _section1_performance(session, df, dt_iso)
    for l in perf_lines:
        print(f"   {l}")
    if not perf_ok:
        issues_found += 1
        # Auto-fix attempt: flush + retry once.
        flushed = _flush_cache(session)
        if flushed:
            time.sleep(8)
            perf_lines2, slowest2, perf_ok2 = _section1_performance(session, df, dt_iso)
            if perf_ok2:
                issues_fixed += 1
                slowest = slowest2
                perf_lines = perf_lines2
                perf_ok = True  # restored — summary line reflects this
                print("\n   AUTO-FIX: cache flushed + re-warmed — performance recovered ✅")
            else:
                issues_escalated += 1
                critical_alerts.append("Performance endpoints still failing after cache flush")
        else:
            issues_escalated += 1
            critical_alerts.append("Cache-flush endpoint unreachable")

    # --- 2. Data Accuracy Pulse ---
    print("\n2. Data Accuracy Pulse (today)")
    country_lines, country_ok, by_c = _section2_country_data(session, today_iso)
    for l in country_lines:
        print(f"   {l}")
    if not country_ok:
        issues_found += 1
        flushed = _flush_cache(session)
        if flushed:
            time.sleep(8)
            country_lines2, country_ok2, by_c2 = _section2_country_data(session, today_iso)
            if country_ok2:
                issues_fixed += 1
                country_ok = True
                by_c = by_c2
                print("\n   AUTO-FIX: cache flushed — country data restored ✅")
            else:
                issues_escalated += 1
                critical_alerts.append(
                    "Country/Mongo-snapshot data still zero after flush — investigate manually"
                )

    # --- 3. System Health Pulse ---
    print("\n3. System Health Pulse")
    sys_lines, sys_issues = _section3_system_health(session)
    for l in sys_lines:
        print(f"   {l}")
    if "cache_hit_rate" in sys_issues:
        issues_found += 1
        if _flush_cache(session):
            time.sleep(8)
            sys_lines2, sys_issues2 = _section3_system_health(session)
            if "cache_hit_rate" not in sys_issues2:
                issues_fixed += 1
        else:
            issues_escalated += 1
            critical_alerts.append("Hit rate below threshold and flush failed")
    if "rss_high" in sys_issues:
        # No destructive auto-fix — just log.
        issues_found += 1
        critical_alerts.append(
            f"RSS memory > 1100 MB — investigate _FETCH_CACHE / pod restart may be required"
        )
        issues_escalated += 1

    # --- 4. Login & Connectivity ---
    print("\n4. Login & Connectivity")
    conn_lines, conn_ok = _section4_connectivity(session)
    for l in conn_lines:
        print(f"   {l}")
    if not conn_ok:
        issues_found += 1
        # Connectivity issues are infra — we cannot auto-fix; escalate.
        issues_escalated += 1
        critical_alerts.append("Login page or API health endpoint unreachable")

    # --- Summary ---
    perf_summary = "All endpoints healthy" if perf_ok else "endpoint regression detected"
    print()
    print("═══════════════════════════════════")
    print(f"🕐 2-HOUR AUDIT — {now.strftime('%Y-%m-%d %H:%M')} EAT")
    print("═══════════════════════════════════")
    print(f"Performance  : {'✅' if perf_ok else '❌'} {perf_summary} (slowest: {slowest:.0f}ms)")
    print(f"Data accuracy: {'✅' if country_ok else '❌'} {sum(1 for v in by_c.values() if v > 0)}/4 countries live")
    print(f"System health: {'✅' if not sys_issues else '⚠️ '} (see Section 3)")
    print(f"Connectivity : {'✅' if conn_ok else '❌'} (see Section 4)")
    print(f"Issues found : {issues_found} ({issues_fixed} auto-fixed, {issues_escalated} escalated)")
    print("═══════════════════════════════════")

    if critical_alerts:
        print("\n🚨 CRITICAL ALERTS")
        for a in critical_alerts:
            print(f"   • {a}")

    # Optional JSON artifact for CI ingestion.
    if os.environ.get("PERF_AUDIT_REPORT"):
        try:
            with open(os.environ["PERF_AUDIT_REPORT"], "w") as f:
                json.dump({
                    "ts": now.isoformat(),
                    "base_url": BASE_URL,
                    "perf_ok": perf_ok,
                    "slowest_ms": slowest,
                    "country_data": by_c,
                    "system_issues": sys_issues,
                    "connectivity_ok": conn_ok,
                    "issues_found": issues_found,
                    "issues_fixed": issues_fixed,
                    "issues_escalated": issues_escalated,
                    "critical_alerts": critical_alerts,
                }, f, indent=2, default=str)
        except OSError:
            pass

    return 0 if (perf_ok and country_ok and conn_ok and not sys_issues) else 1


if __name__ == "__main__":
    sys.exit(main())
