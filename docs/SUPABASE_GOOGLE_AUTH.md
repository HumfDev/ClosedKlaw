# Supabase Google sign-in (waitlist)

The waitlist uses **Supabase Auth** with Google. Email comes from Google; we do **not** collect phone numbers.

## 1. Supabase Dashboard

1. **Authentication → Providers → Google** — enable and add your Google OAuth client ID/secret.
2. **Authentication → URL configuration** — add redirect URLs:
   - `http://localhost:3000/waitlist.html` (local dev)
   - `https://your-production-domain/waitlist.html`
3. **Project Settings → API** — copy the **anon** (publishable) key into `website/.env` as `SUPABASE_ANON_KEY`.

## 2. Google Cloud Console

Create an OAuth 2.0 **Web application** client (or reuse an existing one).

**Authorized redirect URI** (required in Google Cloud — do not use `localhost` here):

```
https://dkeuetxjxpgvsnraqfkr.supabase.co/auth/v1/callback
```

This is Supabase’s fixed OAuth callback. Copy it from **Authentication → Providers → Google** if it ever changes. Do **not** put `http://localhost:3000/waitlist.html` in Google’s redirect URIs.

## 3. Website env

In `website/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=your_anon_or_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

## 4. Run locally

```bash
cd website && npm run dev
```

Open `http://localhost:3000/waitlist.html`, click **Continue with Google**, pick job type, accept terms, submit.
