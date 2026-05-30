ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS rejected_leader_id_2 uuid,
  ADD COLUMN IF NOT EXISTS rejected_leader_id_3 uuid;