"""Iter 78 — Refined self-audit with correct frontend endpoint paths."""
import os
import time
import json
import requests

BASE_URL = os.environ.get("BASE_URL", "https://bi-platform-2.preview.emergentagent.com")
EMAIL = "admin@vivofashiongroup.com"
PW = "VivoAdmin!2026"

# Each page's top 1-2 first-paint endpoints (verified against frontend grep)
PAGES = [
    ("Overview",         [("kpis", "/api/kpis"),
                          ("daily-trend", "/api/daily-trend"),
                          ("bootstrap", "/api/bootstrap/overview")]),
    ("Sales Summary",    [("total-sales-summary", "/api/analytics/total-sales-summary?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Locations",        [("sales-summary", "/api/sales-summary?date_from=2026-04-16&date_to=2026-05-14"),
                          ("stock-to-sales-by-cat", "/api/analytics/stock-to-sales-by-category?date_from=2026-04-16&date_to=2026-05-14"),
                          ("stock-to-sales-by-sub", "/api/analytics/stock-to-sales-by-subcat?date_from=2026-04-16&date_to=2026-05-14"),
                          ("weekday-pattern", "/api/footfall/weekday-pattern?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Stock to Sales",   [("stock-to-sales-by-sub", "/api/analytics/stock-to-sales-by-subcat?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Replenishments",   [("replenishment-report", "/api/analytics/replenishment-report")]),
    ("IBT Store→Store",  [("ibt-suggestions", "/api/analytics/ibt-suggestions?date_from=2026-04-16&date_to=2026-05-14")]),
    ("IBT Warehouse",    [("ibt-warehouse-Kenya", "/api/analytics/ibt-warehouse-to-store?country=Kenya"),
                          ("ibt-warehouse-Uganda","/api/analytics/ibt-warehouse-to-store?country=Uganda")]),
    ("Allocations",      [("alloc-stores", "/api/allocations/stores"),
                          ("alloc-sizes", "/api/allocations/sizes")]),
    ("SOR",              [("sor-all-styles", "/api/analytics/sor-all-styles?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Customers",        [("customers", "/api/customers?date_from=2026-04-16&date_to=2026-05-14&limit=200")]),
    ("Footfall",         [("footfall", "/api/footfall?date_from=2026-04-16&date_to=2026-05-14"),
                          ("weekday-pattern", "/api/footfall/weekday-pattern?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Targets",          [("monthly-targets", "/api/analytics/monthly-targets")]),
    ("Completed Moves",  [("ibt-completed", "/api/ibt/completed")]),
    ("Products",         [("top-skus", "/api/top-skus?date_from=2026-04-16&date_to=2026-05-14&limit=200")]),
    ("Re-Order (L-10)",  [("re-order-list", "/api/analytics/re-order-list?date_from=2026-04-16&date_to=2026-05-14")]),
    ("Inventory",        [("inventory-summary", "/api/analytics/inventory-summary")]),
    ("Pricing",          [("aged-stock", "/api/analytics/aged-stock?date_from=2026-04-16&date_to=2026-05-14")]),
    ("CEO Report",       [("ceo-report", "/api/analytics/ceo-report?date_from=2026-04-16&date_to=2026-05-14")]),
]

THRESHOLDS = {
    # warm-call SLA. >2s = warn, >5s = fail. Some endpoints have higher budgets.
    "/api/analytics/replenishment-report": 3000,
    "/api/analytics/sor-all-styles": 2500,
    "/api/analytics/ibt-suggestions": 1500,
    "/api/analytics/ibt-warehouse-to-store": 500,
    "/api/customers": 1500,
}


def login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PW}, timeout=30)
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token") or d.get("session_token")


def hit(token, path, timeout=120):
    h = {"Authorization": f"Bearer {token}"}
    t0 = time.perf_counter()
    try:
        r = requests.get(f"{BASE_URL}{path}", headers=h, timeout=timeout)
        return r.status_code, round((time.perf_counter() - t0) * 1000, 1), len(r.content)
    except Exception as e:
        return f"ERR", round((time.perf_counter() - t0) * 1000, 1), 0


def main():
    token = login()
    print(f"\n{'=' * 92}\nFULL SELF-AUDIT — {BASE_URL}\n{'=' * 92}\n")
    print(f"{'PAGE':<22s} {'ENDPOINT':<28s} {'COLD':>10s} {'WARM':>10s}  HTTP  STATUS")
    print("-" * 92)
    out = []
    for page, eps in PAGES:
        for label, path in eps:
            cold = hit(token, path)
            time.sleep(0.4)
            warm = hit(token, path)
            warm_ms = warm[1] if isinstance(warm[1], (int, float)) else 99999
            # SLA-aware: use specific budget if defined, else 2 s/5 s defaults.
            base = path.split("?")[0]
            budget = next((v for k, v in THRESHOLDS.items() if k in base), 2000)
            warn_at = budget
            fail_at = budget * 2.5
            icon = "OK" if warm_ms < warn_at else ("WARN" if warm_ms < fail_at else "FAIL")
            print(f"{page:<22s} {label:<28s} {cold[1]:>8.1f}ms {warm[1]:>8.1f}ms  {cold[0]}/{warm[0]}  {icon}")
            out.append({"page": page, "label": label, "path": path,
                        "cold_ms": cold[1], "warm_ms": warm[1],
                        "http_cold": cold[0], "http_warm": warm[0],
                        "budget_ms": warn_at, "status": icon})
    with open("/tmp/full_audit_v2.json", "w") as f:
        json.dump(out, f, indent=2, default=str)
    print("\nReport → /tmp/full_audit_v2.json")


if __name__ == "__main__":
    main()
