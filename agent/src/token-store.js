import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "..", ".tokens.json");

function load() {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export function getTokens(userKey) {
  return load()[userKey] ?? {};
}

export function setTokens(userKey, service, tokens) {
  const store = load();
  if (!store[userKey]) store[userKey] = {};
  store[userKey][service] = { ...tokens, updatedAt: Date.now() };
  save(store);
}

export function getConnectedServices(userKey) {
  const tokens = getTokens(userKey);
  return Object.keys(tokens).filter((k) => {
    const t = tokens[k];
    return t?.access_token || t?.api_key;
  });
}
