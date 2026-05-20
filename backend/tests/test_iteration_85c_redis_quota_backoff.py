"""Iter 85c — Quota-exhausted backoff for the Upstash L2 cache.

The bug: when Upstash returned `max requests limit exceeded`, the
`_on_op_failure` handler unconditionally set the cooldown to 60 s. The
next request 60 s later would attempt a connection / SET, again costing
one command against the (already-zero) quota and re-disabling the cache.
That was the root cause of `l2_redis_hits == 0` even after the audit
emails warned about exhaustion — the cache was self-perpetuating the
quota burn.

The fix: when `_quota_exhausted == True` (we've parsed the Upstash error
and know we're over the cap), back off for 30 minutes instead of 60 s.
Other transient errors keep the 60 s cooldown.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from redis_cache import RedisCache, _QUOTA_EXHAUSTED_COOLDOWN_SEC, _CONNECT_RETRY_AFTER_SEC


def _build():
    rc = RedisCache()
    # Fake an enabled client so the cooldown code path runs.
    rc._enabled = True
    rc._url = "rediss://default:x@example.upstash.io:6379"
    return rc


def test_quota_exhausted_triggers_30min_backoff():
    rc = _build()
    err = Exception("max requests limit exceeded. Limit: 500000, Usage: 500000")
    t0 = time.time()
    rc._on_op_failure("set", err)

    # Quota was correctly parsed.
    assert rc._quota_exhausted is True
    assert rc._quota_limit == 500000
    assert rc._quota_usage == 500000

    # Disabled-until must be ~30 min from now, NOT 60 s.
    delta = rc._disabled_until - t0
    assert _QUOTA_EXHAUSTED_COOLDOWN_SEC - 5 <= delta <= _QUOTA_EXHAUSTED_COOLDOWN_SEC + 5, (
        f"expected ~{_QUOTA_EXHAUSTED_COOLDOWN_SEC}s backoff, got {delta:.1f}s"
    )
    # Sanity: the cooldown is meaningfully larger than the default.
    assert delta > _CONNECT_RETRY_AFTER_SEC * 10


def test_non_quota_error_keeps_60s_backoff():
    """A regular socket / connection blip must still use the SHORT 60 s
    cooldown — extending that to 30 min for every blip would make pods
    unnecessarily downgrade themselves out of the L2 cache."""
    rc = _build()
    err = Exception("Connection reset by peer")
    t0 = time.time()
    rc._on_op_failure("get", err)

    assert rc._quota_exhausted is False
    delta = rc._disabled_until - t0
    assert _CONNECT_RETRY_AFTER_SEC - 5 <= delta <= _CONNECT_RETRY_AFTER_SEC + 5, (
        f"expected ~{_CONNECT_RETRY_AFTER_SEC}s backoff, got {delta:.1f}s"
    )


def test_quota_recovery_uses_short_backoff_again():
    """If Upstash quota resets (e.g., user topped up), the next failure
    must use the short 60 s cooldown, not stay stuck on 30 min."""
    rc = _build()
    # First — quota exhausted.
    rc._on_op_failure("set", Exception("max requests limit exceeded. Limit: 500000, Usage: 500000"))
    assert rc._quota_exhausted is True

    # Simulate the next failure: a normal hiccup AFTER quota recovered.
    # We expose the recovery by manually flipping the flag (real life:
    # _maybe_parse_quota detects usage < limit on the next observed
    # error, which won't be a quota message, so we drop the flag here).
    rc._quota_exhausted = False
    t0 = time.time()
    rc._on_op_failure("set", Exception("ETIMEDOUT"))
    delta = rc._disabled_until - t0
    assert delta <= _CONNECT_RETRY_AFTER_SEC + 5
