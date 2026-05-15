"""Redis-backed shared cache for the Vivo BI dashboard.

DESIGN
======
The dashboard runs N replicas behind a load balancer. Each pod has its
own in-memory `_FETCH_CACHE`, `_kpi_stale_cache`, `_sku_breakdown_cache`,
`_location_breakdown_cache`, `_repl_cache`, `_perf_rank_cache`. When pod A
serves a warm response, pods B/C still pay the cold cost on the same
upstream call. After scaling out, or after a single pod restart, users
notice a cold-load lottery.

This module gives us a **shared write-through layer** so warm caches
flow between pods within milliseconds. It is INTENTIONALLY thin:

  - Two operations: `get(key)` and `set(key, value, ttl_seconds)`.
  - JSON-encoded values (Mongo-style — handles everything our caches
    store today: lists, dicts, primitives, ISO date strings).
  - Namespaced under the `vivo:` prefix so a shared Upstash instance
    can be used by other apps without collision.
  - **Graceful degradation**: if Redis is unreachable / not configured,
    every call short-circuits to `None` and the calling code falls back
    to its in-process cache. No exceptions ever escape this module.
  - Failures auto-disable for 60 s so a brief Redis blip doesn't make
    every request pay the connect-timeout cost.
  - **Iter 84c — quota observability**: Upstash returns its monthly
    request-limit usage in the error string ("Limit: 500000, Usage:
    NNN"). We parse it on every op failure so the audit service can
    expose a `redis_quota_pct` line in the daily/critical email and
    warn the user *before* the cap auto-disables the cache.

USAGE
=====
Treat Redis as a SECOND-CHANCE for the in-process cache, not a
replacement. The existing per-process dicts stay — they're free and
serve same-pod traffic at zero RTT. The Redis layer is what makes
*cross-pod* warm-cache sharing work.

Typical pattern (see /app/backend/server.py for live examples):

    hit = _FETCH_CACHE.get(cache_key)              # in-process: fastest
    if hit and not stale(hit): return hit[1]

    rhit = await rc.get(redis_key)                  # cross-pod: 10-50 ms
    if rhit is not None:
        _FETCH_CACHE[cache_key] = (time.time(), rhit)  # populate L1
        return rhit

    data = await _fetch_upstream(...)               # cold: 500 ms - 5 s
    _FETCH_CACHE[cache_key] = (time.time(), data)
    asyncio.create_task(rc.set(redis_key, data, ttl))  # fire-and-forget
    return data
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any, Dict, Optional

try:
    import redis.asyncio as redis_async  # type: ignore
except ImportError:  # pragma: no cover — explicit failure beats AttributeError
    redis_async = None  # type: ignore

logger = logging.getLogger("redis_cache")

_KEY_PREFIX = "vivo:"
_CONNECT_RETRY_AFTER_SEC = 60  # cooldown after a connection failure
_DEFAULT_SOCKET_TIMEOUT = 3.0   # seconds — cap each op cleanly
_VALUE_MAX_BYTES = 4 * 1024 * 1024  # 4 MB — Upstash free tier per-key limit


class RedisCache:
    """Singleton-style wrapper around redis.asyncio. Never raises."""

    def __init__(self) -> None:
        self._client: Optional["redis_async.Redis"] = None
        self._url: Optional[str] = os.environ.get("REDIS_URL")
        self._enabled: bool = bool(self._url) and redis_async is not None
        self._disabled_until: float = 0.0
        self._connect_lock = asyncio.Lock()
        # Iter 84c — quota observability. Upstash returns "Limit: N,
        # Usage: M" in the error string when the monthly request cap is
        # hit. We capture these so the audit service can warn the user
        # BEFORE the cache auto-disables.
        self._quota_limit: Optional[int] = None
        self._quota_usage: Optional[int] = None
        self._quota_observed_at: Optional[float] = None  # epoch seconds
        self._quota_exhausted: bool = False
        if not self._url:
            logger.info("[redis] REDIS_URL not set — shared cache disabled")
        elif redis_async is None:
            logger.warning("[redis] redis library not installed — shared cache disabled")

    # ── connection ────────────────────────────────────────────────────
    async def _get_client(self) -> Optional["redis_async.Redis"]:
        if not self._enabled:
            return None
        if time.time() < self._disabled_until:
            return None
        if self._client is not None:
            return self._client
        async with self._connect_lock:
            if self._client is not None:
                return self._client
            try:
                self._client = redis_async.from_url(
                    self._url,
                    decode_responses=False,
                    socket_timeout=_DEFAULT_SOCKET_TIMEOUT,
                    socket_connect_timeout=_DEFAULT_SOCKET_TIMEOUT,
                    retry_on_timeout=False,
                    health_check_interval=30,
                )
                # Eager PING so a bad URL fails NOW (during startup),
                # not on the first user request. Cheap (~1 RTT).
                await self._client.ping()
                logger.info("[redis] connected to %s", self._mask_url())
                return self._client
            except Exception as e:
                logger.warning("[redis] connect failed (%s) — disabling for %ds", e, _CONNECT_RETRY_AFTER_SEC)
                self._client = None
                self._disabled_until = time.time() + _CONNECT_RETRY_AFTER_SEC
                return None

    def _mask_url(self) -> str:
        if not self._url:
            return "<none>"
        try:
            # rediss://default:PASS@host:port → rediss://default:***@host:port
            head, sep, tail = self._url.partition("@")
            if not sep:
                return self._url
            scheme_user, _, _pwd = head.rpartition(":")
            return f"{scheme_user}:***@{tail}"
        except Exception:
            return "<masked>"

    # ── ops ───────────────────────────────────────────────────────────
    async def get(self, key: str) -> Optional[Any]:
        """Return decoded value, or None on miss/error/timeout."""
        client = await self._get_client()
        if client is None:
            return None
        try:
            raw = await client.get(_KEY_PREFIX + key)
        except Exception as e:
            self._on_op_failure("get", e)
            return None
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception as e:
            logger.warning("[redis] decode failed for %s: %s", key, e)
            return None

    async def set(self, key: str, value: Any, ttl_seconds: int) -> bool:
        """Encode + write with TTL. Returns True on success, False on
        unreachable / payload-too-big / encode error. Never raises."""
        client = await self._get_client()
        if client is None:
            return False
        try:
            payload = json.dumps(value, default=str)
        except Exception as e:
            logger.warning("[redis] encode failed for %s: %s", key, e)
            return False
        if len(payload) > _VALUE_MAX_BYTES:
            logger.warning("[redis] skip %s — payload %d B > %d B cap",
                           key, len(payload), _VALUE_MAX_BYTES)
            return False
        try:
            await client.set(_KEY_PREFIX + key, payload, ex=ttl_seconds)
            return True
        except Exception as e:
            self._on_op_failure("set", e)
            return False

    async def delete(self, key: str) -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            await client.delete(_KEY_PREFIX + key)
        except Exception as e:
            self._on_op_failure("delete", e)

    async def delete_prefix(self, key_prefix: str) -> int:
        """Bulk-delete every key under `vivo:{key_prefix}*`. Used by the
        admin /flush-kpi-cache endpoint to purge a poisoned /kpis blob
        across all sibling pods. Returns the count deleted (0 on error
        or when Redis is disabled).
        """
        client = await self._get_client()
        if client is None:
            return 0
        deleted = 0
        try:
            pattern = _KEY_PREFIX + key_prefix + "*"
            async for k in client.scan_iter(match=pattern, count=200):
                await client.delete(k)
                deleted += 1
            return deleted
        except Exception as e:
            self._on_op_failure("delete_prefix", e)
            return deleted

    # Iter 84c — Upstash uses this exact error string when the monthly
    # request limit is exceeded:
    #   "max requests limit exceeded. Limit: 500000, Usage: 500000. ..."
    # Parse out the numbers so the audit service can render a usable
    # warning ("you're at 90 % of your Redis monthly quota").
    _QUOTA_RE = re.compile(
        r"max requests limit exceeded.*?Limit:\s*(\d+).*?Usage:\s*(\d+)",
        re.IGNORECASE,
    )

    def _maybe_parse_quota(self, err_text: str) -> None:
        """Extract Limit / Usage from an Upstash quota-exhaustion error.
        No-op when the error string doesn't match the quota pattern."""
        try:
            m = self._QUOTA_RE.search(err_text or "")
            if not m:
                return
            limit = int(m.group(1))
            usage = int(m.group(2))
            self._quota_limit = limit
            self._quota_usage = usage
            self._quota_observed_at = time.time()
            self._quota_exhausted = usage >= limit
        except Exception:
            # Never raise — observability must never break the cache.
            pass

    def _on_op_failure(self, op: str, e: Exception) -> None:
        # Disable for a short window so a Redis hiccup doesn't make
        # every subsequent request pay the timeout. Re-enables auto.
        err_text = str(e)
        self._maybe_parse_quota(err_text)
        logger.warning("[redis] %s failed (%s) — disabling for %ds",
                       op, e, _CONNECT_RETRY_AFTER_SEC)
        self._client = None
        self._disabled_until = time.time() + _CONNECT_RETRY_AFTER_SEC

    def quota_status(self) -> Dict[str, Any]:
        """Returns a snapshot of the Upstash request-quota state.

        Fields:
          enabled            — Redis configured at all?
          known              — has Upstash ever told us our quota?
          limit              — monthly request cap (e.g. 500_000 on the
                               free tier)
          usage              — requests consumed so far this month
          pct                — usage / limit (rounded to 1 dp)
          exhausted          — usage >= limit (cache is currently auto-
                               disabled by Upstash itself)
          observed_age_sec   — how long ago we last saw a usage figure
                               (None if we've never seen one)
          status             — "ok" | "warning" (>=80 %) | "critical"
                               (>=95 %) | "exhausted" | "unknown"
        """
        out: Dict[str, Any] = {
            "enabled": self._enabled,
            "known": self._quota_limit is not None,
            "limit": self._quota_limit,
            "usage": self._quota_usage,
            "pct": None,
            "exhausted": bool(self._quota_exhausted),
            "observed_age_sec": (
                int(time.time() - self._quota_observed_at)
                if self._quota_observed_at else None
            ),
            "status": "unknown",
        }
        if self._quota_limit and self._quota_usage is not None:
            pct = round(self._quota_usage / max(self._quota_limit, 1) * 100, 1)
            out["pct"] = pct
            if self._quota_exhausted or pct >= 100:
                out["status"] = "exhausted"
            elif pct >= 95:
                out["status"] = "critical"
            elif pct >= 80:
                out["status"] = "warning"
            else:
                out["status"] = "ok"
        elif not self._enabled:
            out["status"] = "disabled"
        return out

    @property
    def enabled(self) -> bool:
        return self._enabled and time.time() >= self._disabled_until

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None


# Module-level singleton — import this from server.py.
rc = RedisCache()
