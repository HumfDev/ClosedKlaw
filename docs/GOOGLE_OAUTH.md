# Google OAuth setup (copy into Cloud Console)

Open **Google Cloud Console → APIs & Services → Credentials → your Web client**.

Run `npm run oauth:setup` anytime to re-print URIs after you change `PUBLIC_URL`.

## Authorized redirect URIs

Add **both** lines, then click **Save**:

```
http://localhost:3847/oauth/callback/google
https://purple-shirts-exist.loca.lt/oauth/callback/google
```

(If you change `PUBLIC_URL` in `.env`, replace the `https://…` line with  
`{PUBLIC_URL}/oauth/callback/google` and save again in Google Console.)

## Authorized JavaScript origins

Add **both** lines, then click **Save**:

```
http://localhost:3847
https://purple-shirts-exist.loca.lt
```

## OAuth consent screen

If the app is in **Testing**, add your Google account under **Test users**.

## Mac: tunnel + server

1. Terminal A — tunnel (must stay running):
   ```bash
   npx localtunnel --port 3847
   ```
   Copy the `https://….loca.lt` URL into `.env` as `PUBLIC_URL=…` if it changes.

2. Terminal B — agent:
   ```bash
   npm run run:all
   ```

3. Confirm log shows `PUBLIC_URL=https://…` (not localhost).

4. Get a **new** Google connect link from iMessage (old messages still say localhost).

## Prefer ngrok (stable URL)

```bash
ngrok config add-authtoken YOUR_TOKEN   # once, from dashboard.ngrok.com
ngrok http 3847
```

Set `PUBLIC_URL=https://YOUR-SUBDOMAIN.ngrok-free.app` and update redirect URIs in Google Console.
