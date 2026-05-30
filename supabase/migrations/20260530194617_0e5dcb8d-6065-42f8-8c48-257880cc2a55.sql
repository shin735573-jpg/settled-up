
CREATE TABLE public.leader_common_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  leader_id uuid NOT NULL,
  period_key text NOT NULL,
  common_deduction_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leader_id, period_key, common_deduction_id)
);

CREATE INDEX leader_common_overrides_lookup
  ON public.leader_common_overrides(user_id, period_key, leader_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leader_common_overrides TO authenticated;
GRANT ALL ON public.leader_common_overrides TO service_role;

ALTER TABLE public.leader_common_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own leader_common_overrides" ON public.leader_common_overrides
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER leader_common_overrides_touch BEFORE UPDATE ON public.leader_common_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
