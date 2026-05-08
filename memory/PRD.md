# Vivo Clienteling — Product Requirements (PRD)

## Original problem statement
"Build CRM" — followed by the Vivo Fashion Group brief (Vivo_CRM_Emergent_Brief_v1.docx).
Brief explicitly scopes v1 to a **clienteling app** (not a full CRM): tablet-first web app for in-store sales associates at Vivo Fashion Group (Kenya / Uganda / Rwanda + Shop Zetu online).

## User choices (literal, captured Feb 2026)
- Database: **MongoDB** (option 1a — environment constraint).
- Customer/sales data source: **Vivo BI API** (BigQuery-backed) at `https://vivo-bi-api-666430550422.europe-west1.run.app`. No auth.
- Auth: **Emergent-managed Google login**.
- Messaging: mock WhatsApp/SMS provider for v1; pluggable real BSP later via env.
- Seed demo data: yes (4 default message templates).
- Visual style: navy `#1F3864` + warm gold `#C9A961`, minimal/editorial, tablet-first.

## User personas
- **Associate** — in-store sales staff using a tablet during shifts; needs fast customer lookup, profile context, follow-ups, send messages, build lookbooks.
- **Manager** — store/regional manager; needs sales KPIs from BI, per-associate activity, top customers, churn-risk lists, message-template admin, audit log for Kenya DPA compliance.

## Architecture
- **Backend**: FastAPI + MongoDB (motor), all routes under `/api`.
- **Frontend**: React 19 + Tailwind + shadcn/ui + lucide-react + recharts, fonts `Outfit` (display) + `Manrope` (body).
- **Data sources**: Vivo BI API (read-only, cached 60s) for customer/sales/inventory; MongoDB for clienteling-specific data (notes, tasks, preferences, message logs, consent, audit, lookbooks, templates).
- **Auth**: Emergent Google login → session_token in httpOnly cookie + Bearer fallback. Role allowlist via `MANAGER_EMAILS` env var; first user bootstraps as manager.

