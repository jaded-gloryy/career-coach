# Task brief: authentication — Supabase

**Phase:** 3  
**Scope:** Backend · Database · Frontend  
**Estimate:** 2–3 days

---

## Objective

Replace the current anonymous UUID identity model (localStorage + no verification) with Supabase Auth. After this work, every request must be tied to a verified user identity. The existing Postgres data model is preserved — Supabase Auth sits alongside it, not in place of it.

---

## Current state

User identity today:

- A UUID is generated client-side on first load and stored in `localStorage`
- That UUID is passed as `user_id` on every request
- There is no verification — any client can claim any UUID
- The `users` table holds this UUID as a PK with a `tone_sample` text column

This is fine for 2 users in development. It is not acceptable in production.

---

## Chosen approach — Supabase Auth + existing Postgres

Supabase Auth manages identity (signup, login, session tokens, JWT issuance). Your existing PostgreSQL 16 instance managed by Docker Compose remains the application database — it does not move into Supabase's hosted Postgres. The two connect via a foreign key relationship between `users.id` and Supabase's `auth.users.id`.

This keeps your pgvector setup, your asyncpg connection pool, and your Docker Compose architecture intact. Supabase is used only for its auth layer, not as a database replacement.

---

## Auth flow

```
User visits app
  → no session → show login / signup form
  → submits credentials
  → Supabase issues JWT + refresh token
  → frontend stores session via supabase-js (not localStorage manually)
  → every API request sends Authorization: Bearer <jwt>
  → FastAPI middleware verifies JWT with Supabase public key
  → extracts user_id (sub claim) and passes to route handlers
  → route handlers use user_id to scope all DB queries
```

---

## Supabase project setup

1. Create a Supabase project at supabase.com
2. Note the following from Project Settings → API:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (used client-side)
   - `SUPABASE_JWT_SECRET` (used server-side for verification)
3. Enable Email provider in Authentication → Providers
4. Disable "Confirm email" for development if needed — re-enable before any real users

Add to `.env`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
```

---

## Backend changes

### JWT verification middleware

Add a FastAPI dependency that runs on every protected route:

```python
from fastapi import Depends, HTTPException, Header
import jwt  # PyJWT

async def get_current_user(authorization: str = Header(...)) -> str:
    try:
        token = authorization.removeprefix("Bearer ")
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated"
        )
        return payload["sub"]  # this is the Supabase user UUID
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

Inject into routes:

```python
@router.post("/chat/{agent_id}/stream")
async def chat_stream(agent_id: int, user_id: str = Depends(get_current_user)):
    ...
```

Remove all places where `user_id` is currently read from the request body or query params. It comes from the token only.

### users table migration

The existing `users` table uses a self-generated UUID. It needs a foreign key relationship to Supabase's auth users:

```sql
-- Add column to link to Supabase auth
ALTER TABLE users ADD COLUMN auth_id UUID UNIQUE;

-- After backfill (see migration path below), add the constraint
-- FK to auth.users is not directly enforceable across DBs,
-- so treat auth_id as the lookup key, not a hard FK
CREATE INDEX idx_users_auth_id ON users(auth_id);
```

On first authenticated request for a user, upsert into `users`:

```python
async def get_or_create_user(auth_id: str, conn) -> str:
    row = await conn.fetchrow(
        "SELECT id FROM users WHERE auth_id = $1", auth_id
    )
    if row:
        return row["id"]
    user_id = uuid.uuid4()
    await conn.execute(
        "INSERT INTO users (id, auth_id) VALUES ($1, $2)",
        user_id, auth_id
    )
    return str(user_id)
```

This preserves your internal `users.id` UUID as the FK used throughout `documents`, `resume_snapshots`, `session_state`, and `conversations`. Supabase's `auth_id` is only used at the boundary.

### Remove anonymous user creation

Delete any route or startup logic that creates a user row on first load without authentication. The `get_or_create_user` function above replaces it.

---

## Frontend changes

### Install supabase-js

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

Or if you add a build step later: `npm install @supabase/supabase-js`

### Initialize client

```javascript
const supabase = window.supabase.createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)
```

### Auth UI (minimal, inline in index.html)

Add a login/signup form that renders when no session is present. Supabase Auth UI component is available but a simple custom form keeps you in the single-file pattern:

```javascript
async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) showError(error.message)
  else initApp(data.session)
}

async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) showError(error.message)
  else initApp(data.session)
}

async function signOut() {
  await supabase.auth.signOut()
  showAuthScreen()
}
```

### Session management

Replace manual localStorage UUID handling with Supabase session:

```javascript
// On load
const { data: { session } } = await supabase.auth.getSession()
if (session) initApp(session)
else showAuthScreen()

// Listen for auth state changes (token refresh, sign out)
supabase.auth.onAuthStateChange((event, session) => {
  if (session) initApp(session)
  else showAuthScreen()
})
```

### Attach JWT to all API requests

```javascript
async function apiRequest(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(path, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    }
  })
}
```

Replace all existing `fetch()` calls in `index.html` with `apiRequest()`.

For the SSE stream specifically:

```javascript
const { data: { session } } = await supabase.auth.getSession()
const url = `/chat/${agentId}/stream?token=${session.access_token}`
const eventSource = new EventSource(url)
```

Pass the token as a query param for SSE since `EventSource` does not support custom headers. Verify it server-side the same way — extract from query param instead of header for that route only.

---

## Docker Compose changes

No new services needed. Supabase Auth is a hosted service — you call their API, you do not run it locally. Add the three env vars to your `career-coach` service in `docker-compose.yml`:

```yaml
environment:
  - SUPABASE_URL=${SUPABASE_URL}
  - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
  - SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET}
```

---

## Migration path for existing users

You have 2 users. Do this manually:

1. Create Supabase accounts for both users via the Supabase dashboard (Authentication → Users → Invite user)
2. Note the Supabase `auth.users.id` UUID for each
3. Run a one-time SQL update to set `auth_id` on their existing `users` rows
4. Verify both users can log in and their existing conversations, documents, and snapshots are intact

No automated backfill script needed at this scale.

---

## Dependencies to add

| Package | Purpose |
|---|---|
| `PyJWT` | JWT verification in FastAPI middleware |
| `cryptography` | Required by PyJWT for HS256 |
| `@supabase/supabase-js` | Client-side session management |

---

## File changes summary

| File | Change |
|---|---|
| `middleware/auth.py` | New — `get_current_user` JWT dependency |
| `routes/*.py` | Inject `get_current_user` dependency, remove body/param user_id |
| `db/users.py` | Add `get_or_create_user`, remove anonymous user creation |
| `migrations/` | Add `auth_id` column + index to `users` table |
| `index.html` | Add login/signup UI, Supabase session management, wrap all fetch calls |
| `docker-compose.yml` | Add Supabase env vars to career-coach service |
| `.env` | Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` |
| `requirements.txt` | Add `PyJWT`, `cryptography` |

---

## Security notes

- Never expose `SUPABASE_JWT_SECRET` to the frontend — it is server-side only
- The `SUPABASE_ANON_KEY` is safe to expose client-side — it is designed for public use and scoped by Supabase's RLS policies
- SSE token-in-query-param is acceptable for this use case but should be noted: tokens in URLs appear in server logs. Rotate JWT expiry aggressively (Supabase default is 1 hour) and do not log the SSE endpoint URL in production
- All DB queries already use parameterized asyncpg calls — no SQL injection surface is introduced by this change

---

## Out of scope for this task

Supabase Row Level Security (RLS) · OAuth / social login · password reset flow · email verification · role-based access · rate limiting
