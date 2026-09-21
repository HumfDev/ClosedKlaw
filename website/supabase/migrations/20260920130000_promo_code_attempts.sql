-- A two-attempt limit for Checkout-bypass promo codes. Keys are SHA-256 hashes
-- of the onboarding start code or client IP, never the raw identifier.

CREATE TABLE IF NOT EXISTS public.promo_code_attempts (
  attempt_key text PRIMARY KEY,
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.promo_code_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.promo_code_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.promo_code_attempts TO service_role;
