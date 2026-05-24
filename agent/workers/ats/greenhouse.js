/**
 * Greenhouse ATS autofill.
 *
 * Greenhouse uses predictable named inputs across all companies:
 *   first_name, last_name, email, phone, job_application[resume]
 * Custom questions are <input> / <select> / <textarea> inside
 * <div class="field"> elements with a <label> for the field name.
 *
 * Detection: URL contains boards.greenhouse.io or greenhouse.io/jobs
 */

import { generateAnswer } from "../llm-answer.js";

const FIELD_MAP = {
  first_name: (p) => p.firstName,
  last_name: (p) => p.lastName,
  email: (p) => p.email,
  phone: (p) => p.phone,
  "job_application[first_name]": (p) => p.firstName,
  "job_application[last_name]": (p) => p.lastName,
  "job_application[email]": (p) => p.email,
  "job_application[phone]": (p) => p.phone,
};

const LOCATION_FIELDS = ["job_application[location]", "location"];
const LINKEDIN_FIELDS = ["job_application[answers_attributes][0][text_value]", "linkedin_profile"];
const GITHUB_FIELDS = ["job_application[answers_attributes][1][text_value]", "github_username"];
const PORTFOLIO_FIELDS = ["job_application[answers_attributes][2][text_value]", "website"];

/**
 * @param {import('playwright').Page} page
 * @param {object} profile - Structured resume fields
 * @param {object} opts
 * @param {string} opts.resumeSummary
 * @param {(q: string) => Promise<string>} opts.askQuestion
 * @param {boolean} [opts.dryRun] - Fill but do not submit
 */
export async function fill(page, profile, { resumeSummary, askQuestion, dryRun = false } = {}) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // ── Basic identity fields ──────────────────────────────────────────────────
  for (const [name, getValue] of Object.entries(FIELD_MAP)) {
    const value = getValue(profile);
    if (!value) continue;
    const input = page.locator(`input[name="${name}"]`).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(String(value));
    }
  }

  // ── Location ───────────────────────────────────────────────────────────────
  if (profile.address?.city) {
    const loc = `${profile.address.city}, ${profile.address.state ?? ""}`.trim();
    for (const name of LOCATION_FIELDS) {
      const input = page.locator(`input[name="${name}"]`).first();
      if (await input.isVisible().catch(() => false)) {
        await input.fill(loc);
        break;
      }
    }
  }

  // ── Links ──────────────────────────────────────────────────────────────────
  await fillLink(page, LINKEDIN_FIELDS, profile.links?.linkedin);
  await fillLink(page, GITHUB_FIELDS, profile.links?.github);
  await fillLink(page, PORTFOLIO_FIELDS, profile.links?.portfolio);

  // ── Resume upload ──────────────────────────────────────────────────────────
  // Resume file upload is handled by the worker via page.setInputFiles
  // when profile.resumePath is set (passed from job.resumeFilePath).

  // ── Custom questions ───────────────────────────────────────────────────────
  const customFields = await page.locator(".field").all();
  for (const field of customFields) {
    const label = await field.locator("label").first().textContent().catch(() => "");
    if (!label?.trim()) continue;

    const textarea = field.locator("textarea").first();
    const input = field.locator("input:not([type=hidden]):not([type=file])").first();
    const select = field.locator("select").first();

    if (await textarea.isVisible().catch(() => false)) {
      const existing = await textarea.inputValue().catch(() => "");
      if (!existing.trim()) {
        const answer = await generateAnswer(label, profile, resumeSummary, askQuestion);
        await textarea.fill(answer);
      }
    } else if (await select.isVisible().catch(() => false)) {
      await handleSelect(select, label, profile, resumeSummary, askQuestion);
    } else if (await input.isVisible().catch(() => false)) {
      const type = await input.getAttribute("type").catch(() => "text");
      if (type !== "radio" && type !== "checkbox") {
        const existing = await input.inputValue().catch(() => "");
        if (!existing.trim()) {
          const answer = await generateAnswer(label, profile, resumeSummary, askQuestion);
          await input.fill(answer);
        }
      }
    }
  }

  if (!dryRun) {
    const submitBtn = page.locator("button[type=submit], input[type=submit]").first();
    await submitBtn.click({ timeout: 5_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  }

  // Try to extract an application reference from the confirmation page
  const bodyText = await page.textContent("body").catch(() => "");
  const refMatch = bodyText.match(/application\s+(?:id|number|ref(?:erence)?)[:\s#]+([A-Z0-9\-]+)/i);
  return { appId: refMatch?.[1] ?? null, pageTitle: await page.title().catch(() => "") };
}

async function fillLink(page, fieldNames, value) {
  if (!value) return;
  for (const name of fieldNames) {
    const input = page.locator(`input[name="${name}"]`).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(value);
      return;
    }
  }
}

async function handleSelect(select, label, profile, resumeSummary, askQuestion) {
  const options = await select.locator("option").allTextContents();
  const lowerLabel = label.toLowerCase();
  const lowerOptions = options.map((o) => o.toLowerCase().trim());

  // Work authorization: auto-pick "yes" / "authorized" / "citizen"
  if (/authoriz|eligible|citizen|visa|sponsorship/.test(lowerLabel)) {
    const yesIdx = lowerOptions.findIndex((o) => /^yes$|authorized|citizen|eligible/.test(o));
    if (yesIdx > 0) {
      await select.selectOption({ index: yesIdx });
      return;
    }
  }

  // For other selects, ask the user
  const answer = await askQuestion(`${label} — options: ${options.filter(Boolean).join(", ")}`);
  const matchIdx = lowerOptions.findIndex((o) => o.includes(answer.toLowerCase()));
  if (matchIdx >= 0) await select.selectOption({ index: matchIdx });
}
