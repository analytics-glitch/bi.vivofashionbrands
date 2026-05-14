# Vivo Clienteling — Test Credentials

This file is read by testing & forking agents. Auth is **Emergent-managed Google login** (no app-managed passwords).

## Allowed Google test accounts
- Any Google account can sign in. Role is auto-assigned:
  - First user ever → bootstrapped as **manager**.
  - Any email present in `MANAGER_EMAILS` env var → **manager**.
  - All others → **associate**.

## Seeded test sessions (regression suite)
The testing agent inserts these directly into MongoDB to bypass OAuth:

| Role      | user_id                          | email                       | session_token                        |
|-----------|----------------------------------|-----------------------------|--------------------------------------|
| manager   | usr_test_mgr_1778250692444       | test.vivo.mgr@example.com   | test_session_vivo_mgr_1778250692444  |
| associate | usr_test_assoc_1778250692444     | test.vivo.assoc@example.com | test_session_vivo_assoc_1778250692444 |

Use as: `Authorization: Bearer <session_token>` for backend curl, or set the cookie `session_token` for browser tests (httpOnly, secure, sameSite=None).

## Real customer ID for tests
- `3846911099035` — Janet Masinde (returned by `/api/bi/customer-search?q=jane`).

## Public lookbook share token (seeded)
- `pub_lb_test_1778250775735` → `/share/pub_lb_test_1778250775735` (no auth).

## Notes
- The mock WhatsApp/SMS sender returns `delivery_status: "mock_delivered"` — no real BSP wired in v1.
- Vivo BI API base URL (no auth): `https://vivo-bi-api-666430550422.europe-west1.run.app`.
