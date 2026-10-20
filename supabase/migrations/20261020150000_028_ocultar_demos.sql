-- 028: la web pública ya no muestra datos de demostración.
-- Reversible: los centros «Demo · …» y sus salidas no se borran, solo se ocultan.

-- 1. Parar la regeneración nocturna de salidas demo
select cron.alter_job(job_id := jobid, active := false) from cron.job where jobname = 'refresh-demo-trips';

-- 2. Salidas de los centros demo: de publicadas a borrador (desaparecen de published_trips)
update public.trips t set status = 'draft'
from public.centers c
where c.id = t.center_id and c.name like 'Demo%' and t.status = 'published';

-- 3. Centros demo: cerrados y suspendidos (no vuelven a salir aunque alguien publique)
update public.centers set listing_status = 'cerrado', verification_status = 'suspended'
where name like 'Demo%';
