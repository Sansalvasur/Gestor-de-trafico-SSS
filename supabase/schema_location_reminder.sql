-- =============================================
-- Recordatorio por push cuando un agente deja de compartir su ubicación sin querer
-- Ejecutar DESPUÉS de schema_agent_location.sql y schema_push_notifications.sql
-- (se puede ejecutar más de una vez sin problema)
-- =============================================

alter table agent_locations add column if not exists reminder_sent_at timestamptz;

-- Extensiones para programar la llamada (también se activan en Database > Extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- =============================================
-- PROGRAMAR LA REVISIÓN CADA MINUTO
-- Primero despliega la función "remind-stale-agents" y guarda el secreto CRON_SECRET.
-- Luego reemplaza <PROJECT_REF> y <CRON_SECRET> y ejecuta este bloque (quita los "-- "):
-- =============================================
-- select cron.unschedule('remind-stale-agents')
--   where exists (select 1 from cron.job where jobname = 'remind-stale-agents');
--
-- select cron.schedule(
--   'remind-stale-agents',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/remind-stale-agents',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--     body := '{}'::jsonb
--   );
--   $$
-- );
