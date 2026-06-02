ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS revisit_manual_shares jsonb,
  ADD COLUMN IF NOT EXISTS revisit_distributed boolean NOT NULL DEFAULT false;