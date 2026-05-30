ALTER TABLE public.team_leaders
  ADD COLUMN IF NOT EXISTS issues_invoice boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS settle_status text NOT NULL DEFAULT 'included',
  ADD COLUMN IF NOT EXISTS min_guarantee_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_guarantee_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.team_leaders
  DROP CONSTRAINT IF EXISTS team_leaders_settle_status_check;
ALTER TABLE public.team_leaders
  ADD CONSTRAINT team_leaders_settle_status_check
  CHECK (settle_status IN ('included','excluded'));

-- 기존 데이터 마이그레이션: settle_to_id 가 지정된 팀장은 '정산제외'
UPDATE public.team_leaders
  SET settle_status = 'excluded'
  WHERE settle_to_id IS NOT NULL;