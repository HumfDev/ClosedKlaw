import http from "node:http";
import { spawn } from "node:child_process";
import { config, isOAuthConfigured } from "./config.js";
import { handleIncomingMessage, getRecentEvents } from "./handlers.js";
import { getAiSessionState } from "./ai-limits.js";
import {
  googleAuthUrl,
  googleExchangeCode,
  notionAuthUrl,
  notionExchangeCode,
  indeedAuthUrl,
  indeedExchangeCode,
} from "./oauth.js";
import { handleWorkerResult, handleWorkerQuestion } from "./apply-queue.js";
import { answerQuestion, getJob } from "./job-store.js";

export function sendImessage(to, text) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.imsgBin, ["send", "--text", text, "--to", to], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`imsg exited ${code}`))));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, demoMode: config.demoMode }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ events: getRecentEvents() }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/ai/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        enabled: config.aiEnabled,
        session: getAiSessionState(),
      }),
    );
    return;
  }

  // ── OAuth initiation: redirect user to provider ─────────────────────────────
  if (req.method === "GET" && url.pathname.startsWith("/connect/")) {
    const service = url.pathname.replace("/connect/", "").split("/")[0];
    const userKey = decodeURIComponent(url.searchParams.get("user") ?? "unknown");
    const htmlPage = (title, body) =>
      `<html><body style="font-family:-apple-system,sans-serif;padding:2rem;max-width:520px;line-height:1.5"><h2>${title}</h2>${body}<p style="color:#666;margin-top:2rem">Return to iMessage when done.</p></body></html>`;

    if (!["google", "notion", "indeed"].includes(service)) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(htmlPage("Unknown connector", `<p>Unknown service: <strong>${service}</strong></p>`));
      return;
    }

    if (!isOAuthConfigured(service)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        htmlPage(
          "Connector not set up",
          `<p>Add OAuth credentials for <strong>${service}</strong> to <code>.env</code> on your Mac and restart <code>npm start</code>.</p><p>Redirect URI to register: <code>${config.publicUrl}/oauth/callback/${service}</code></p>${config.connectLinksNeedTunnel ? `<p><strong>iPhone:</strong> also set <code>PUBLIC_URL</code> to an <code>https://</code> tunnel URL (e.g. ngrok) — localhost only works in Safari on this Mac.</p>` : ""}`,
        ),
      );
      return;
    }

    let authUrl;
    try {
      if (service === "google") authUrl = googleAuthUrl(userKey);
      else if (service === "notion") authUrl = notionAuthUrl(userKey);
      else authUrl = indeedAuthUrl(userKey);
      res.writeHead(302, { Location: authUrl });
      res.end();
    } catch (err) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlPage("Connection failed", `<p>${err.message}</p>`));
    }
    return;
  }

  // ── OAuth callback: exchange code and show success page ───────────────────────
  if (req.method === "GET" && url.pathname.startsWith("/oauth/callback/")) {
    const service = url.pathname.replace("/oauth/callback/", "");
    const code = url.searchParams.get("code");
    const userKey = decodeURIComponent(url.searchParams.get("state") ?? "unknown");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:sans-serif;padding:2rem"><h2>Connection cancelled</h2><p>${error}</p><p>Go back to iMessage and try again.</p></body></html>`,
      );
      return;
    }

    try {
      if (service === "google") await googleExchangeCode(code, userKey);
      else if (service === "notion") await notionExchangeCode(code, userKey);
      else if (service === "indeed") await indeedExchangeCode(code, userKey);
      else throw new Error(`Unknown service: ${service}`);

      console.log(`[oauth] ${service} connected for user ${userKey}`);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:sans-serif;padding:2rem;max-width:480px"><h2 style="color:#22c55e">Connected!</h2><p><strong>${service}</strong> is now linked to your job search agent.</p><p>Go back to iMessage and reply <strong>"done"</strong> to start searching.</p></body></html>`,
      );
    } catch (err) {
      console.error(`[oauth] ${service} callback error:`, err.message);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:sans-serif;padding:2rem"><h2>Connection failed</h2><p>${err.message}</p><p>Go back to iMessage and try again.</p></body></html>`,
      );
    }
    return;
  }

  // ── Worker callbacks ──────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname.startsWith("/worker/")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload;
    try { payload = JSON.parse(body); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    const workerSecret = req.headers["x-worker-secret"];
    if (config.workerSecret && workerSecret !== config.workerSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    try {
      if (url.pathname === "/worker/result") {
        const replyText = handleWorkerResult(payload);
        if (replyText) {
          const job = getJob(payload.jobId);
          if (job?.user_key) {
            await sendImessage(job.user_key, replyText).catch((e) =>
              console.warn("[worker] imsg send failed:", e.message),
            );
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));

      } else if (url.pathname === "/worker/question") {
        const job = getJob(payload.jobId);
        const replyText = handleWorkerQuestion(payload, job ? { sender: job.user_key } : null);
        if (replyText && job?.user_key) {
          await sendImessage(job.user_key, replyText).catch((e) =>
            console.warn("[worker] question imsg send failed:", e.message),
          );
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, questionId: payload.questionId }));

      } else if (url.pathname === "/worker/answer") {
        const resolved = answerQuestion(payload.questionId, payload.answer);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, resolved }));

      } else {
        res.writeHead(404);
        res.end("not found");
      }
    } catch (err) {
      console.error("[worker endpoint] error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook/incoming") {
    let body = "";
    for await (const chunk of req) body += chunk;

    const secret = req.headers["x-webhook-secret"];
    if (config.webhookSecret && secret !== config.webhookSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid webhook secret" }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    try {
      const result = await handleIncomingMessage(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error("[server] handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`[server] listening on http://127.0.0.1:${config.port}`);
  console.log(`[server] PUBLIC_URL=${config.publicUrl} (OAuth + connector links)`);
  console.log(`[server] POST /webhook/incoming  GET /events  GET /ai/status`);
  if (config.demoMode) console.log("[server] DEMO_MODE=true — localhost links OK for desktop demo");
  if (config.connectLinksNeedTunnel) {
    console.warn(
      "[server] ⚠️  PUBLIC_URL is localhost — connector links won't work on iPhone. Run: ngrok http",
      config.port,
      "→ set PUBLIC_URL=https://….ngrok-free.app in .env → restart",
    );
  }
  for (const svc of ["google", "notion", "indeed"]) {
    if (!isOAuthConfigured(svc)) {
      console.warn(`[server] ⚠️  ${svc} connector disabled — OAuth env vars missing in .env`);
    }
  }
  if (config.aiEnabled) {
    console.log(
      `[server] AI on — max ${config.aiMaxResponses} replies, ${config.aiMinIntervalMs / 1000}s apart`,
    );
    if (!config.aiApiKey) console.error("[server] ⚠️  API key missing in .env");
    console.log("[server] ⚠️  REQUIRED: run `npm run watch` in a 2nd terminal (or use `npm run run:all`)");
  }
});
