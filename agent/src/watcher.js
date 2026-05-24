import { spawn } from "node:child_process";
import readline from "node:readline";
import { config } from "./config.js";

async function postToBackend(message) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (config.webhookSecret) {
    headers["X-Webhook-Secret"] = config.webhookSecret;
  }

  const res = await fetch(`${config.backendUrl}/webhook/incoming`, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`webhook ${res.status}: ${text}`);
  }
  return res.json();
}

function runImsgWatch() {
  const args = ["watch", "--json", "--attachments"];
  if (config.watchChatId) {
    args.push("--chat-id", String(config.watchChatId));
  }

  console.log(`[watcher] ${config.imsgBin} ${args.join(" ")}`);

  const child = spawn(config.imsgBin, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.is_reaction) return;
    try {
      await postToBackend(msg);
    } catch (err) {
      console.error("[watcher] webhook error:", err.message);
    }
  });

  child.stderr.on("data", (d) => process.stderr.write(d));
  child.on("close", (code) => {
    console.error(`[watcher] imsg exited ${code}`);
    process.exit(code ?? 1);
  });
}

async function runDemoWatch() {
  console.log("[watcher] DEMO_MODE — simulating inbound texts every 8s");
  console.log("[watcher] Start server first: npm start");

  let id = 9000;
  const sender = config.allowFrom[0] ?? "+15559876543";

  const samples = [
    "hey",
    "https://drive.google.com/file/d/demo123/view",
    "summer 2026 swe internships in seattle",
    "any remote ml intern roles?",
  ];

  let i = 0;
  const tick = async () => {
    const msg = {
      id: id++,
      chat_id: 42,
      chat_identifier: sender,
      chat_name: "Demo Contact",
      sender,
      is_from_me: false,
      text: samples[i % samples.length],
      created_at: new Date().toISOString(),
      _demo: true,
    };
    i += 1;
    try {
      const result = await postToBackend(msg);
      console.log("[watcher] demo delivered:", result?.event?.text);
    } catch (err) {
      console.error("[watcher] demo webhook error:", err.message);
    }
  };

  await tick();
  setInterval(tick, 8000);
}

if (config.demoMode) {
  runDemoWatch();
} else {
  runImsgWatch();
}
