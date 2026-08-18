-- Anonymous onboarding funnel: homepage, each /start step, checkout, paid, and selected preferences.
-- Project: dkeuetxjxpgvsnraqfkr
-- Table: public.onboarding_funnel
--
-- Writes go through the website service-role API, not the browser anon key.

CREATE TABLE IF NOT EXISTS public.onboarding_funnel (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id uuid NOT NULL UNIQUE,
  homepage_at timestamptz,
  onboarding_step_why_at timestamptz,
  onboarding_step_bottleneck_at timestamptz,
  onboarding_step_channels_at timestamptz,
  onboarding_step_outcome_at timestamptz,
  onboarding_step_optimize_at timestamptz,
  found_at timestamptz,
  checkout_at timestamptz,
  paid_at timestamptz,
  unlock_at timestamptz,
  reasons text[] NOT NULL DEFAULT '{}'::text[],
  bottleneck text,
  search_channels text[] NOT NULL DEFAULT '{}'::text[],
  outcome text,
  optimize text,
  start_code text,
  stripe_session_id text,
  used_promo boolean NOT NULL DEFAULT false,
  referrer text,
  landing_path text,
  last_page text,
  last_event text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_funnel_created_at_idx
  ON public.onboarding_funnel (created_at DESC);

CREATE INDEX IF NOT EXISTS onboarding_funnel_paid_at_idx
  ON public.onboarding_funnel (paid_at)
  WHERE paid_at IS NOT NULL;

COMMENT ON TABLE public.onboarding_funnel IS
  'Anonymous website onboarding funnel: homepage, each start.html step, checkout, paid, and selected preferences.';

COMMENT ON COLUMN public.onboarding_funnel.visitor_id IS
  'Anonymous UUID stored in the browser (localStorage). One row per visitor.';

ALTER TABLE public.onboarding_funnel ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.onboarding_funnel FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.onboarding_funnel TO service_role;
