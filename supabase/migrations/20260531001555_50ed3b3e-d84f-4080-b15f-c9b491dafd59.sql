ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;