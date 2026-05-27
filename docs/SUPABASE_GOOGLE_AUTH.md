# Supabase Google sign-in (waitlist)

The waitlist uses **Supabase Auth** with Google via `signInWithOAuth` (PKCE). Email comes from Google; profile fields (name, gender, birthday, job type) are collected on the waitlist form and saved to the `waitlist` table.

Official reference: [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)

## Flow (web / PKCE)

1. User opens `/waitlist.html` and clicks **Continue with Google**.
2. `signInWithOAuth({ provider: 'google', options: { redirectTo } })` sends the browser to Google.
3. Google redirects to Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Supabase redirects to `redirectTo` (must be allowlisted): `https://kleoklaw.com/waitlist.html?code=...`
5. The Supabase JS client (`detectSessionInUrl: true`) exchanges the code and creates a session.
6. The waitlist form is shown; on submit, `POST /api/waitlist` verifies the JWT and inserts into Supabase.

If OAuth lands on `/` instead of `/waitlist.html`, `oauth-return.js` forwards `?code=` to the waitlist page (same origin, PKCE verifier preserved).

## 1. Google Cloud Console

[Create OAuth client](https://console.cloud.google.com/auth/clients/create) → **Web application**.

**Authorized JavaScript origins** (your app origin, not Supabase):

- `https://kleoklaw.com`
- `http://localhost:3000`

**Authorized redirect URIs** (Supabase callback only — copy from Dashboard → Auth → Providers → Google):

```
https://dkeuetxjxpgvsnraqfkr.supabase.co/auth/v1/callback
```

Do **not** put `https://kleoklaw.com/waitlist.html` in Google redirect URIs.

**Scopes** (Google Auth Platform → Data Access): `openid`, `userinfo.email`, `userinfo.profile` (email/profile are usually default).

## 2. Supabase Dashboard

1. **Authentication → Providers → Google** — enable; paste Google **Client ID** and **Client secret**.
2. **Authentication → URL configuration**
   - **Site URL**: `https://kleoklaw.com/waitlist.html`
   - **Redirect URLs**:
     - `https://kleoklaw.com/waitlist.html`
     - `http://localhost:3000/waitlist.html`
3. **Project Settings → API** — note Project URL and anon (publishable) key.

## 3. Environment variables

**Local** (`website/.env`):

```env
SUPABASE_URL=https://dkeuetxjxpgvsnraqfkr.supabase.co
SUPABASE_ANON_KEY=your_anon_or_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Vercel** (Production): same three variables, then redeploy.

- `SUPABASE_ANON_KEY` → `/api/config` (browser sign-in)
- `SUPABASE_SERVICE_ROLE_KEY` → `/api/waitlist` (server writes to `waitlist` table; never expose in frontend)

## 4. Run locally

```bash
cd website && npm run dev
```

Open `http://localhost:3000/waitlist.html` → **Continue with Google** → complete profile → **Join waitlist**.

## 5. Troubleshooting

| Symptom | Fix |
|--------|-----|
| `redirect_uri_mismatch` | Add Supabase callback URL to Google **Authorized redirect URIs** |
| Lands on home page after Google | Set Site URL + Redirect URLs to `/waitlist.html`; `oauth-return.js` also forwards stray `?code=` |
| `Auth not configured.` on live site | Set `SUPABASE_URL` + `SUPABASE_ANON_KEY` on Vercel and redeploy |
| PKCE verifier not found | Start sign-in from `/waitlist.html` on the same browser; do not clear site data mid-flow |
| Form submits but no DB row | Set `SUPABASE_SERVICE_ROLE_KEY` on Vercel; check `waitlist` table + RLS |
