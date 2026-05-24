import { config } from "./config.js";

const state = {
  responseCount: 0,
  lastResponseAt: 0,
  shutOff: false,
};

export function getAiSessionState() {
  return { ...state, remaining: Math.max(0, config.aiMaxResponses - state.responseCount) };
}

export function resetAiSession() {
  state.responseCount = 0;
  state.lastResponseAt = 0;
  state.shutOff = false;
}

export function checkAiLimits() {
  if (!config.aiEnabled) {
    return { allowed: false, reason: "ai disabled" };
  }
  if (state.shutOff || state.responseCount >= config.aiMaxResponses) {
    state.shutOff = true;
    return { allowed: false, reason: "ai session ended (max responses reached)" };
  }
  const elapsed = Date.now() - state.lastResponseAt;
  if (state.lastResponseAt > 0 && elapsed < config.aiMinIntervalMs) {
    const waitSec = Math.ceil((config.aiMinIntervalMs - elapsed) / 1000);
    return { allowed: false, reason: `rate limit (${waitSec}s until next reply)` };
  }
  return { allowed: true };
}

export function recordAiResponse() {
  state.responseCount += 1;
  state.lastResponseAt = Date.now();
  if (state.responseCount >= config.aiMaxResponses) {
    state.shutOff = true;
    console.log(
      `[ai] session ended after ${config.aiMaxResponses} responses — restart server to reset`,
    );
  }
}
