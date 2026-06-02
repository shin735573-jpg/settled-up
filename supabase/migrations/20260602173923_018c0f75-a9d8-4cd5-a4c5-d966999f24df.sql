CREATE TABLE public.delivery_merge_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  base_row_id uuid NOT NULL,
  merge_action text NOT NULL,
  base_before jsonb NOT NULL,
  base_after jsonb NOT NULL,
  merged_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  merged_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_merge_log TO authenticated;
GRANT ALL ON public.delivery_merge_log TO service_role;

ALTER TABLE public.delivery_merge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own delivery_merge_log"
  ON public.delivery_merge_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_delivery_merge_log_user_date
  ON public.delivery_merge_log (user_id, merged_at DESC);
CREATE INDEX idx_delivery_merge_log_base
  ON public.delivery_merge_log (base_row_id);
