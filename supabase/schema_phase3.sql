-- =============================================
-- Fase 3: PostGIS + carga por viewport
-- Ejecutar DESPUÉS de schema.sql y schema_phase2.sql
-- =============================================

create extension if not exists postgis;

-- Columna geográfica derivada de lat/lng, mantenida automáticamente por Postgres
alter table control_points add column if not exists geog geography(Point, 4326)
    generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored;

-- Índice espacial: permite consultas "puntos dentro de este rectángulo" en milisegundos
create index if not exists control_points_geog_idx on control_points using gist (geog);

-- Función que devuelve solo los puntos dentro del área visible del mapa (viewport).
-- security invoker (por defecto): respeta las políticas RLS del usuario que llama.
create or replace function control_points_in_bbox(
    min_lat double precision,
    min_lng double precision,
    max_lat double precision,
    max_lng double precision
)
returns setof control_points
language sql
stable
as $$
    select *
    from control_points
    where status = 'activo'
      and (expires_at is null or expires_at > now())
      and geog && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography;
$$;

grant execute on function control_points_in_bbox to anon, authenticated;
