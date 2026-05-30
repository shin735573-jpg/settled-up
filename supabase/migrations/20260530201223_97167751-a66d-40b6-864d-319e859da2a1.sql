ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS settlement_cycle text NOT NULL DEFAULT 'biweekly',
  ADD COLUMN IF NOT EXISTS rejected_leader_id uuid;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_settlement_cycle_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_settlement_cycle_check
  CHECK (settlement_cycle IN ('biweekly','monthly'));