# Waitlist-only deploy checklist

**Current branch:** `main`  
**Scope:** Marketing site (`website/`) only. Soft launch = waitlist traffic. No paid ads / paid acquisition.

Terms/Privacy changes are **accuracy drafts, not lawyer-approved**.

---

## WAITLIST-ONLY — GO when all checked

- [x] Supabase consent columns migrated and verified  
  Project `dkeuetxjxpgvsnraqfkr` / `public.waitlist`: `accepted_privacy`, `terms_version`, `privacy_version`, `accepted_at`, `age_attested`.  
  Migration file: [`supabase/migrations/20260805020404_waitlist_consent_columns.sql`](supabase/migrations/20260805020404_waitlist_consent_columns.sql)
- [x] Real waitlist insert succeeded without `birthday`; consent fields stored (service-role insert matching API row shape; test row deleted)
- [x] Attestation failure still rejected (`ageAttested: false` → “You must be 18 or older to join KleoKlaw.”)
- [ ] **Human:** Vercel Root Directory = `website` (confirm in Vercel project settings)
- [ ] **Human:** Branch to deploy: `main` (or the branch that contains these website changes if you deploy from another branch)
- [ ] **Post-deploy:** Hard-refresh `/`, `/terms`, `/privacy`, `/support` — confirm 200 + new copy (entity footer, single $29.99 plan language, no weekly/$20)
- [ ] **Post-deploy:** Submit one real waitlist signup on production (browser + Turnstile)

---

## PAID — NO-GO until all checked

Do **not** ramp paid ads or promote checkout until:

- [ ] Weekly Stripe price/checkout retired in product repo (`../KleoKlaw`) — still purchasable via API `plan: "weekly"` today. **Hard blocker for paid.**
- [ ] Live Stripe monthly price verified = **$29.99 USD**, trial = **1 month**
- [ ] SMS copy no longer says “cancel in stripe” / “cancel anytime in stripe”; texting `CANCEL` directs to the cancellation page
- [ ] Cancellation page works end-to-end after a `CANCEL` text
- [ ] Prefer Stripe Customer Portal (handoff #1) — **blocks paid marketing confidence**
- [ ] Prefer recorded Terms/Privacy on paid iMessage path (handoff #2)

Website has **no** public $20 / weekly plan copy. Product-repo weekly remains a paid blocker only.

---

## Apply migration (if re-running elsewhere)

```bash
# Or paste website/supabase/migrations/20260805020404_waitlist_consent_columns.sql
# into Supabase SQL editor for project dkeuetxjxpgvsnraqfkr
```

Verify:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'waitlist'
  AND column_name IN (
    'accepted_privacy','terms_version','privacy_version','accepted_at','age_attested','birthday'
  )
ORDER BY column_name;
```

---

## Explicitly out of this deploy

- No commit/deploy until you say so
- No `../KleoKlaw` SMS/weekly/portal code changes in this pass
- No EEA consent banner; US-only Privacy posture remains
