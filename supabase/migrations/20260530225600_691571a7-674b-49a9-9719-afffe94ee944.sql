
-- Validation trigger for team_leaders new fields
CREATE OR REPLACE FUNCTION public.validate_team_leader_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- settle_status whitelist
  IF NEW.settle_status IS NULL OR NEW.settle_status NOT IN ('included','excluded') THEN
    RAISE EXCEPTION '정산상태 값이 올바르지 않습니다 (included|excluded)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- account_number normalize
  IF NEW.account_number IS NOT NULL THEN
    NEW.account_number := btrim(NEW.account_number);
    IF NEW.account_number = '' THEN NEW.account_number := NULL; END IF;
  END IF;

  -- 계산서 발행 시 계좌번호 필수
  IF COALESCE(NEW.issues_invoice, true) = true
     AND COALESCE(NEW.active, true) = true
     AND COALESCE(NEW.is_virtual, false) = false
     AND (NEW.account_number IS NULL OR length(NEW.account_number) < 4) THEN
    RAISE EXCEPTION '계산서 발행 팀장(%) 은 계좌번호가 필요합니다', NEW.name
      USING ERRCODE = 'check_violation';
  END IF;

  -- 최저보장 금액 음수 금지
  IF COALESCE(NEW.min_guarantee_amount, 0) < 0 THEN
    RAISE EXCEPTION '최저보장 금액은 0 이상이어야 합니다'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 최저보장 활성 시 금액 > 0
  IF COALESCE(NEW.min_guarantee_enabled, false) = true
     AND COALESCE(NEW.min_guarantee_amount, 0) <= 0 THEN
    RAISE EXCEPTION '최저보장이 활성화된 팀장(%) 은 금액을 0보다 크게 입력해야 합니다', NEW.name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_team_leader_fields ON public.team_leaders;
CREATE TRIGGER trg_validate_team_leader_fields
BEFORE INSERT OR UPDATE ON public.team_leaders
FOR EACH ROW EXECUTE FUNCTION public.validate_team_leader_fields();
