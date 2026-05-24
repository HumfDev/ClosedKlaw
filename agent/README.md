# iMessage Agent

Receive texts on your Mac’s iMessage account and forward them to a local backend. Reply automatically (demo ack) or plug in your own agent logic.

## How it actually works

Apple does **not** expose a public “text this number → hit my API” product for personal iMessage. The practical pattern on a Mac is:

1. **You** (or anyone) send an iMessage/SMS to **your Mac’s iMessage identity** (the phone number or Apple ID email signed into Messages.app).
2. macOS stores the thread in `~/Library/Messages/chat.db`.
3. This project runs **`imsg watch`** (or demo mode) to stream new rows from that database.
4. Each inbound message is **POSTed** to `http://127.0.0.1:3847/webhook/incoming` where your agent runs.

```
Phone ──iMessage──► Mac (Messages.app) ──chat.db──► imsg watch ──HTTP──► your backend
                                                      ▲
                                                      └── imsg send (auto-reply)
```

**Requirements**

- A **Mac** that stays signed into Messages
- **Full Disk Access** for the process running `imsg` (Terminal, Cursor, or Node)
- **Automation** permission so `imsg` can control Messages.app (for sending replies)

There is no separate “agent phone number” unless you use a relay product (e.g. [BlueBubbles](https://bluebubbles.app)) on a dedicated Mac.

## Quick start (demo — no permissions)

Prove the backend pipe without touching `chat.db`:

```bash
npm start                   # terminal 1 — backend
DEMO_MODE=true npm run watch   # terminal 2 — fake texts every 8s
```

Watch terminal 1 for `--- iMessage received ---` blocks.

## Live iMessage setup

### 1. Install `imsg` (already via Homebrew in this repo’s setup)

```bash
brew install steipete/tap/imsg
imsg --version
```

### 2. macOS permissions

1. **System Settings → Privacy & Security → Full Disk Access**  
   Enable: **Terminal** (or iTerm), **Cursor**, and/or **Node** — whichever parent launches `imsg` / `npm run watch`.

2. **System Settings → Privacy & Security → Automation**  
   Allow that same app to control **Messages**.

3. Quit and reopen the terminal after toggling permissions.

Verify:

```bash
imsg chats --limit 3
```

### 3. Configure

Create a `.env` file in the project root with at least:

- `ALLOW_FROM` — comma-separated handles allowed to trigger the agent (your phone in E.164, e.g. `+14155551212`)
- `WATCH_CHAT_ID` — optional; get IDs with `imsg chats --json`
- `AUTO_REPLY=true` — sends a confirmation back via iMessage when live

### 4. Run

```bash
npm start          # backend
npm run watch      # live imsg stream → webhook
```

Text your Mac’s iMessage number from your phone. You should see logs in the server terminal and (if `AUTO_REPLY=true`) a confirmation bubble in Messages.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/events` | Last 50 handled inbound events |
| POST | `/webhook/incoming` | Body: `imsg` message JSON (see [imsg JSON schema](https://imsg.sh/json.html)) |

Optional header: `X-Webhook-Secret` if `WEBHOOK_SECRET` is set.

## Job search + resume onboarding

1. **First message (no AI)** — automated text asking for a resume (PDF in iMessage or Google Drive / Docs link).
2. **Ingest** — `imsg watch` runs with `--attachments` so local attachment paths are available.
3. **Summarize (AI only here)** — DeepSeek returns a 2–3 sentence summary; the “got your resume…” wrapper is static.
4. **Job search** — after upload, set `AI_ENABLED=true` for LLM replies about roles (uses the stored summary as context).

Restart both processes after changing `.env`:

```bash
npm start
npm run watch
```

## Connectors (Google, Notion, Indeed) from iMessage

See **[docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md)** for exact values to paste into Google Cloud Console.

```bash
npm run tunnel          # terminal 1 — keep running
npm run run:all         # terminal 2
npm run oauth:setup     # print redirect URIs for your current PUBLIC_URL
```

Set `PUBLIC_URL` in `.env` to the tunnel `https://…` URL. iMessage links must use that host, not `localhost`.

## Customize the agent

Edit `src/onboarding.js` and `prompts/imessage-system.txt` for intake copy and job-search behavior.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `authorization denied` on `imsg` | Full Disk Access for Terminal/Cursor/Node |
| Reads work, send fails | Automation → Messages for your terminal |
| No events when texting | Mac awake, Messages signed in, correct `ALLOW_FROM` handle |
| Wrong chat | Set `WATCH_CHAT_ID` from `imsg chats --json` |

## Security

- Server binds to `127.0.0.1` only.
- Use `ALLOW_FROM` so random contacts cannot drive your agent.
- Set `WEBHOOK_SECRET` if you expose the webhook beyond localhost.
