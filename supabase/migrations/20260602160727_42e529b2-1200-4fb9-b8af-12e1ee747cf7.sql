
-- 1. companion 컬럼 추가
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS companion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS companion_reason text;

-- 2. dedupe_key 계산 함수에 companion 포함
CREATE OR REPLACE FUNCTION public.compute_delivery_dedupe_key(d public.deliveries)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT array_to_string(ARRAY[
    coalesce(d.date::text, ''),
    coalesce(d.company_id::text, lower(btrim(coalesce(d.company_name, '')))),
    lower(btrim(coalesce(d.customer_name, ''))),
    lower(btrim(coalesce(d.region, ''))),
    lower(btrim(coalesce(d.item, ''))),
    coalesce(d.leader1_id::text, ''),
    coalesce(d.leader2_id::text, ''),
    coalesce(d.metro_fee::text, '0'),
    coalesce(d.note_amount::text, '0'),
    coalesce(d.regional_fee::text, '0'),
    coalesce(d.cod_amount::text, '0'),
    case when d.two_person then '1' else '0' end,
    case when d.companion then '1' else '0' end,
    coalesce(d.split_type, ''),
    case when d.paid then '1' else '0' end
  ], '|')
$function$;

-- 3. 트리거 함수도 companion 변화 감지 포함
CREATE OR REPLACE FUNCTION public.set_delivery_dedupe_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.date IS NOT DISTINCT FROM OLD.date
       AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
       AND NEW.company_name IS NOT DISTINCT FROM OLD.company_name
       AND NEW.customer_name IS NOT DISTINCT FROM OLD.customer_name
       AND NEW.region IS NOT DISTINCT FROM OLD.region
       AND NEW.item IS NOT DISTINCT FROM OLD.item
       AND NEW.leader1_id IS NOT DISTINCT FROM OLD.leader1_id
       AND NEW.leader2_id IS NOT DISTINCT FROM OLD.leader2_id
       AND NEW.metro_fee IS NOT DISTINCT FROM OLD.metro_fee
       AND NEW.note_amount IS NOT DISTINCT FROM OLD.note_amount
       AND NEW.regional_fee IS NOT DISTINCT FROM OLD.regional_fee
       AND NEW.cod_amount IS NOT DISTINCT FROM OLD.cod_amount
       AND NEW.two_person IS NOT DISTINCT FROM OLD.two_person
       AND NEW.companion IS NOT DISTINCT FROM OLD.companion
       AND NEW.split_type IS NOT DISTINCT FROM OLD.split_type
       AND NEW.paid IS NOT DISTINCT FROM OLD.paid
    THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.dedupe_key := public.compute_delivery_dedupe_key(NEW);
  RETURN NEW;
END
$function$;

-- 4. 트리거가 deliveries에 붙어있지 않다면 부착
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.deliveries'::regclass
      AND tgname = 'trg_deliveries_set_dedupe_key'
  ) THEN
    CREATE TRIGGER trg_deliveries_set_dedupe_key
      BEFORE INSERT OR UPDATE ON public.deliveries
      FOR EACH ROW EXECUTE FUNCTION public.set_delivery_dedupe_key();
  END IF;
END $$;
