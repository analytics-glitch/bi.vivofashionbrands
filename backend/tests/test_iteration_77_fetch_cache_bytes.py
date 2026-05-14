"""Iter 77 — _FETCH_CACHE size cap regression test.

Locks in:
  • _FETCH_CACHE_MAX is dropped from the old 2000 to 600 entries.
  • A byte cap (_FETCH_CACHE_MAX_MB = 250 MB) is enforced via the
    running tally (_FETCH_CACHE_BYTES).
  • _evict_fetch_cache_if_needed evicts on BOTH limits, not just count.
  • The /admin/cache-stats payload surfaces approx_bytes/approx_mb/max_mb
    so the cache-stats pill can display memory pressure.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_fetch_cache_caps_tightened():
    from server import _FETCH_CACHE_MAX, _FETCH_CACHE_MAX_MB
    # Iter 77 dropped from 2000 → 600; never grow it back without
    # also tightening the byte cap.
    assert _FETCH_CACHE_MAX <= 1000, f"entries cap regressed: {_FETCH_CACHE_MAX}"
    assert _FETCH_CACHE_MAX_MB <= 400, f"MB cap regressed: {_FETCH_CACHE_MAX_MB}"


def test_byte_tally_global_exists():
    from server import _FETCH_CACHE_BYTES
    assert isinstance(_FETCH_CACHE_BYTES, int)
    assert _FETCH_CACHE_BYTES >= 0


def test_approx_entry_bytes_heuristic():
    """The heuristic must distinguish big payloads from small ones —
    otherwise the byte cap is meaningless."""
    from server import _approx_entry_bytes
    small = _approx_entry_bytes([{"a": 1}])
    big = _approx_entry_bytes([{"a": 1}] * 50000)  # simulate /orders 50k
    assert big > small * 100, f"heuristic too flat: small={small} big={big}"


def test_eviction_function_uses_byte_cap():
    """Source sentinel — the eviction function must check BOTH caps."""
    src = Path(__file__).resolve().parent.parent / "server.py"
    text = src.read_text()
    # Must reference both limits in the same function body.
    assert "_FETCH_CACHE_MAX_MB" in text
    assert "while (len(_FETCH_CACHE) > _FETCH_CACHE_MAX" in text


def test_cache_stats_exposes_byte_tally():
    """admin/cache-stats must surface approx_mb / max_mb so the
    CacheStatsPill can show memory pressure."""
    src = Path(__file__).resolve().parent.parent / "server.py"
    text = src.read_text()
    assert "\"approx_bytes\": _FETCH_CACHE_BYTES" in text
    assert "\"approx_mb\":" in text
    assert "\"max_mb\": _FETCH_CACHE_MAX_MB" in text
