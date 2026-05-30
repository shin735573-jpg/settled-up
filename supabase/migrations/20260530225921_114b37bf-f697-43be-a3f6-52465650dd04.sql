
CREATE OR REPLACE FUNCTION public.validate_team_leader_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.settle_status IS NULL OR NEW.settle_status NOT IN ('included','excluded') THEN
    RAISE EXCEPTION '정산상태 값이 올바르지 않습니다 (included|excluded)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.account_number IS NOT NULL THEN
    NEW.account_number := btrim(NEW.account_number);
    IF NEW.account_number = '' THEN NEW.account_number := NULL; END IF;
  END IF;

  IF COALESCE(NEW.min_guarantee_amount, 0) < 0 THEN
    RAISE EXCEPTION '최저보장 금액은 0 이상이어야 합니다'
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(NEW.min_guarantee_enabled, false) = true
     AND COALESCE(NEW.min_guarantee_amount, 0) <= 0 THEN
    RAISE EXCEPTION '최저보장이 활성화된 팀장(%) 은 금액을 0보다 크게 입력해야 합니다', NEW.name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
