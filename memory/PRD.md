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
- ✅ 360 Customer Profile: hero with lifetime/orders/avg basket/last visit; tabs for Purchases, Preferences, Notes, Follow-ups, Messages, Consent.
- ✅ Style Preferences editor (sizes, fits, fabrics, occasions, brand affinities).
- ✅ Notes timeline & follow-up tasks with due-date sorting + overdue flag.
- ✅ WhatsApp/SMS messaging (mock provider) with template library and placeholder substitution; opt-out blocks future sends.
- ✅ Personalised lookbooks: 3–15 items, 30-day share UUID URL, public no-auth view, "Love this" interest capture.
- ✅ Manager Insights: BI-driven KPIs, daily trend, country & top-store charts (recharts), top customers, churn list, per-associate activity table.
- ✅ Message templates admin (manager-only) with 4 seeded defaults.
- ✅ Kenya DPA: per-channel consent capture/history; full audit log for views/edits/sends.
- ✅ 28/28 backend tests pass; all 8 frontend pages render with expected content.

## Backlog (P0 → P2)
- **P1** WhatsApp BSP integration (Africa's Talking or Twilio) — replace mock send.
- **P1** Customer ↔ associate assignment (today any associate sees any customer).
- **P1** Inbound messages / replies into the message timeline (BSP webhooks).
- **P1** Replace ISO-string timestamps with native Mongo datetimes.
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