## Implemented (Feb 2026)
- ✅ Login (Emergent Google OAuth) + session callback handler with race-safe synchronous detection.
- ✅ Associate "Today" home: KPIs, follow-ups (overdue highlighting), top VIPs, win-back list.
- ✅ Customer search: phone / name / email (Kenyan format aware via BI API), default top-customers when empty.
- ✅ 360 Customer Profile: hero with lifetime/orders/avg basket/last visit; tabs for Purchases, Preferences, Notes, Follow-ups, Messages, Social, Consent.
- ✅ Style Preferences editor (sizes, fits, fabrics, occasions, brand affinities).
- ✅ Notes timeline & follow-up tasks with due-date sorting + overdue flag.
- ✅ WhatsApp/SMS messaging (mock provider) with template library and placeholder substitution; opt-out blocks future sends.
- ✅ Personalised lookbooks: 3–15 items, 30-day share UUID URL, public no-auth view, "Love this" interest capture.
- ✅ Manager Insights: BI-driven KPIs, daily trend, country & top-store charts (recharts), top customers, churn list, per-associate activity table, **Social tab**.
- ✅ Message templates admin (manager-only) with 4 seeded defaults.
- ✅ Kenya DPA: per-channel consent capture/history; full audit log for views/edits/sends.
- ✅ **Social listening (Feb 2026 v1.1)**: 11 endpoints under `/api/social/*` covering posts, feedback, mentions, influencers, DMs, per-customer timeline, handle linking, replies, sentiment classifier (Claude Sonnet 4.5 via Emergent universal LLM key), audit hooks. 40 mock posts + 180 mock feedback items seeded; classifier returns sentiment {positive|neutral|negative} + themes from a fixed vocabulary. Frontend: dedicated `/inbox` page (filters, classify on demand, link-to-customer, reply), Social tab on Manager Insights, Social tab on Customer Profile.
- ✅ **Customer profile cache (Feb 2026 v1.1.1)**: `/api/bi/customer/{id}` now resolves profile fields via a customer cache populated from any BI call returning customer data, with a wide top-customers fallback for first-time loads.
- ✅ **Closed-loop quality auto-tasks (Feb 2026 v1.2)**: every Monday (or via the manual "Run now" button) `generate_negative_theme_tasks` clusters negative feedback from the last 7 days by theme and creates one follow-up task per qualifying theme on every manager. Endpoints: `/api/social/auto-tasks/run`, `/auto-tasks`, `/auto-tasks/runs`, `/auto-tasks/kpi`. KPIs (open / completed 14d / median resolution / negative 7d / created 7d) render in a Quality strip on the Manager Insights → Social tab. Idempotent per ISO week. Median resolution time = headline pilot KPI for negative-feedback handling.
- ✅ **World-class enhancements (Feb 2026 v1.3)**:
  - **Theme aligned with bi.vivofashionbrands.com** — forest green primary `#0F4D31`, warm orange accent `#ED7C2A`, cream background `#FCEFD9`, Outfit/Inter typography, Vivo orange logo tile.
  - **RFM segmentation** — every customer auto-tagged `vip / loyal / promising / at_risk / churned / new` from recency × frequency × spend; tiers computed on every BI response and stored in `customer_cache` (~2,000 rows eager-warmed on startup). Coloured tier badges on customer hero, search results, daily call list, and dashboard cards.
  - **Daily call list** — `/api/dashboard/call-list` returns 4 prioritised buckets: today's shopping anniversaries, VIPs not contacted in 30d, at-risk customers, churned win-backs. Replaces the static Top-VIPs/Reactivation cards on the home page with an action queue.
  - **Clienteling-attribution KPI** — `/api/dashboard/attribution` (manager) computes messaged → purchased customers within a window, conversion rate, estimated revenue, per-associate breakdown. Headline pilot KPI per the brief.
  - **AI Next-Best-Action card** on every Customer Profile — Claude Sonnet 4.5 reads tier + history + prefs + last contact and outputs `{action, why, script, urgency}`. "Use this script" pre-fills the Send-Message dialog. 6h cache.
  - **DPA "Right to be forgotten"** — `/api/customers/{id}/forget` (manager only) anonymizes notes, tasks, messages, lookbooks, preferences, NBA cache, customer cache, social handles; consent flipped to opted-out; full forget-log + audit trail. Danger-zone UI on the Consent tab requires exact-name confirmation.
  - **Anniversary auto-tasks** — `/api/anniversaries/run` creates one task per customer whose first-purchase MM-DD matches today, idempotent per day, integrates with the existing weekly auto-task engine.
- ✅ 28/28 v1 + 25/25 social + 13/13 auto-task + 14/14 world-class backend tests = **80/80 backend tests green**. Frontend regression-tested across all 13 surfaces.

## Backlog (P0 → P2)
- **P1** Wire real BigQuery social tables (today the 180-item feedback corpus is mocked) — schemas needed from Vivo's data team. Single env-flag flip + endpoint mapping in `social.py`.
- **P1** WhatsApp BSP integration (Africa's Talking or Twilio) — replace mock send.
- **P1** Customer ↔ associate assignment (today any associate sees any customer).
- **P1** Inbound messages / replies into the message timeline (BSP webhooks).
- **P1** Replace ISO-string timestamps with native Mongo datetimes.
- **P2** Run social classifier as a background task with an in-process lock instead of inline-on-read.
- **P2** Read EMERGENT_LLM_KEY at call time so key rotation works without restart; expose `/api/social/health` to surface classifier errors instead of silent neutral fallback.
- **P2** Real social media post-fetcher (Meta Graph, TikTok Business, X) once schemas land in BigQuery.
- **P2** Replace in-process BI cache with Redis or cachetools.TTLCache.
- **P2** Add unique index on `user_sessions.session_token` and upsert-on-insert.
- **P2** Migrate `@app.on_event` → FastAPI lifespan handlers.
- **P2** Rate-limit / dedupe `/public/lookbooks/{token}/interest` endpoint.
- **P2** Drag-and-reorder of lookbook items + product image assets from BI (currently deterministic Unsplash by SKU hash).
- **P2** "Forget customer" workflow per Section 4.5 of brief.
- **P2** Optional Swahili translation pass.

## Non-goals (per brief Section 6.1 hard guardrails)
- POS / checkout / payments.
- Inventory editing.
- Bulk-marketing campaigns / drip sequences / A/B tools.
- Service ticketing.
- B2B sales pipeline.
- Loyalty rules engine.
