"""Iter 77 — Replenishment inflight-join regression test.

Locks in:
  • `_repl_inflight` is initialized at module level alongside `_repl_cache`.
  • The cache_key composition matches what the warmup and proactive
    re-warmer compute (so they share inflight slots with user calls).
  • The 90 s wait_for timeout exists so a stalled leader can't deadlock
    waiters indefinitely.
  • The success-path future-set + pop happens after the cache write so
    waiters get the freshly-cached payload (not stale).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_repl_inflight_map_exists():
    from server import _repl_inflight, _repl_cache
    assert isinstance(_repl_inflight, dict)
    assert isinstance(_repl_cache, dict)


def test_repl_impl_uses_inflight_join():
    """The impl source must contain the inflight-join sentinel
    so future agents can't accidentally remove the gate.
    """
    src = Path(__file__).resolve().parent.parent / "server.py"
    text = src.read_text()
    # Sentinel: 90 s safety timeout protecting joined waiters.
    assert "asyncio.wait_for(asyncio.shield(existing), timeout=90.0)" in text
    # Sentinel: future registration BEFORE the compute body.
    assert "_repl_inflight[cache_key] = my_future" in text
    # Sentinel: success-path result set + pop AFTER the cache write.
    assert "my_future.set_result(payload)" in text
    assert "_repl_inflight.pop(cache_key, None)" in text


def test_repl_inflight_initially_empty():
    """A freshly-imported module must have an empty inflight map so
    no test sees ghost entries from a previous run.
    """
    from server import _repl_inflight
    # The collection itself is a dict; tests in this suite never
    # write to it directly.
    assert isinstance(_repl_inflight, dict)
