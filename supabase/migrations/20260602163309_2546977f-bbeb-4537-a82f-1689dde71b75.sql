CREATE TABLE public.save_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  context_label text NOT NULL,
  conflict_count integer NOT NULL DEFAULT 1,
  current_snapshot jsonb NOT NULL,
  conflict_snapshot jsonb NOT NULL,
  diff_fields text[] NOT NULL DEFAULT '{}',
  conflict_row_id uuid,
  conflict_user_id uuid,
  conflict_created_at timestamptz,
  conflict_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.save_conflicts TO authenticated;
GRANT ALL ON public.save_conflicts TO service_role;

ALTER TABLE public.save_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own save_conflicts" ON public.save_conflicts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_save_conflicts_user_time ON public.save_conflicts(user_id, occurred_at DESC);