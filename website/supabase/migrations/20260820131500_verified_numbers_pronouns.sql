-- Pronouns on the paid-subscriber iMessage allowlist.
-- Project: dkeuetxjxpgvsnraqfkr
-- Table: public.verified_numbers
--
-- Stored as a slash-separated pair (he/him, she/her, or a custom pair).

ALTER TABLE public.verified_numbers
  ADD COLUMN IF NOT EXISTS pronouns text;

ALTER TABLE public.verified_numbers
  DROP CONSTRAINT IF EXISTS verified_numbers_pronouns_format;

ALTER TABLE public.verified_numbers
  ADD CONSTRAINT verified_numbers_pronouns_format
  CHECK (
    pronouns IS NULL
    OR pronouns ~ '^[a-z][a-z''-]{0,19}/[a-z][a-z''-]{0,19}$'
  );

COMMENT ON COLUMN public.verified_numbers.pronouns IS
  'Subscriber pronouns as a slash-separated pair, e.g. he/him, she/her, they/them.';
