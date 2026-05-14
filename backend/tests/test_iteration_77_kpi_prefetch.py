"""Iter 77 — KPI tile prefetch-on-hover regression test.

Locks in:
  • `KPICard` accepts a `prefetch` prop (array of {url, params}).
  • Hover handler fires `api.get(...)` once per mount.
  • Overview.jsx wires prefetch hints on the tiles whose action
    targets are /locations, /products, /footfall, /exports.
  • The prefetch list is keyed on the destination so a future agent
    who renames a tile keeps the warming intact.
"""
from pathlib import Path

FRONTEND_SRC = Path("/app/frontend/src")


def test_kpi_card_supports_prefetch_prop():
    src = (FRONTEND_SRC / "components" / "KPICard.jsx").read_text()
    # Iter-77 sentinels — present in the component signature + handler.
    assert "prefetch = null," in src
    assert "prefetchedRef" in src
    assert "onMouseEnter={handleHover}" in src
    assert "api.get(entry.url, { params: entry.params })" in src


def test_kpi_card_prefetch_runs_only_once():
    """The ref-guarded handler must early-return after the first
    successful fire so a wiggly mouse over a hot 6-tile grid doesn't
    spam upstream with duplicate requests."""
    src = (FRONTEND_SRC / "components" / "KPICard.jsx").read_text()
    # Same-name sentinel appears in both the guard check and the set.
    assert "if (prefetchedRef.current) return;" in src
    assert "prefetchedRef.current = true;" in src


def test_overview_wires_prefetch_on_target_tiles():
    src = (FRONTEND_SRC / "pages" / "Overview.jsx").read_text()
    # The destination map must cover the four pages users land on
    # most often from the Overview KPI tiles.
    assert '"/locations":' in src
    assert '"/products":' in src
    assert '"/footfall":' in src
    assert '"/exports":' in src
    # Specific tiles wired with the pf() helper.
    for tile in ("kpi-total-sales", "kpi-units", "kpi-orders",
                 "kpi-footfall", "kpi-conversion", "kpi-rr", "kpi-returns"):
        assert tile in src, f"tile {tile} disappeared from Overview"
    # Helper presence — pf() must remain so call-sites stay terse.
    assert "const pf = (path) =>" in src
