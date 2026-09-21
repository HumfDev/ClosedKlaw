-- Links the iMessage sender identity to the answers supplied during website onboarding.
-- The SMS service can resolve an inbound E.164 sender directly through this table.

CREATE TABLE IF NOT EXISTS public.onboarding_phone_links (
  phone text PRIMARY KEY,
  start_code text,
  visitor_id uuid,
  reasons text[] NOT NULL DEFAULT '{}'::text[],
  bottleneck text,
  search_channels text[] NOT NULL DEFAULT '{}'::text[],
  outcome text,
  optimize text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_phone_links_phone_e164
    CHECK (phone ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE INDEX IF NOT EXISTS onboarding_phone_links_start_code_idx
  ON public.onboarding_phone_links (start_code);

CREATE INDEX IF NOT EXISTS onboarding_phone_links_visitor_id_idx
  ON public.onboarding_phone_links (visitor_id)
  WHERE visitor_id IS NOT NULL;

COMMENT ON TABLE public.onboarding_phone_links IS
  'Service-role-only mapping from a verified iMessage sender to its website onboarding preferences.';

ALTER TABLE public.onboarding_phone_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.onboarding_phone_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.onboarding_phone_links TO service_role;
