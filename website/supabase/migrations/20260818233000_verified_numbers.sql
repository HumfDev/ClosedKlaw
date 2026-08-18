-- Paid-subscriber iMessage allowlist.
-- Project: dkeuetxjxpgvsnraqfkr
-- Table: public.verified_numbers
--
-- Only these E.164 numbers may text Kleo. The website service-role API inserts
-- a row after Checkout + phone capture, and deletes it when Stripe reports
-- the subscription as canceled.
--
-- Writes go through the website service-role API, not the browser anon key.

CREATE TABLE IF NOT EXISTS public.verified_numbers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  email text,
  start_code text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_session_id text,
  source text NOT NULL DEFAULT 'checkout',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_numbers_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT verified_numbers_source_check CHECK (source = ANY (ARRAY['checkout'::text, 'promo'::text]))
);

CREATE INDEX IF NOT EXISTS verified_numbers_stripe_customer_id_idx
  ON public.verified_numbers (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS verified_numbers_stripe_subscription_id_idx
  ON public.verified_numbers (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS verified_numbers_stripe_session_id_idx
  ON public.verified_numbers (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

COMMENT ON TABLE public.verified_numbers IS
  'Paid-subscriber iMessage allowlist. Only these E.164 numbers may text Kleo. Inserted after checkout + phone capture; deleted when the Stripe subscription is canceled.';

COMMENT ON COLUMN public.verified_numbers.phone IS
  'Subscriber iMessage number in E.164. This is the only identity Kleo should accept inbound texts from.';

ALTER TABLE public.verified_numbers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.verified_numbers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verified_numbers TO service_role;
