"""Iter 91p+q production deploy verification script.

Run this AFTER clicking "Deploy" to confirm the production environment
mirrors the preview fixes. Specifically verifies:

  • ISS-001  — Exec Summary YTD revenue == /kpis YTD total_sales (Δ < 1 KES)
  • ISS-008  — Return rate uses Returns ÷ (Returns + Net) formula
  • ISS-013  — Heavy-guard limit for replenishment-report = 2
  • ISS-019  — IBT late-count is actionable (typically <500, not 10,000+)

Usage:
    PROD_TOKEN=<bearer> python /app/backend/tests/verify_production_91p.py

If no PROD_TOKEN env var, prompts interactively.
"""
import os
import sys
import json
import requests
from datetime import date, timedelta

PROD_URL = "https://bi.vivofashionbrands.com"


def main():
    token = os.environ.get("PROD_TOKEN")
    if not token:
        email = input("Production admin email: ").strip()
        pw = input("Production admin password: ").strip()
        r = requests.post(f"{PROD_URL}/api/auth/login",
                          json={"email": email, "password": pw}, timeout=15)
        r.raise_for_status()
        token = r.json()["token"]

    h = {"Authorization": f"Bearer {token}"}
    today = date.today()
    yesterday = today - timedelta(days=1)
    ytd_from = date(today.year, 1, 1)

    fails = []

    # ISS-001 — Exec Summary YTD revenue parity with /kpis
    kpis = requests.get(
        f"{PROD_URL}/api/kpis", headers=h,
        params={"date_from": ytd_from.isoformat(), "date_to": yesterday.isoformat()},
        timeout=30,
    ).json()
    exec_s = requests.get(f"{PROD_URL}/api/exec-summary", headers=h, timeout=60).json()
    kpi_rev = float(kpis.get("total_sales") or 0)
    exec_rev = float(exec_s.get("ytd", {}).get("kpis", {}).get("revenue", {}).get("cur") or 0)
    drift = abs(kpi_rev - exec_rev)
    status = "PASS" if drift < 1.0 else "FAIL"
    print(f"[{status}] ISS-001 YTD revenue parity: /kpis={kpi_rev:,.2f} vs exec={exec_rev:,.2f} (Δ={drift:,.2f})")
    if drift >= 1.0:
        fails.append("ISS-001")

    # ISS-008 — return rate formula
    g = float(kpis.get("gross_sales") or 0)
    n = float(kpis.get("net_sales") or 0)
    r = float(kpis.get("total_returns") or 0)
    rr_actual = float(kpis.get("return_rate") or 0)
    rr_expected = (r / (r + n) * 100) if (r + n) else 0
    rr_old = (r / g * 100) if g else 0
    fmla_ok = abs(rr_actual - rr_expected) < 0.05
    status = "PASS" if fmla_ok else "FAIL"
    print(f"[{status}] ISS-008 return rate formula: actual={rr_actual:.2f}%, "
          f"expected (new)={rr_expected:.2f}%, old={rr_old:.2f}%")
    if not fmla_ok:
        fails.append("ISS-008")

    # ISS-013 — heavy-guard limit
    cs = requests.get(f"{PROD_URL}/api/admin/cache-stats", headers=h, timeout=15).json()
    limit = (cs.get("heavy_guard") or {}).get("limits", {}).get("/analytics/replenishment-report")
    status = "PASS" if limit == 2 else "FAIL"
    print(f"[{status}] ISS-013 replenishment-report heavy-guard limit: {limit} (expected 2)")
    if limit != 2:
        fails.append("ISS-013")

    # ISS-019 — IBT late-count is actionable (post-fix typically <500)
    lc = requests.get(f"{PROD_URL}/api/ibt/late-count", headers=h, timeout=15).json()
    count = lc.get("count", -1)
    status = "PASS" if count < 1000 else "FAIL"
    print(f"[{status}] ISS-019 IBT late-count: {count} (expected <1,000 actionable; "
          f"production was 10,517 pre-fix)")
    if count >= 1000:
        fails.append("ISS-019")

    print("")
    if fails:
        print(f"❌ {len(fails)} production check(s) FAILED: {', '.join(fails)}")
        print("   → Confirm Deploy completed and try again in 60 s.")
        sys.exit(1)
    print("✅ All 4 production checks PASS — preview fixes live on bi.vivofashionbrands.com")


if __name__ == "__main__":
    main()
