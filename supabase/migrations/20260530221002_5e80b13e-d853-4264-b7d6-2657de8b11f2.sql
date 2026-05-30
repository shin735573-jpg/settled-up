
-- 별칭 팀장 행을 정식 팀장으로 통합
-- 1) "동석" → "신동석"으로 이름 변경 (정식 신동석 행이 없으므로 rename), 별칭에 "동석" 추가
UPDATE public.team_leaders
SET name = '신동석',
    aliases = ARRAY['동석']::text[]
WHERE id = '97716f51-2df1-44b4-b02d-e37749618896';

-- 2) "동선" 행은 오동선에게 정산귀속
UPDATE public.team_leaders
SET settle_to_id = '4c2447b9-ea40-4706-8acf-01a128d26af0'
WHERE id = 'df87519f-0ffe-4876-8ba7-51b433ead49f';

-- 3) "용익" 행은 김용익에게 정산귀속
UPDATE public.team_leaders
SET settle_to_id = '12e8bcfc-e102-4530-ad69-ddf8f1ea6f1e'
WHERE id = '1e4fe348-cb1a-4be2-b61e-ff718cc3a1a8';
