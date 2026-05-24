#!/usr/bin/env node
/**
 * Prints exact values to paste into Google Cloud Console → OAuth client (Web).
 * Run: node scripts/print-google-oauth-setup.js
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

function loadEnv() {
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv();
const port = env.PORT ?? "3847";
const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const localBase = `http://localhost:${port}`;

function lanIps() {
  const ips = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) ips.push(i.address);
    }
  }
  return [...new Set(ips)];
}

const redirectUris = [
  `${localBase}/oauth/callback/google`,
  ...(publicUrl !== localBase ? [`${publicUrl}/oauth/callback/google`] : []),
];

const jsOrigins = [
  localBase,
  ...(publicUrl !== localBase ? [publicUrl] : []),
];

console.log("\n=== Google Cloud Console → Client ID for Web application ===\n");
console.log("Authorized redirect URIs (add each, then Save):\n");
for (const u of redirectUris) console.log(`  ${u}`);
console.log("\nAuthorized JavaScript origins (add each, then Save):\n");
for (const u of jsOrigins) console.log(`  ${u}`);

console.log("\n--- .env check ---\n");
if (env.GOOGLE_CLIENT_ID) console.log("  GOOGLE_CLIENT_ID: set");
else console.log("  GOOGLE_CLIENT_ID: MISSING");
if (env.GOOGLE_CLIENT_SECRET) console.log("  GOOGLE_CLIENT_SECRET: set");
else console.log("  GOOGLE_CLIENT_SECRET: MISSING");
console.log(`  PUBLIC_URL: ${env.PUBLIC_URL ?? "(not set — iPhone links use localhost)"}`);

if (!env.PUBLIC_URL || publicUrl.includes("localhost")) {
  console.log("\n--- iPhone (required) ---\n");
  console.log("  1. Terminal: ngrok http", port);
  console.log("  2. Copy the https://…. URL into .env as PUBLIC_URL=…");
  console.log("  3. Run this script again and add the new redirect URI in Google Console");
  console.log("  4. Restart: npm run run:all");
  const ips = lanIps();
  if (ips.length) {
    console.log("\n  (LAN IP", ips[0], "won't work for Google OAuth from iPhone — use ngrok.)");
  }
}

console.log("\nOAuth consent screen: add your Gmail as a test user if app is in Testing.\n");
