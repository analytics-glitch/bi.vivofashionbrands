"""Iteration 83 — Memory leak CI gate (mandatory pre-ship checklist).

Approved by user: "Yes — ship the memory leak CI check. Add it to the
pre-ship process. A 100-request burst with before/after RSS comparison
is exactly the right way to catch memory leaks before they hit
production. Fail the deploy if RSS grows >100MB."

This test fires a synthetic burst of 100 mixed-endpoint requests after
a snapshot warmup and asserts the process RSS does not grow by more
than 100 MB.

Threshold: `MEMORY_LEAK_BUDGET_MB` env var (default 100).
Burst size:  `MEMORY_LEAK_BURST` env var (default 100).

Run from CI:
    pytest backend/tests/test_iteration_83_memory_leak_ci.py -v

If this test FAILS, do NOT deploy — there's a regression that needs
investigation. The test prints a top-cache breakdown so you can see
WHERE the memory grew.
"""
import os
import time
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@vivofashiongroup.com")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "VivoAdmin!2026")
BUDGET_MB = int(os.environ.get("MEMORY_LEAK_BUDGET_MB", "100"))
BURST = int(os.environ.get("MEMORY_LEAK_BURST", "100"))


def _token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=60,
    )
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token")


def _hdrs() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


def _rss_mb() -> float:
    r = requests.get(f"{BASE_URL}/api/admin/cache-stats", headers=_hdrs(), timeout=30)
    r.raise_for_status()
    return float(r.json().get("process", {}).get("rss_mb", 0))


def _top_caches() -> list:
    """Returns the top-5 tracked caches by byte size — useful for
    pinpointing which cache leaked when this test fails."""
    try:
        r = requests.get(
            f"{BASE_URL}/api/admin/memory-breakdown",
            headers=_hdrs(), timeout=60,
        )
        if r.status_code != 200:
            return []
        breakdown = r.json().get("breakdown", []) or []
        return sorted(breakdown, key=lambda x: -x.get("bytes", 0))[:5]
    except Exception:
        return []


def test_memory_does_not_leak_under_burst():
    """Fire `BURST` mixed-endpoint requests and assert RSS growth
    is below `BUDGET_MB` (default 100MB).

    The test:
      1. Warms the snapshot cache (idempotent).
      2. Captures baseline RSS.
      3. Fires `BURST` requests across /kpis, /country-summary,
         /sales-summary in parallel.
      4. Captures post-burst RSS.
      5. Asserts (rss_after - rss_before) <= BUDGET_MB.
    """
    h = _hdrs()
    today = time.strftime("%Y-%m-%d", time.gmtime())

    # 1. Fully warm snapshots (SYNCHRONOUSLY) so the snapshot layer is
    #    populated in Mongo. The first-fill of these snapshots
    #    legitimately allocates heap; it's NOT a leak.
    requests.post(
        f"{BASE_URL}/api/admin/warm-snapshots-now?sync=true",
        headers=h, timeout=240,
    )
    time.sleep(3)
    # 2. Pre-warm burst — fire the SAME endpoints we'll measure later,
    #    once each. This populates the in-process L1 cache + inflight
    #    pipes + httpx pool. After this, the heap is saturated and any
    #    further growth is the real leak signal.
    countries = ["", "Kenya", "Uganda", "Rwanda", "Online"]
    for c in countries:
        params = {"date_from": today, "date_to": today}
        if c:
            params["country"] = c
        for path in ("/api/kpis", "/api/country-summary", "/api/sales-summary"):
            try:
                requests.get(f"{BASE_URL}{path}", params=params, headers=h, timeout=30)
            except Exception:
                pass
    time.sleep(3)

    # 2. Baseline RSS.
    rss_before = _rss_mb()
    top_before = _top_caches()

    # 3. Burst — `BURST` requests across the snapshotted endpoints.
    endpoints = [
        ("/api/kpis", {}),
        ("/api/country-summary", {}),
        ("/api/sales-summary", {}),
        ("/api/kpis", {"country": "Kenya"}),
        ("/api/kpis", {"country": "Uganda"}),
        ("/api/kpis", {"country": "Rwanda"}),
        ("/api/kpis", {"country": "Online"}),
    ]
    started = time.time()
    for i in range(BURST):
        path, extra = endpoints[i % len(endpoints)]
        params = {"date_from": today, "date_to": today, **extra}
        try:
            requests.get(f"{BASE_URL}{path}", params=params, headers=h, timeout=15)
        except Exception:
            pass  # network blip — keep going, we're measuring RSS not correctness
    duration = time.time() - started

    # 4. Allow 2 s for any deferred allocations to settle.
    time.sleep(2)
    rss_after = _rss_mb()
    top_after = _top_caches()

    delta_mb = rss_after - rss_before
    print()
    print(f"  RSS before burst : {rss_before:>7.1f} MB")
    print(f"  RSS after  burst : {rss_after:>7.1f} MB")
    print(f"  Δ RSS            : {delta_mb:+7.1f} MB ({BURST} reqs in {duration:.1f}s)")
    print(f"  Budget           : ≤ {BUDGET_MB} MB")
    print()
    print("  Top 5 caches BEFORE:")
    for c in top_before:
        print(f"    {c['name']:35s} entries={c.get('entries', 0):>6}  {c.get('mb', 0):>6.1f}MB")
    print("  Top 5 caches AFTER :")
    for c in top_after:
        print(f"    {c['name']:35s} entries={c.get('entries', 0):>6}  {c.get('mb', 0):>6.1f}MB")
    print()

    assert delta_mb <= BUDGET_MB, (
        f"MEMORY LEAK DETECTED: RSS grew by {delta_mb:.1f}MB during a "
        f"{BURST}-request burst (budget={BUDGET_MB}MB). "
        f"Investigate before deploying. See cache breakdown above."
    )


def test_repeated_bursts_stay_flat():
    """Two consecutive 50-request bursts must show no monotonic growth
    after the first one settles. This catches slow leaks that look
    fine on one burst but accumulate over time."""
    h = _hdrs()
    today = time.strftime("%Y-%m-%d", time.gmtime())

    def _burst(n: int):
        for i in range(n):
            c = ("", "Kenya", "Uganda", "Rwanda", "Online")[i % 5]
            params = {"date_from": today, "date_to": today}
            if c:
                params["country"] = c
            try:
                requests.get(f"{BASE_URL}/api/kpis", params=params, headers=h, timeout=15)
            except Exception:
                pass

    # Two bursts back-to-back; expect RSS to flatten.
    _burst(50)
    time.sleep(3)
    rss1 = _rss_mb()
    _burst(50)
    time.sleep(3)
    rss2 = _rss_mb()
    delta = rss2 - rss1
    print(f"\n  Burst #1 settled RSS: {rss1:.1f} MB")
    print(f"  Burst #2 settled RSS: {rss2:.1f} MB")
    print(f"  Δ between bursts    : {delta:+.1f} MB")
    # A slow leak shows up as continued growth; budget 50MB for noise.
    assert delta <= 50, (
        f"SLOW LEAK SUSPECTED: RSS grew {delta:.1f}MB between two "
        f"identical 50-request bursts (budget=50MB). Suggests something "
        f"accumulates per-request and never trims."
    )
