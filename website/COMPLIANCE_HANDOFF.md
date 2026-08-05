# KleoKlaw Website Compliance Handoff

Work that must happen outside the `website/` repo. Each item lists the reason, affected public promise, and owner.

**Deploy posture (locked):**
- **Waitlist-only** soft launch is allowed after the waitlist schema migration (done — see below).
- **Paid ads / paid acquisition remain blocked** until handoff #1, #2, #4, #5, and SMS “cancel in stripe” fix land in the product repo.
- Terms/Privacy redlines are **accuracy drafts, not lawyer-approved**.
- Publicity remains opt-out-by-email for now; counsel nice-to-have: switch to opt-in.

---

## Schema migration status — DONE

**Project:** `dkeuetxjxpgvsnraqfkr`  
**Table:** `public.waitlist`  
**Applied:** 2026-08-05 via Supabase MCP (`waitlist_consent_columns`)  
**Checked-in SQL:** [`supabase/migrations/20260805020404_waitlist_consent_columns.sql`](supabase/migrations/20260805020404_waitlist_consent_columns.sql)

Columns added (matching `accepted_terms` style where applicable):
- `accepted_privacy boolean NOT NULL DEFAULT false`
- `terms_version text`
- `privacy_version text`
- `accepted_at timestamptz`
- `age_attested boolean NOT NULL DEFAULT false`

`birthday` remains nullable; app no longer writes it.

**Verified:** service-role insert without `birthday`, with consent metadata persisted; attestation reject path returns required 18+ error. Test row deleted.

See also [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md).

---

## 1. Stripe Customer Portal (blocks paid marketing confidence)

**Owner:** Product engineering

**Reason:** Public copy now states cancellation via `founders@kleoklaw.com` only. That is accurate but weak for auto-renew subscriptions. A self-serve cancellation path (Stripe Customer Portal or equivalent) must be at least as easy as signup. Founders@ will be monitored operationally for waitlist-only; portal remains required before paid scale.

**Affected promise:** FAQ, billing disclosure, Terms §8.4.3 cancellation procedures.

**Priority:** P0 — blocks paid marketing confidence.

---

## 2. Record Terms + Privacy acceptance on paid onboarding

**Owner:** Product engineering

**Reason:** Waitlist now records consent metadata (`termsVersion`, `privacyVersion`, `acceptedAt`). Paid users who onboard entirely over iMessage have no recorded Terms/Privacy acceptance.

**Affected promise:** Legal audit trail for paid subscribers.

**Priority:** P0 — blocks fully clean paid path.

---

## 3. Fix past-due subscription status mapping

**Owner:** Product engineering

**Reason:** Past-due payments may be treated as cancelled in subscription status mapping, causing incorrect access or messaging.

**Affected promise:** Billing accuracy and user communications.

---

## 4. Verify live Stripe Price object

**Owner:** Product engineering

**Reason:** Website copy asserts $50 USD/month with 7-day free trial. Amount is hardcoded in `billing.html`, not derived from Stripe.

**Affected promise:** Billing page price, Terms §8.4.1, landing FAQ pricing.

**Action:** Confirm `STRIPE_PRICE_ID_MONTHLY` is exactly $50 USD/month with exactly 7-day trial.

---

## 5. Retire weekly Stripe price and checkout (P0 for paid)

**Owner:** Product engineering

**Reason:** Website has **zero** public $20 / weekly plan copy. Product API still accepts `plan: "weekly"` and `STRIPE_PRICE_ID_WEEKLY` remains configured. SMS path does not sell weekly, but web checkout with `weekly` still can.

**Affected promise:** Single-plan consistency across all surfaces.

**Priority:** **P0 hard blocker for any paid marketing deploy.** Waitlist-only marketing may ship without killing weekly in product; do not promote checkout until weekly is retired.

**Action:** Remove weekly price ID, checkout endpoint branch, and any residual weekly offers. Do not leave a purchasable weekly plan anywhere.

**Also P0 for paid:** SMS trial reminders still say “cancel in stripe” / “cancel anytime in stripe” — contradicts public Terms/FAQ (founders@ only). Fix in product repo before paid scale.

---

## 6. Delete persistent browser automation profiles on account deletion

**Owner:** Product engineering

**Reason:** Privacy Policy now discloses that browser automation profiles may survive account deletion.

**Affected promise:** Privacy §1 (Browser automation profiles), §7 retention.

**Alternative:** Keep disclosure if deletion is not implemented.

---

## 7. Align deletion routine with published retention language

**Owner:** Product engineering

**Reason:** Privacy §7 now states immediate deletion from active systems on account deletion request, matching `delete_user_account` behavior. Verify no residual retention logic contradicts this.

**Affected promise:** Privacy §7 vs `delete_user_account` in `kleoklaw/core/db/firestore_client.py`.

**Citation (what deletion removes):** user profile, preferences, settings, vault entries (DEK zeroized), match features, pending actions, agent memory, onboarding session, agent/recruiter messages, Postgres queue rows, R2 `users/{user_id}/` prefix.

---

## 8. Confirm AI provider training settings

**Owner:** Product engineering + counsel

**Reason:** Privacy and Terms state resume/application data is not used to train general-purpose models, subject to provider API terms.

**Affected promise:** Privacy §5, Terms §3.2.

**Action:** Verify contracts/settings for every model provider in use (including DeepSeek).

---

## 9. Confirm tax collection in Stripe checkout

**Owner:** Product engineering

**Reason:** Terms softened to "taxes may apply where required." Checkout code does not set `automatic_tax`.

**Affected promise:** Terms §8.1, billing disclosure.

---

## 10. Website README documentation note

**Owner:** Website / docs

**Reason:** Contributors may hand-edit generated Terms files.

**Action:** Add note: Terms are generated from `legal/terms-source.txt` via `npm run terms:build`; never hand-edit `terms.html` or `terms-fragment.html`. `privacy.html` is hand-maintained.

---

## 11. Counsel queue

**Owner:** Counsel

Items implemented as drafts in `legal/terms-source.txt`, pending sign-off:

| Item | Section | Summary |
|------|---------|---------|
| Cancellation removal of 30-day notice | §8.4.3 | Cancel anytime by email; ends at period end |
| Automatic-renewal disclosures | §8.4 | Negative-option adequacy for states served |
| Party name Kleo Labs Inc | §8.4, §14, §17 | Charging/waiver/indemnity party |
| Mobile apps conditional language | Intro, §12 | Apps only if/when available |
| iMessage messaging consent | §10 | Transactional vs promotional; STOP/HELP |
| ATS automation authorization | §11 | Account creation, credentials, OTP mailbox, local agent |
| Single $50/month plan language | §8.4.1 | No weekly plan |
| Export control trim | §19 | Consumer product scope |
| California governing law + WA address | §17.1 | Intentional choice review |
| Publicity clause | §7 | Opt-out vs opt-in |
| Liability cap + arbitration | §16–17 | Consumer product adequacy |
| Employment-agency licensing | §11 | Limited-agent model |
| Demographic collection | Waitlist | Optional gender exposure |

---

## Waitlist schema note

**Resolved (2026-08-05).** Consent columns are migrated on production Supabase. Website insert keeps audit fields and does not write `birthday`. Waitlist-only deploy may proceed after human Vercel checks in [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md). Paid remains blocked per items #1, #2, #4, #5 (weekly + SMS cancel contradiction).

