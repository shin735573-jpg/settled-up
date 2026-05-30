CREATE TABLE public.price_list (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  company_id UUID,
  company_name TEXT NOT NULL,
  region_type TEXT NOT NULL CHECK (region_type IN ('metro','regional')),
  region_detail TEXT,
  item TEXT,
  spec TEXT,
  metro_fee NUMERIC NOT NULL DEFAULT 0,
  note_amount NUMERIC NOT NULL DEFAULT 0,
  regional_fee NUMERIC NOT NULL DEFAULT 0,
  cod_default NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_list TO authenticated;
GRANT ALL ON public.price_list TO service_role;

ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own price_list" ON public.price_list
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER price_list_touch_updated
  BEFORE UPDATE ON public.price_list
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_price_list_user ON public.price_list(user_id);
CREATE INDEX idx_price_list_company ON public.price_list(company_id);