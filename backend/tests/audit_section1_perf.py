"""Section 1 — Performance Audit (CI-ready).

Verifies cold + cached latency for the critical endpoints. Designed to
run as a post-deploy smoke test in CI: exits with a non-zero code if
ANY endpoint breaches its SLA on the fully-primed (warm3) call.

Run locally:
    python backend/tests/audit_section1_perf.py

Run in CI (post-deploy):
    PERF_AUDIT_BASE_URL=https://app.example.com \
    PERF_AUDIT_EMAIL=admin@... \
    PERF_AUDIT_PASSWORD=... \
    PERF_AUDIT_WARMUP_SLEEP=120 \
    python backend/tests/audit_section1_perf.py

Exit codes:
    0   all endpoints under SLA on warm3
    1   one or more endpoints regressed
    2   could not authenticate (creds wrong / app down)

Target SLAs (warm3):
  • /api/kpis                                    < 500 ms
  • /api/analytics/ibt-warehouse-to-store        < 500 ms
  • /api/sor                                     < 2000 ms
  • /api/analytics/replenishment-report          < 3000 ms
"""
import json
import os
import sys
import time

import requests

# ── CI-configurable knobs ────────────────────────────────────────────
# All defaults match the preview environment so a local `python ...`
# run still works without env vars. CI should override every one.
BASE_URL = os.environ.get(
    "PERF_AUDIT_BASE_URL",
    os.environ.get("BASE_URL", "https://bi-platform-2.preview.emergentagent.com"),
).rstrip("/")
EMAIL = os.environ.get("PERF_AUDIT_EMAIL", "admin@vivofashiongroup.com")
PASSWORD = os.environ.get("PERF_AUDIT_PASSWORD", "VivoAdmin!2026")
# Pre-audit sleep so the post-deploy warmup task has time to finish
# pre-warming caches. 0 disables. CI should set this to ~120 s.
WARMUP_SLEEP = int(os.environ.get("PERF_AUDIT_WARMUP_SLEEP", "0"))
# Where to drop the JSON report. CI artifact-collects this.
REPORT_PATH = os.environ.get("PERF_AUDIT_REPORT", "/tmp/audit_section1.json")

SLA_MS = {
    "kpis": 500,
    "ibt-warehouse-to-store": 500,
    "sor": 2000,
    "replenishment-report": 3000,
}
ENDPOINTS = [
    ("/api/kpis", "kpis"),
    ("/api/analytics/ibt-warehouse-to-store", "ibt-warehouse-to-store"),
    ("/api/sor", "sor"),
    ("/api/analytics/replenishment-report", "replenishment-report"),
]


def login() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    tok = data.get("access_token") or data.get("token") or data.get("session_token")
    if not tok:
        raise RuntimeError(f"login response missing token field: {list(data)}")
    return tok


def time_call(url: str, headers: dict, label: str, timeout: int = 90) -> dict:
    t0 = time.perf_counter()
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        ms = (time.perf_counter() - t0) * 1000
        return {
            "label": label,
            "status": r.status_code,
            "ms": round(ms, 1),
            "kb": round(len(r.content) / 1024, 1),
        }
    except Exception as e:  # noqa: BLE001 — CI wants to see ANY failure
        ms = (time.perf_counter() - t0) * 1000
        return {"label": label, "status": "ERR", "ms": round(ms, 1), "err": str(e)[:120]}


def _run_round(name: str, headers: dict) -> list:
    print(f"\n--- {name} ---")
    out = []
    for url, label in ENDPOINTS:
        r = time_call(f"{BASE_URL}{url}", headers, label)
        out.append(r)
        print(f"  {label:32s} {r['status']!s:>4} {r['ms']:>8.1f}ms  {r.get('kb', '-')}KB")
    return out


def main() -> int:
    print("=" * 70)
    print(f"Section 1 Performance Audit — {BASE_URL}")
    print("=" * 70)

    if WARMUP_SLEEP > 0:
        print(f"\nWaiting {WARMUP_SLEEP}s for post-deploy warmup …")
        time.sleep(WARMUP_SLEEP)

    try:
        token = login()
    except Exception as e:  # noqa: BLE001
        print(f"\nFATAL — could not authenticate against {BASE_URL}: {e}")
        return 2

    h = {"Authorization": f"Bearer {token}"}
    cold = _run_round("COLD (first call)", h)
    time.sleep(2)  # brief breath between rounds
    warm = _run_round("WARM (second call)", h)
    warm3 = _run_round("WARM #3 (fully primed)", h)

    print("\n" + "=" * 70)
    print("VERDICT (warm3 is the SLA gate)")
    print("=" * 70)
    failures = []
    for c, w, w3 in zip(cold, warm, warm3):
        label = c["label"]
        sla = SLA_MS[label]
        ok = (
            isinstance(w3.get("ms"), (int, float))
            and w3["ms"] < sla
            and w3["status"] == 200
        )
        flag = "PASS" if ok else "FAIL"
        print(f"  [{flag}] {label:32s} target<{sla}ms  "
              f"cold={c['ms']}ms warm={w['ms']}ms warm3={w3['ms']}ms")
        if not ok:
            failures.append({"label": label, "sla_ms": sla, "warm3": w3})

    report = {
        "base_url": BASE_URL,
        "sla_ms": SLA_MS,
        "cold": cold,
        "warm": warm,
        "warm3": warm3,
        "failures": failures,
    }
    try:
        with open(REPORT_PATH, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nJSON report → {REPORT_PATH}")
    except OSError as e:
        print(f"\n(could not write report to {REPORT_PATH}: {e})")

    if failures:
        print("\nFAIL — performance regression detected, blocking deploy.")
        return 1
    print("\nALL GREEN — performance budget intact.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
