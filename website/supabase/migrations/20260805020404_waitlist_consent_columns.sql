-- Waitlist consent / age-attestation columns for compliance audit trail.
-- Project: dkeuetxjxpgvsnraqfkr
-- Table: public.waitlist
--
-- Apply via Supabase MCP/CLI, or paste into the SQL editor.
-- Safe to re-run: uses IF NOT EXISTS.

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS accepted_privacy boolean NOT NULL DEFAULT false;

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS terms_version text;

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS privacy_version text;

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS age_attested boolean NOT NULL DEFAULT false;

-- birthday remains nullable; app no longer writes it.
COMMENT ON COLUMN public.waitlist.accepted_privacy IS 'User acknowledged Privacy Policy at signup';
COMMENT ON COLUMN public.waitlist.terms_version IS 'Terms document version accepted (YYYY-MM-DD)';
COMMENT ON COLUMN public.waitlist.privacy_version IS 'Privacy document version acknowledged (YYYY-MM-DD)';
COMMENT ON COLUMN public.waitlist.accepted_at IS 'Client ISO timestamp when consent was recorded';
COMMENT ON COLUMN public.waitlist.age_attested IS 'User attested they are 18+ at signup';
