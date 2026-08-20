-- Paid-subscriber full name on the iMessage allowlist.
-- Project: dkeuetxjxpgvsnraqfkr
-- Table: public.verified_numbers
--
-- Captured after Checkout if Stripe customer_details.name is missing,
-- then stored with the verified iPhone number.

ALTER TABLE public.verified_numbers
  ADD COLUMN IF NOT EXISTS full_name text;

ALTER TABLE public.verified_numbers
  DROP CONSTRAINT IF EXISTS verified_numbers_full_name_len;

ALTER TABLE public.verified_numbers
  ADD CONSTRAINT verified_numbers_full_name_len
  CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 2 AND 120);

COMMENT ON COLUMN public.verified_numbers.full_name IS
  'Subscriber full name, captured after checkout when Stripe did not already have it.';
