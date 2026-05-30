-- Add aliases and display_suffix columns for team_leaders
ALTER TABLE public.team_leaders
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS display_suffix text;

-- Validation: prevent duplicate aliases per user (including across aliases and canonical names)
CREATE OR REPLACE FUNCTION public.validate_leader_aliases()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  a text;
  conflict_count int;
BEGIN
  IF NEW.aliases IS NULL OR array_length(NEW.aliases, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- normalize: trim, remove empty
  NEW.aliases := ARRAY(
    SELECT DISTINCT btrim(x) FROM unnest(NEW.aliases) x
    WHERE btrim(x) <> ''
  );

  FOREACH a IN ARRAY NEW.aliases LOOP
    -- alias should not equal another leader's canonical name (different leader)
    SELECT count(*) INTO conflict_count
    FROM public.team_leaders
    WHERE user_id = NEW.user_id
      AND id <> NEW.id
      AND (
        lower(btrim(name)) = lower(a)
        OR EXISTS (
          SELECT 1 FROM unnest(aliases) ax WHERE lower(btrim(ax)) = lower(a)
        )
      );
    IF conflict_count > 0 THEN
      RAISE EXCEPTION '별칭 중복: "%"는 이미 다른 팀장에서 사용 중입니다', a
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_leader_aliases ON public.team_leaders;
CREATE TRIGGER trg_validate_leader_aliases
  BEFORE INSERT OR UPDATE ON public.team_leaders
  FOR EACH ROW EXECUTE FUNCTION public.validate_leader_aliases();

-- Auto-map existing "형주" rows to "강형주"
DO $$
DECLARE
  r record;
  kang_id uuid;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.team_leaders WHERE name IN ('강형주','형주') LOOP
    SELECT id INTO kang_id FROM public.team_leaders
      WHERE user_id = r.user_id AND name = '강형주' LIMIT 1;

    IF kang_id IS NULL THEN
      -- rename a "형주" to "강형주" if exists
      UPDATE public.team_leaders SET name = '강형주'
        WHERE user_id = r.user_id AND name = '형주';
      SELECT id INTO kang_id FROM public.team_leaders
        WHERE user_id = r.user_id AND name = '강형주' LIMIT 1;
    ELSE
      -- delete duplicate "형주" leader (after remapping its deliveries below)
      UPDATE public.deliveries SET leader1_id = kang_id, leader1_name = '강형주'
        WHERE user_id = r.user_id AND leader1_name = '형주';
      UPDATE public.deliveries SET leader2_id = kang_id, leader2_name = '강형주'
        WHERE user_id = r.user_id AND leader2_name = '형주';
      UPDATE public.deliveries SET leader3_id = kang_id, leader3_name = '강형주'
        WHERE user_id = r.user_id AND leader3_name = '형주';
      DELETE FROM public.team_leaders
        WHERE user_id = r.user_id AND name = '형주';
    END IF;

    -- ensure alias "형주" present
    IF kang_id IS NOT NULL THEN
      UPDATE public.team_leaders
        SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['형주']))
        WHERE id = kang_id
          AND NOT ('형주' = ANY(aliases));
    END IF;
  END LOOP;

  -- Normalize remaining deliveries.leader*_name='형주' to '강형주' (in case leader row absent)
  UPDATE public.deliveries SET leader1_name = '강형주' WHERE leader1_name = '형주';
  UPDATE public.deliveries SET leader2_name = '강형주' WHERE leader2_name = '형주';
  UPDATE public.deliveries SET leader3_name = '강형주' WHERE leader3_name = '형주';
END $$;