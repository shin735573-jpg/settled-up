ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS revisit_group_id uuid,
  ADD COLUMN IF NOT EXISTS revisit_visit_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revisit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revisit_done boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deliveries_revisit_group ON public.deliveries(revisit_group_id) WHERE revisit_group_id IS NOT NULL;