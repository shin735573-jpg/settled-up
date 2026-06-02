-- 배송기록 중복 방지: dedupe_key 컬럼 + 자동 계산 트리거 + 부분 유니크 인덱스
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE OR REPLACE FUNCTION public.compute_delivery_dedupe_key(d public.deliveries)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
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
    coalesce(d.split_type, ''),
    case when d.paid then '1' else '0' end
  ], '|')
$$;

-- 기존 데이터 백필 (트리거 생성 전에 직접 채움)
UPDATE public.deliveries
SET dedupe_key = public.compute_delivery_dedupe_key(deliveries.*)
WHERE dedupe_key IS NULL;

-- 동일 키가 이미 여러 건이면 가장 오래된 것만 dedupe_key 유지, 나머지는 NULL
-- (부분 유니크 인덱스는 NULL을 무시하므로 기존 데이터는 보존되고 신규 중복만 차단됨)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, dedupe_key
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.deliveries
  WHERE dedupe_key IS NOT NULL
)
UPDATE public.deliveries d
SET dedupe_key = NULL
FROM ranked r
WHERE d.id = r.id AND r.rn > 1;

-- 트리거: insert 시 무조건 계산, update 시 관련 컬럼이 변했을 때만 재계산
CREATE OR REPLACE FUNCTION public.set_delivery_dedupe_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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
       AND NEW.split_type IS NOT DISTINCT FROM OLD.split_type
       AND NEW.paid IS NOT DISTINCT FROM OLD.paid
    THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.dedupe_key := public.compute_delivery_dedupe_key(NEW);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_deliveries_set_dedupe_key ON public.deliveries;
CREATE TRIGGER trg_deliveries_set_dedupe_key
BEFORE INSERT OR UPDATE ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_delivery_dedupe_key();

-- 부분 유니크 인덱스: dedupe_key가 NULL이 아닌 경우에만 사용자 단위로 유일성 보장
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_user_dedupe_key_uidx
ON public.deliveries (user_id, dedupe_key)
WHERE dedupe_key IS NOT NULL;