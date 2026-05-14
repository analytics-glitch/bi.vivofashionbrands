"""Section 1 — Performance Audit re-run.

Verifies cold + cached latency for the critical endpoints after the
IBT MongoDB precompute fix.

Target SLAs:
  • /api/kpis                                    < 500ms cached
  • /api/analytics/ibt-warehouse-to-store        < 500ms cached (was 29s)
  • /api/sor                                     < 2s cached
  • /api/analytics/replenishment-report          < 3s cached
"""
import os
import time
import json
import requests

BASE_URL = os.environ.get(
    "BASE_URL", "https://bi-platform-2.preview.emergentagent.com"
)
EMAIL = "admin@vivofashiongroup.com"
PASSWORD = "VivoAdmin!2026"


def login() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("access_token") or data.get("token") or data["session_token"]


def time_call(url: str, headers: dict, label: str, timeout: int = 90):
    t0 = time.perf_counter()
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        ms = (time.perf_counter() - t0) * 1000
        size = len(r.content)
        return {
            "label": label,
            "status": r.status_code,
            "ms": round(ms, 1),
            "kb": round(size / 1024, 1),
        }
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        return {"label": label, "status": "ERR", "ms": round(ms, 1), "err": str(e)[:120]}


def main():
    token = login()
    h = {"Authorization": f"Bearer {token}"}

    endpoints = [
        ("/api/kpis", "kpis"),
        ("/api/analytics/ibt-warehouse-to-store", "ibt-warehouse-to-store"),
        ("/api/sor", "sor"),
        ("/api/analytics/replenishment-report", "replenishment-report"),
    ]

    print("\n" + "=" * 70)
    print(f"Section 1 Performance Audit — {BASE_URL}")
    print("=" * 70)

    print("\n--- COLD (first call) ---")
    cold = []
    for url, label in endpoints:
        r = time_call(f"{BASE_URL}{url}", h, label)
        cold.append(r)
        print(f"  {label:32s} {r['status']!s:>4} {r['ms']:>8.1f}ms  {r.get('kb', '-')}KB")

    # Allow brief cooldown
    time.sleep(2)

    print("\n--- WARM (second call, should hit cache) ---")
    warm = []
    for url, label in endpoints:
        r = time_call(f"{BASE_URL}{url}", h, label)
        warm.append(r)
        print(f"  {label:32s} {r['status']!s:>4} {r['ms']:>8.1f}ms  {r.get('kb', '-')}KB")

    print("\n--- WARM #3 (third call, fully primed) ---")
    warm3 = []
    for url, label in endpoints:
        r = time_call(f"{BASE_URL}{url}", h, label)
        warm3.append(r)
        print(f"  {label:32s} {r['status']!s:>4} {r['ms']:>8.1f}ms  {r.get('kb', '-')}KB")

    print("\n" + "=" * 70)
    print("VERDICT")
    print("=" * 70)
    sla = {
        "kpis": 500,
        "ibt-warehouse-to-store": 500,
        "sor": 2000,
        "replenishment-report": 3000,
    }
    all_pass = True
    for c, w, w3 in zip(cold, warm, warm3):
        label = c["label"]
        ok = isinstance(w3.get("ms"), (int, float)) and w3["ms"] < sla[label] and w3["status"] == 200
        flag = "PASS" if ok else "FAIL"
        if not ok:
            all_pass = False
        print(f"  [{flag}] {label:32s} target<{sla[label]}ms  cold={c['ms']}ms warm={w['ms']}ms warm3={w3['ms']}ms")

    print("\n" + ("ALL GREEN" if all_pass else "SOME ENDPOINTS REGRESSED"))
    return {"cold": cold, "warm": warm, "warm3": warm3}


if __name__ == "__main__":
    out = main()
    with open("/tmp/audit_section1.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\nFull JSON saved to /tmp/audit_section1.json")
