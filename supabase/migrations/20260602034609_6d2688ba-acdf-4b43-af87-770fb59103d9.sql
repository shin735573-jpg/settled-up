ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS virtual_leader_id uuid;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS virtual_leader_name text;