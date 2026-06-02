CREATE OR REPLACE FUNCTION public.compute_delivery_dedupe_key(d deliveries)
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
    lower(btrim(coalesce(d.note, ''))),
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
       AND NEW.note IS NOT DISTINCT FROM OLD.note
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

-- Backfill all existing rows with new dedupe_key formula (now includes note).
-- Use a CTE that detects rows whose key actually changes, then resolve any conflicts
-- by keeping the earliest row's key and nulling the later duplicates' key so the
-- unique index does not fail. Admins can then inspect rows with null dedupe_key.
WITH recomputed AS (
  SELECT id, public.compute_delivery_dedupe_key(deliveries.*) AS new_key
  FROM public.deliveries
),
ranked AS (
  SELECT
    d.id,
    d.user_id,
    r.new_key,
    row_number() OVER (PARTITION BY d.user_id, r.new_key ORDER BY d.created_at, d.id) AS rn
  FROM public.deliveries d
  JOIN recomputed r ON r.id = d.id
)
UPDATE public.deliveries d
SET dedupe_key = CASE WHEN ranked.rn = 1 THEN ranked.new_key ELSE NULL END
FROM ranked
WHERE d.id = ranked.id
  AND d.dedupe_key IS DISTINCT FROM (CASE WHEN ranked.rn = 1 THEN ranked.new_key ELSE NULL END);