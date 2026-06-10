# 07 · Operations Runbook

Practical guide for diagnosing and fixing issues on the live dashboard.

## 7.1 Quick reference — header pills

| Pill | Source endpoint | Meaning |
|---|---|---|
| **Upstream OK / slow / down** | `/api/admin/snapshot-freshness` (joined with `/api/admin/circuit-breaker`) | Upstream Vivo BI health: green=all breakers closed; amber=≥1 recent fail; red=≥1 breaker open |
| **Recon ✓ / ✗** | `/api/admin/run-audit-now` | Snapshot vs live KPI delta < 1% |
| **CACHE x%** | `/api/admin/cache-stats` | Upstash Redis hit rate over last 5 min |
| **Updated N min ago** | `/api/data-freshness` | Time since most recent snapshot for the current window |

## 7.2 Stale fallback

When upstream Vivo BI is slow or returning malformed data, certain endpoints serve the **last successful response** instead of propagating a 5xx:

| Endpoint | TTL | Behavior on failure |
|---|---|---|
| `/api/analytics/active-pos` | 600s | Serves stale up to N seconds old; returns `[]` if no cache |
| `/api/top-skus` (live path) | 300s | Serves stale; returns `[]` if no cache |
| Snapshot-backed endpoints | hours | Always serves the snapshot, even if multi-hour old |

This is what keeps the dashboard alive during upstream incidents. If you see "Updated 30 min ago" but data is reasonable — that's the system doing its job.

## 7.3 Circuit breakers

Per-path breakers protect upstream from hammering during outages.

| Constant | Value | Meaning |
|---|---|---|
| `_CB_FAIL_THRESHOLD` | 2 | Consecutive fails before breaker opens |
| `_CB_RECOVERY_S` | 30 | Cooldown seconds before next attempt |

**Diagnose:**
```js
// browser console on https://bi.vivofashionbrands.com:
fetch('/api/admin/circuit-breaker', {headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))
```

**Fix:**
```js
fetch('/api/admin/circuit-breaker/reset', {method:'POST', headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)
```

If breakers re-open immediately after reset → upstream Vivo BI is genuinely failing, not just slow. Wait it out or escalate.

## 7.4 Launch-date heal

Background sweep that backfills `style_launch_dates_by_number` Mongo from `/orders` history (5 years × 7-day chunks ≈ 261 chunks).

### When does it run?
1. **Auto** — at startup (after 10-min delay) when `style_launch_dates_by_number` has < 7,000 docs.
2. **Manual** — `POST /api/admin/heal-launch-dates` (admin auth).

### How to trigger from the browser:
```js
fetch('/api/admin/heal-launch-dates', {method:'POST', headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)
```
Response: `{ok: true, started: true, running: true, ...}`

### How to monitor:
```js
fetch('/api/admin/heal-launch-dates/status', {headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))
```
Look for `chunks_done / chunks_total`, `progress_pct`, `finished_at`.

### How to stop a runaway heal (iter 91u):
```js
fetch('/api/admin/heal-launch-dates/stop', {method:'POST', headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)
```
Cooperative — exits cleanly within 5-30 s of the request.

### Pacing
Iter 91u added a 1.5 s sleep between chunks so the heal can't starve the foreground HTTP pool. Trade-off: 5y sweep now takes ~10-13 min wall-clock instead of ~7-10 min, but no more Cloudflare 520s during the sweep.

### Auto-heal disabled by default (iter 91x)
**As of iter 91x, the startup auto-heal is OFF by default in production.** Repeated Cloudflare 520s after deploys were tracing back to the auto-trigger saturating upstream Vivo BI. To re-enable, set `AUTO_HEAL_ON_BOOT=true` in `backend/.env` before deploying. The manual trigger `POST /api/admin/heal-launch-dates` is ALWAYS available — that's the recommended path for back-fills going forward.

### Diagnostic
```js
fetch('/api/admin/launch-dates-stats', {headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))
```
Expected on a healthy instance: ~7,000+ docs, distributed across 2019-2026. If 2023/2024 are missing → heal hasn't fully run.

## 7.5 Returns history heal

Same pattern as launch-date heal, but for `returns_daily_by_product`:
- `POST /api/admin/heal-returns-history`
- `GET /api/admin/heal-returns-history/status`

Triggered manually after any major upstream returns-data change.

## 7.6 Snapshot warmup

Analytics snapshots are refreshed by a background task every ~10 min during business hours. Force-warm now:
```js
fetch('/api/admin/warm-snapshots-now', {method:'POST', headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)
```

Full rebuild (rare — heavy):
```js
fetch('/api/admin/full-snapshot-rebuild', {method:'POST', headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)
```

## 7.7 Cache management

- **L0 in-process** — cleared on pod restart. No external trigger.
- **L1 Upstash Redis** — `POST /api/admin/cache-clear`
- **L2 Mongo `analytics_snapshots`** — survives restarts; only re-written by warmup or `heal-*` endpoints.

