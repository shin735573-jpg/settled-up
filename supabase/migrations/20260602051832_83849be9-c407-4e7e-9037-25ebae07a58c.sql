UPDATE public.deliveries
SET leader2_id = NULL, leader2_name = NULL
WHERE virtual_leader_id IS NOT NULL AND leader2_id = virtual_leader_id;

UPDATE public.deliveries
SET leader3_id = NULL, leader3_name = NULL
WHERE virtual_leader_id IS NOT NULL AND leader3_id = virtual_leader_id;

UPDATE public.deliveries
SET leader1_id = NULL, leader1_name = NULL
WHERE virtual_leader_id IS NOT NULL AND leader1_id = virtual_leader_id;