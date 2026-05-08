# Auth-Gated App Testing Playbook

This is the Emergent Auth testing playbook saved verbatim per the integration playbook.

## Step 1: Create Test User & Session
```sh
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  role: 'manager',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Test Backend API
```sh
# /auth/me with Bearer fallback
curl -X GET "$REACT_APP_BACKEND_URL/api/auth/me" -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Protected endpoints
curl -X GET "$REACT_APP_BACKEND_URL/api/dashboard/me" -H "Authorization: Bearer YOUR_SESSION_TOKEN"
curl -X GET "$REACT_APP_BACKEND_URL/api/templates" -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

## Step 3: Browser Testing (Playwright)
```python
await page.context.add_cookies([{
    "name": "session_token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "<host>",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}])
await page.goto(f"{REACT_APP_BACKEND_URL}/dashboard")
```

## Checklist
- [x] Custom `user_id` field on users (UUID), MongoDB `_id` is internal only.
- [x] Session `user_id` matches `users.user_id`.
- [x] All Mongo queries use `{"_id": 0}` projection.
- [x] Backend reads `session_token` from cookies first, then `Authorization: Bearer` header.
- [x] Manager role granted via `MANAGER_EMAILS` allowlist OR auto-promoted as the first user.
