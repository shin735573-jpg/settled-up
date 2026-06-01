UPDATE public.deliveries SET leader1_name = NULL, leader1_id = NULL WHERE leader1_name ~ '^\d{4}-\d{2}-\d{2}$';
UPDATE public.deliveries SET leader2_name = NULL, leader2_id = NULL WHERE leader2_name ~ '^\d{4}-\d{2}-\d{2}$';
UPDATE public.deliveries SET leader3_name = NULL, leader3_id = NULL WHERE leader3_name ~ '^\d{4}-\d{2}-\d{2}$';