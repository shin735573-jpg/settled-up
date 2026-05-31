ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_user_id_fkey;
ALTER TABLE public.team_leaders DROP CONSTRAINT IF EXISTS team_leaders_user_id_fkey;
ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_user_id_fkey;
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS holidays_user_id_fkey;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;