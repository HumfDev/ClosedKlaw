-- The setup screen accepts any non-empty name; downstream application flows may
-- request clarification when a fuller legal name is needed.

ALTER TABLE public.verified_numbers
  DROP CONSTRAINT IF EXISTS verified_numbers_full_name_len;

ALTER TABLE public.verified_numbers
  ADD CONSTRAINT verified_numbers_full_name_len
  CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 120);
