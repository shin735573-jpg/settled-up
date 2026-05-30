
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS is_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS missing_reason text;

CREATE INDEX IF NOT EXISTS idx_deliveries_is_missing ON public.deliveries(is_missing) WHERE is_missing = true;
