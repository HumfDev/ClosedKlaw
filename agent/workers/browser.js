import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROFILES_DIR =
  process.env.PROFILES_DIR ?? join(homedir(), ".imessage-agent", "profiles");

function sanitizeKey(userKey) {
  return userKey.replace(/[^a-zA-Z0-9+\-_.]/g, "_").slice(0, 60);
}

/**
 * Launch a persistent Chromium context for a user.
 * Persistent profiles preserve login sessions (Workday, LinkedIn, etc.)
 * across multiple jobs — the user only needs to log in manually once.
 *
 * headless:false is intentional for Workday/LinkedIn — those sites
 * fingerprint headless Chromium and serve bot-detection pages.
 */
export async function launchBrowser(userKey, { ats = "generic" } = {}) {
  const profilePath = join(PROFILES_DIR, sanitizeKey(userKey));
  mkdirSync(profilePath, { recursive: true });

  const sensitiveAts = ["workday", "linkedin"];
  const headless =
    process.env.BROWSER_HEADLESS === "true" && !sensitiveAts.includes(ats);

  const context = await chromium.launchPersistentContext(profilePath, {
    headless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
    ],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });

  return context;
}

export function getProfilesDir() {
  return PROFILES_DIR;
}