Quota awareness:
```js
fetch('/api/admin/redis-quota', {headers:{'Authorization':'Bearer ' + localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)
```
If usage > 90%, the backend automatically stops writing to L1 (reads only) to avoid runaway billing.

## 7.8 Common incidents

### Symptom: Cloudflare 520 on login
**Cause:** Heal sweep is starving the upstream HTTP pool.
**Fix (post-iter-91u):** wait it out (~10 min) — pacing prevents new occurrences.
**Fix (pre-iter-91u):** email Emergent Support to bounce the prod pod.

### Symptom: Tiles show "Upstream down · N breakers" red pill
1. Hit `/api/admin/circuit-breaker` to see which paths are tripped.
2. If `open: []` but pill is red → stale UI; hard-refresh (Ctrl+Shift+R).
3. If genuinely open → check upstream Vivo BI dashboard. Try `/api/admin/circuit-breaker/reset`.

### Symptom: Range Mgmt over-flags Tier 4
**Cause:** Production `style_launch_dates_by_number` is partially populated; styles with no launch date default to Tier 4.
**Fix:** Trigger launch-date heal (see 7.4). Confirm via `/api/admin/launch-dates-stats` that year distribution looks healthy.

### Symptom: Sub-total of `suggested_qty` for a style exceeds `warehouse_available` in IBT
**Cause:** Conservation-pass bug.
**Status (iter 91r):** Fixed for warehouse-IBT and Replenishment. If you see it elsewhere, file a bug.

### Symptom: Bin column empty / wrong
1. Check the source XLSX in `/app/backend/data/VFG_Warehouse_Bin_Locations.xlsx` is current.
2. Hit `POST /api/admin/refresh-bins` to flush the in-process cache.
3. Verify by spot-checking a known SKU in `/api/analytics/replenishment-report`.

### Symptom: Preview data doesn't match production
**Cause:** Preview and production use **separate MongoDB clusters by design**.
**Fix:** Either redeploy code that runs the relevant sweep on prod startup, or use the migration script `/app/backend/scripts/sync_launch_dates_preview_to_prod.py` (requires Atlas IP allowlist — escalate to Emergent Support).

### Symptom: Marketing email not sending
**Cause:** `RESEND_API_KEY` is unset in `backend/.env`. Module gracefully degrades to no-op.
**Fix:** Add the key, restart backend. Re-test via `/api/range-mgmt/marketing-report/send`.

## 7.9 Logs

In the preview pod:
```
tail -n 200 /var/log/supervisor/backend.err.log
tail -n 200 /var/log/supervisor/backend.out.log
```

Key log prefixes to grep for:
- `[auto-heal]` — startup launch-date heal
- `[heal-launch-dates]` — manual heal
- `[ibt-wh]` — warehouse IBT dedup counts
- `[active-pos]` — cache hits / stale serves
- `[circuit-breaker]` — open/close events
- `[stale-cache]` — disk-rehydration on boot
- `[indexes]` — Mongo index audit
- `[snapshot-sweep]` — warmup events

For production logs, ask Emergent Support — preview pod cannot tail prod logs.

## 7.10 Emergency commands cheatsheet

| Need | Command (browser console on prod) |
|---|---|
| See breakers | `fetch('/api/admin/circuit-breaker', {headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))` |
| Reset breakers | `fetch('/api/admin/circuit-breaker/reset', {method:'POST', headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)` |
| Trigger heal | `fetch('/api/admin/heal-launch-dates', {method:'POST', headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)` |
| Stop heal | `fetch('/api/admin/heal-launch-dates/stop', {method:'POST', headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)` |
| Heal status | `fetch('/api/admin/heal-launch-dates/status', {headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))` |
| Launch-date stats | `fetch('/api/admin/launch-dates-stats', {headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))` |
| Refresh bins | `fetch('/api/admin/refresh-bins', {method:'POST', headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)` |
| Clear L1 cache | `fetch('/api/admin/cache-clear', {method:'POST', headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)` |
| Warm snapshots | `fetch('/api/admin/warm-snapshots-now', {method:'POST', headers:{'Authorization':'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(console.log)` |

## 7.11 Deploy checklist

Before clicking "Deploy" on Emergent:
1. ☑ Confirm preview is green (no broken tiles, no console errors)
2. ☑ Make sure no heal sweep is running on prod (will be reset on deploy)
3. ☑ Coordinate with users — a deploy = ~30 s downtime + ~5-15 min for snapshots to re-warm
4. ☑ After deploy: verify login works, hard-refresh, watch the Upstream pill
5. ☑ If launch-date heal is needed, fire it manually after deploy

## 7.12 Escalation

When the dashboard is broken in production and the above doesn't fix it:

**Email: `support@emergent.sh`** with:
- Subject: "Vivo BI prod issue — [one-line description]"
- Deployment URL: `https://bi.vivofashionbrands.com`
- What you've tried (links to the runbook section)
- Approximate user impact (1 user, all users, just one page, etc.)

Common Emergent-Support-only fixes:
- Pod restart (stops a runaway task)
- Atlas IP allowlist changes
- Pod resource sizing
- Log access (production pod logs)
