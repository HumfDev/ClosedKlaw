-- Extend the phone-keyed onboarding record with the existing verified-user
-- fields, then copy every verified user without deleting or altering source data.

ALTER TABLE public.onboarding_phone_links
  ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS pronouns text NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS stripe_customer_id text NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS stripe_session_id text NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'N/A';

INSERT INTO public.onboarding_phone_links (
  phone,
  start_code,
  visitor_id,
  reasons,
  bottleneck,
  search_channels,
  outcome,
  optimize,
  full_name,
  pronouns,
  email,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_session_id,
  source,
  created_at,
  updated_at
)
SELECT
  verified.phone,
  COALESCE(verified.start_code, 'N/A'),
  funnel.visitor_id,
  COALESCE(funnel.reasons, ARRAY['N/A']::text[]),
  COALESCE(funnel.bottleneck, 'N/A'),
  COALESCE(funnel.search_channels, ARRAY['N/A']::text[]),
  COALESCE(funnel.outcome, 'N/A'),
  COALESCE(funnel.optimize, 'N/A'),
  COALESCE(verified.full_name, 'N/A'),
  COALESCE(verified.pronouns, 'N/A'),
  COALESCE(verified.email, 'N/A'),
  COALESCE(verified.stripe_customer_id, 'N/A'),
  COALESCE(verified.stripe_subscription_id, 'N/A'),
  COALESCE(verified.stripe_session_id, 'N/A'),
  COALESCE(verified.source, 'N/A'),
  verified.created_at,
  now()
FROM public.verified_numbers AS verified
LEFT JOIN LATERAL (
  SELECT visitor_id, reasons, bottleneck, search_channels, outcome, optimize
  FROM public.onboarding_funnel
  WHERE start_code = verified.start_code
  ORDER BY updated_at DESC
  LIMIT 1
) AS funnel ON true
ON CONFLICT (phone) DO UPDATE SET
  start_code = CASE
    WHEN EXCLUDED.start_code <> 'N/A' THEN EXCLUDED.start_code
    ELSE onboarding_phone_links.start_code
  END,
  visitor_id = COALESCE(EXCLUDED.visitor_id, onboarding_phone_links.visitor_id),
  reasons = CASE
    WHEN EXCLUDED.reasons <> ARRAY['N/A']::text[] THEN EXCLUDED.reasons
    ELSE onboarding_phone_links.reasons
  END,
  bottleneck = CASE
    WHEN EXCLUDED.bottleneck <> 'N/A' THEN EXCLUDED.bottleneck
    ELSE onboarding_phone_links.bottleneck
  END,
  search_channels = CASE
    WHEN EXCLUDED.search_channels <> ARRAY['N/A']::text[] THEN EXCLUDED.search_channels
    ELSE onboarding_phone_links.search_channels
  END,
  outcome = CASE
    WHEN EXCLUDED.outcome <> 'N/A' THEN EXCLUDED.outcome
    ELSE onboarding_phone_links.outcome
  END,
  optimize = CASE
    WHEN EXCLUDED.optimize <> 'N/A' THEN EXCLUDED.optimize
    ELSE onboarding_phone_links.optimize
  END,
  full_name = EXCLUDED.full_name,
  pronouns = EXCLUDED.pronouns,
  email = EXCLUDED.email,
  stripe_customer_id = EXCLUDED.stripe_customer_id,
  stripe_subscription_id = EXCLUDED.stripe_subscription_id,
  stripe_session_id = EXCLUDED.stripe_session_id,
  source = EXCLUDED.source,
  updated_at = now();

COMMENT ON TABLE public.onboarding_phone_links IS
  'Phone-keyed, service-role-only copy of verified-user identity, billing linkage, and website onboarding preferences.';
