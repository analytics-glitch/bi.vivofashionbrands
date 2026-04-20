# Auth testing playbook (for the testing agent) — copied from Emergent playbook.

## Auth Model
- **Primary**: Emergent Google Sign-In. Only emails ending in `@vivofashiongroup.com` or
  `@shopzetu.com` are allowed. Auto-provisioned on first login.
- **Fallback**: Admin-created email/password accounts (bcrypt). No self-signup.
- **Token**: server returns `session_token` (UUID). Backend accepts it from:
  - httpOnly `session_token` cookie (Google flow), OR
  - `Authorization: Bearer <session_token>` header (email/password flow).
- **Roles**: `admin` · `viewer`. First seeded user is admin.
- **Activity log**: every authenticated `/api/*` request writes to `activity_logs`.

## Endpoints
- `POST /api/auth/google/callback` — body `{"session_id": "..."}` → sets cookie + returns user + token
- `POST /api/auth/login` — body `{"email","password"}` → returns `{token, user}`
- `GET  /api/auth/me` — returns user
- `POST /api/auth/logout` — clears cookie + removes session
- `GET  /api/admin/users` (admin) — list
- `POST /api/admin/users` (admin) — create email/password user `{email, name, password, role}`
- `PATCH /api/admin/users/{user_id}` (admin) — update role / active
- `GET  /api/admin/activity-logs` (admin) — paginated

## Seed
Email: `admin@vivofashiongroup.com` (configurable via `SEED_ADMIN_EMAIL`)
Password: see `/app/memory/test_credentials.md`

## Browser tests
```python
# Navigate with a stored session_token cookie (httpOnly cookie is set via backend)
await page.context.add_cookies([{
    "name": "session_token",
    "value": SESSION_TOKEN,
    "domain": "bi-platform-2.preview.emergentagent.com",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None",
}])
```

## curl examples
```bash
# login
TOKEN=$(curl -s -X POST $API_URL/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@vivofashiongroup.com","password":"<from-test_credentials.md>"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# me
curl -s $API_URL/api/auth/me -H "Authorization: Bearer $TOKEN"

# protected
curl -s "$API_URL/api/kpis?date_from=2026-04-01&date_to=2026-04-19" \
  -H "Authorization: Bearer $TOKEN"
```

## Checklist
- Unauth request to /api/kpis → 401
- Login with wrong password → 401
- Login with non-whitelisted domain (via Google path) → 403 with clear reason
- activity_logs records each authed request
- Admin-only endpoints return 403 for viewer role
