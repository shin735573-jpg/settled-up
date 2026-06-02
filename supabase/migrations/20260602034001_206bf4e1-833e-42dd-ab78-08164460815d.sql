ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS alba_deduction numeric NOT NULL DEFAULT 0;