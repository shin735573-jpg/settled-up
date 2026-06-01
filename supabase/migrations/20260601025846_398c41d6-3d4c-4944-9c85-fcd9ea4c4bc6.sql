CREATE TABLE public.special_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.special_items TO authenticated;
GRANT ALL ON public.special_items TO service_role;

ALTER TABLE public.special_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own special_items"
ON public.special_items
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER touch_special_items_updated_at
BEFORE UPDATE ON public.special_items
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();