# Pre-Ship Checklist (mandatory from Iter 83 onward)

[![Pre-Ship Suite](https://github.com/REPLACE_WITH_OWNER/REPLACE_WITH_REPO/actions/workflows/pre-ship-suite.yml/badge.svg?branch=main)](../../actions/workflows/pre-ship-suite.yml)

> The pre-ship suite runs **automatically on every PR** touching `backend/` or `frontend/`.
> Replace the badge URL above with your actual `owner/repo` so it renders in the README.

## CI enforcement
This checklist is enforced by `.github/workflows/pre-ship-suite.yml`. On every PR:
1. The 18-test suite runs against `PREVIEW_URL`.
2. A pass/fail summary is posted as a PR comment with the live memory-leak measurement.
3. The PR cannot be merged until the workflow goes green (configure in **Settings → Branches → Branch protection rules**).

Required GitHub secrets:
- `PREVIEW_URL` — full URL to a live build (preview env).
- `PERF_ADMIN_EMAIL` — admin login.
- `PERF_ADMIN_PASSWORD` — admin password.

To re-run with a tighter budget, use **workflow_dispatch** with `memory_leak_budget_mb` / `memory_leak_burst`.

Run **all six** items BEFORE every production deploy. Any single failure blocks the deploy until investigated.

## 1. Reconciliation check (zero failures)
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://bi-platform-2.preview.emergentagent.com/api/admin/reconciliation-check"
```
Expected: `ok: true`, all 5 checks green. `data_freshness.footfall` may be amber (upstream ingestion lag) — that's NOT a blocker.

## 2. KPI Card ↔ Country Split match (per-country)
```bash
pytest backend/tests/test_iteration_80_recon_and_freshness.py -v
```
Expected: 5/5 pass.

## 3. Channel-group rewrite (Retail/Online filter)
```bash
pytest backend/tests/test_iteration_81_channel_group_rewrite.py -v
```
Expected: 4/4 pass — Retail toggle resolves from snapshot, no upstream fan-out.

## 4. Fan-out tripwire + self-heal
```bash
pytest backend/tests/test_iteration_82_fanout_tripwire.py -v
```
Expected: 3/3 pass — tripwire intercepts > 8-call requests, self-heal rebuilds snapshots.

## 5. Surgical recovery endpoints
```bash
pytest backend/tests/test_iteration_82b_surgical_self_fix.py -v
```
Expected: 4/4 pass — warm-snapshots-now (async + sync), trim-memory shape, admin-gating.

## 6. **Memory leak gate (NEW, mandatory)**
```bash
pytest backend/tests/test_iteration_83_memory_leak_ci.py -v
```
- Captures RSS, fires a 100-request burst across `/kpis` + `/country-summary` + `/sales-summary` (×5 country slices), captures RSS again.
- **Fails the deploy** if `Δ RSS > 100 MB` per single burst, or `> 50 MB` between two consecutive 50-request bursts.
- Prints top-5 caches BEFORE and AFTER so you can identify which cache grew.
- Budget configurable via env: `MEMORY_LEAK_BUDGET_MB` (default 100), `MEMORY_LEAK_BURST` (default 100).

If this test fails:
1. Look at the printed cache breakdown — which `_*_cache` grew?
2. Run `POST /api/admin/trim-memory` and re-test — if Δ disappears, the cache lacks an LRU eviction policy.
3. Check the iteration's `search_replace` diffs for new `cache[key] = value` lines that never get popped.

## Quick combined run
```bash
cd /app/backend
REACT_APP_BACKEND_URL=$(grep REACT_APP_BACKEND_URL ../frontend/.env | cut -d '=' -f2) \
  pytest tests/test_iteration_80_recon_and_freshness.py \
         tests/test_iteration_81_channel_group_rewrite.py \
         tests/test_iteration_82_fanout_tripwire.py \
         tests/test_iteration_82b_surgical_self_fix.py \
         tests/test_iteration_83_memory_leak_ci.py -v
```

Expected: **18 tests pass** with the memory leak gate reporting Δ ≤ 100 MB.
