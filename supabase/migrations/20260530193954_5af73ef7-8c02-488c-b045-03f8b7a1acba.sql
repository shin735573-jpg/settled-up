
CREATE TABLE public.common_deductions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  label text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.common_deductions TO authenticated;
GRANT ALL ON public.common_deductions TO service_role;

ALTER TABLE public.common_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own common_deductions" ON public.common_deductions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER common_deductions_touch BEFORE UPDATE ON public.common_deductions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


CREATE TABLE public.leader_period_deductions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  leader_id uuid NOT NULL,
  period_key text NOT NULL,
  label text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leader_period_deductions_lookup ON public.leader_period_deductions(user_id, leader_id, period_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leader_period_deductions TO authenticated;
GRANT ALL ON public.leader_period_deductions TO service_role;

ALTER TABLE public.leader_period_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own leader_period_deductions" ON public.leader_period_deductions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER leader_period_deductions_touch BEFORE UPDATE ON public.leader_period_deductions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
