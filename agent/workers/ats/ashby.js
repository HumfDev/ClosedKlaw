/**
 * Ashby ATS autofill.
 *
 * Ashby (jobs.ashbyhq.com) renders application forms as a React SPA.
 * Fields use data-testid attributes prefixed with "_systemfield_" for
 * standard fields (name, email, phone) and numeric IDs for custom ones.
 * The form progresses through multiple "cards" — each card may need a
 * "Continue" click before the next appears.
 *
 * Detection: URL contains jobs.ashbyhq.com or ashby.io
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

  // Ashby may show a cookie / GDPR banner — dismiss it
  await page.locator("button:has-text('Accept'), button:has-text('I agree')").first()
    .click({ timeout: 3_000 }).catch(() => {});

  // ── Standard system fields ───────────────────────────────────────────────────
  await fillByTestId(page, "_systemfield_name", fullName(profile));
  // Some Ashby forms split name
  await fillByTestId(page, "_systemfield_firstName", profile.firstName);
  await fillByTestId(page, "_systemfield_lastName", profile.lastName);
  await fillByTestId(page, "_systemfield_email", profile.email);
  await fillByTestId(page, "_systemfield_phone", profile.phone);

  // Location
  if (profile.address?.city) {
    const loc = `${profile.address.city}, ${profile.address.state ?? ""}`.trim();
    await fillByTestId(page, "_systemfield_location", loc);
  }

  // Links
  await fillByTestId(page, "_systemfield_linkedin", profile.links?.linkedin);
  await fillByTestId(page, "_systemfield_github", profile.links?.github);
  await fillByTestId(page, "_systemfield_portfolio", profile.links?.portfolio ?? profile.links?.website);

  // ── Resume upload ────────────────────────────────────────────────────────────
  if (profile.resumePath) {
    // Ashby: file input inside the resume upload card
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible().catch(() => false)) {
      await fileInput.setInputFiles(profile.resumePath);
      // Wait for upload processing indicator to clear
      await page.waitForTimeout(1_500);
    }
  }

  // ── Multi-card progression ───────────────────────────────────────────────────
  // Ashby may paginate the form — click Continue buttons until Submit is visible
  const MAX_CARDS = 10;
  for (let i = 0; i < MAX_CARDS; i++) {
    await fillVisibleCustomFields(page, profile, resumeSummary, askQuestion);

    const submitBtn = page.locator("button[type=submit], button:has-text('Submit Application')").first();
    if (await submitBtn.isVisible({ timeout: 1_000 }).catch(() => false)) break;

    const continueBtn = page.locator("button:has-text('Continue'), button:has-text('Next')").first();
    if (await continueBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await continueBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    } else {
      break;
    }
  }

  if (!dryRun) {
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

// ── Field filling helpers ─────────────────────────────────────────────────────

function fullName(profile) {
  const parts = [profile.firstName, profile.lastName].filter(Boolean);
  return parts.join(" ") || profile.name || "";
}

async function fillByTestId(page, testId, value) {
  if (!value) return;
  // Ashby wraps inputs in divs with data-testid; the actual input is inside
  const input = page
    .locator(`[data-testid="${testId}"] input, [data-testid="${testId}"] textarea, input[data-testid="${testId}"], textarea[data-testid="${testId}"]`)
    .first();
  if (await input.isVisible().catch(() => false)) {
    await input.fill(String(value));
  }
}

/**
 * Fill all currently visible custom question fields on the page.
 * Ashby wraps each question in a div with role="group" or a label+input pair.
 */
async function fillVisibleCustomFields(page, profile, resumeSummary, askQuestion) {
  // Find all question containers that don't match system fields
  const questionDivs = await page
    .locator("div[data-testid]:not([data-testid^='_systemfield'])")
    .all();

  for (const div of questionDivs) {
    // Skip if no visible input/textarea/select inside
    const textarea = div.locator("textarea").first();
    const input = div.locator("input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox])").first();
    const select = div.locator("select").first();

    const label = await extractLabel(div);
    if (!label) continue;

    if (await textarea.isVisible().catch(() => false)) {
      const existing = await textarea.inputValue().catch(() => "");
      if (!existing.trim()) {
        const answer = await generateAnswer(label, profile, resumeSummary, askQuestion);
        await textarea.fill(answer);
      }
    } else if (await select.isVisible().catch(() => false)) {
      await handleSelect(select, label, askQuestion);
    } else if (await input.isVisible().catch(() => false)) {
      const existing = await input.inputValue().catch(() => "");
      if (!existing.trim()) {
        const answer = await generateAnswer(label, profile, resumeSummary, askQuestion);
        await input.fill(answer);
      }
    } else {
      await handleChoiceGroup(div, label, askQuestion);
    }
  }

  // Also handle ungrouped label+input pairs (some Ashby versions)
  const labels = await page.locator("label:visible").all();
  for (const labelEl of labels) {
    const forAttr = await labelEl.getAttribute("for").catch(() => null);
    if (!forAttr) continue;
    const labelText = (await labelEl.textContent().catch(() => ""))?.trim();
    if (!labelText) continue;

    const target = page.locator(`#${CSS.escape(forAttr)}`).first();
    if (!await target.isVisible().catch(() => false)) continue;

    const tagName = await target.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (!["input", "textarea", "select"].includes(tagName)) continue;

    const existing = await target.inputValue().catch(() => "");
    if (existing.trim()) continue;

    if (tagName === "select") {
      await handleSelect(target, labelText, askQuestion);
    } else {
      const answer = await generateAnswer(labelText, profile, resumeSummary, askQuestion);
      await target.fill(answer);
    }
  }
}

async function extractLabel(container) {
  const text = await container
    .locator("label, [class*='label'], [class*='question-text'], legend")
    .first()
    .textContent()
    .catch(() => "");
  return text?.trim() ?? "";
}

async function handleSelect(select, label, askQuestion) {
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

async function handleChoiceGroup(container, label, askQuestion) {
  const radios = await container.locator("input[type=radio]").all();
  if (!radios.length) return;

  const lowerLabel = label.toLowerCase();
  if (/authoriz|eligible|citizen|visa|sponsorship/.test(lowerLabel)) {
    for (const radio of radios) {
      const val = (await radio.getAttribute("value").catch(() => "")).toLowerCase();
      if (/^yes$|authorized|true/.test(val)) {
        await radio.check().catch(() => {});
        return;
      }
    }
  }

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
