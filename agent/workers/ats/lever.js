/**
 * Lever ATS autofill.
 *
 * Lever's application forms at jobs.lever.co use a consistent React-rendered
 * structure with inputs identified by name attributes and aria-label.
 * Each section (personal info, resume, custom questions) is a separate card.
 *
 * Detection: URL contains jobs.lever.co
 */

import { generateAnswer } from "../llm-answer.js";

/**
 * @param {import('playwright').Page} page
 * @param {object} profile - Structured resume fields
 * @param {object} opts
 * @param {string} opts.resumeSummary
 * @param {(q: string) => Promise<string>} opts.askQuestion
 * @param {boolean} [opts.dryRun]
 */
export async function fill(page, profile, { resumeSummary, askQuestion, dryRun = false } = {}) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // ── Personal info ────────────────────────────────────────────────────────────
  await fillInput(page, 'input[name="name"]', fullName(profile));
  await fillInput(page, 'input[name="email"]', profile.email);
  await fillInput(page, 'input[name="phone"]', profile.phone);
  await fillInput(page, 'input[name="org"]', profile.experience?.[0]?.company ?? "");

  // Location — Lever may use a text input or autocomplete
  if (profile.address?.city) {
    const loc = `${profile.address.city}, ${profile.address.state ?? ""}`.trim();
    await fillInput(page, 'input[name="location"]', loc);
  }

  // ── Links ────────────────────────────────────────────────────────────────────
  await fillInput(page, 'input[name="urls[LinkedIn]"]', profile.links?.linkedin ?? "");
  await fillInput(page, 'input[name="urls[GitHub]"]', profile.links?.github ?? "");
  await fillInput(page, 'input[name="urls[Portfolio]"]', profile.links?.portfolio ?? "");
  await fillInput(page, 'input[name="urls[Other]"]', profile.links?.website ?? "");

  // ── Resume upload ────────────────────────────────────────────────────────────
  if (profile.resumePath) {
    const resumeInput = page.locator('input[type="file"]').first();
    if (await resumeInput.isVisible().catch(() => false)) {
      await resumeInput.setInputFiles(profile.resumePath);
    }
  }

  // ── Custom questions ─────────────────────────────────────────────────────────
  // Lever renders custom questions in <div class="application-question"> wrappers
  const questionCards = await page.locator(".application-question").all();
  for (const card of questionCards) {
    const label = await extractLabel(card);
    if (!label) continue;

    const textarea = card.locator("textarea").first();
    const select = card.locator("select").first();
    const input = card.locator("input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox])").first();

    if (await textarea.isVisible().catch(() => false)) {
      const existing = await textarea.inputValue().catch(() => "");
      if (!existing.trim()) {
        const answer = await generateAnswer(label, profile, resumeSummary, askQuestion);
        await textarea.fill(answer);
      }
    } else if (await select.isVisible().catch(() => false)) {
      await handleSelect(select, label, profile, resumeSummary, askQuestion);
    } else if (await input.isVisible().catch(() => false)) {
      const existing = await input.inputValue().catch(() => "");
      if (!existing.trim()) {
        const answer = await generateAnswer(label, profile, resumeSummary, askQuestion);
        await input.fill(answer);
      }
    } else {
      // Radio / checkbox group
      await handleChoiceGroup(card, label, profile, resumeSummary, askQuestion);
    }
  }

  if (!dryRun) {
    // Lever's submit button: "Submit Application"
    const submitBtn = page
      .locator("button[type=submit], button:has-text('Submit Application')")
      .first();
    await submitBtn.click({ timeout: 5_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  }

  const bodyText = await page.textContent("body").catch(() => "");
  const refMatch = bodyText.match(/application\s+(?:id|number|ref(?:erence)?)[:\s#]+([A-Z0-9\-]+)/i);
  return { appId: refMatch?.[1] ?? null, pageTitle: await page.title().catch(() => "") };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fullName(profile) {
  const parts = [profile.firstName, profile.lastName].filter(Boolean);
  return parts.join(" ") || profile.name || "";
}

async function fillInput(page, selector, value) {
  if (!value) return;
  const el = page.locator(selector).first();
  if (await el.isVisible().catch(() => false)) {
    await el.fill(String(value));
  }
}

async function extractLabel(card) {
  const label = await card.locator("label, .application-label, [class*='label']").first().textContent().catch(() => "");
  return label?.trim() ?? "";
}

async function handleSelect(select, label, profile, resumeSummary, askQuestion) {
  const options = await select.locator("option").allTextContents();
  const lowerLabel = label.toLowerCase();
  const lowerOptions = options.map((o) => o.toLowerCase().trim());

  if (/authoriz|eligible|citizen|visa|sponsorship/.test(lowerLabel)) {
    const yesIdx = lowerOptions.findIndex((o) => /^yes$|authorized|citizen|eligible/.test(o));
    if (yesIdx > 0) {
      await select.selectOption({ index: yesIdx });
      return;
    }
  }

  const answer = await askQuestion(`${label} — options: ${options.filter(Boolean).join(", ")}`);
  const matchIdx = lowerOptions.findIndex((o) => o.includes(answer.toLowerCase()));
  if (matchIdx >= 0) await select.selectOption({ index: matchIdx });
}

async function handleChoiceGroup(card, label, profile, resumeSummary, askQuestion) {
  const radios = await card.locator("input[type=radio]").all();
  if (!radios.length) return;

  const lowerLabel = label.toLowerCase();

  // Work auth: auto-select "yes"
  if (/authoriz|eligible|citizen|visa|sponsorship/.test(lowerLabel)) {
    for (const radio of radios) {
      const val = (await radio.getAttribute("value").catch(() => "")).toLowerCase();
      if (/^yes$|authorized|true/.test(val)) {
        await radio.check().catch(() => {});
        return;
      }
    }
  }

  // Generic: ask user
  const radioLabels = [];
  for (const radio of radios) {
    const val = await radio.getAttribute("value").catch(() => "");
    if (val) radioLabels.push(val);
  }
  if (!radioLabels.length) return;
  const answer = await askQuestion(`${label} — choose one: ${radioLabels.join(", ")}`);
  for (const radio of radios) {
    const val = (await radio.getAttribute("value").catch(() => "")).toLowerCase();
    if (val.includes(answer.toLowerCase())) {
      await radio.check().catch(() => {});
      return;
    }
  }
}
