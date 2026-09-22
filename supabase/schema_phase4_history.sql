-- =============================================
-- Fase 4: Historial de puntos resueltos por zona/fecha
-- Ejecutar DESPUÉS de schema.sql, schema_phase2.sql y schema_phase3.sql
-- (depende de la columna geográfica "geog" creada en schema_phase3.sql)
-- =============================================

-- Cuándo se resolvió el punto (para poder filtrar/ordenar el historial)
alter table control_points add column if not exists resolved_at timestamptz;

-- Los puntos resueltos ahora también son legibles (antes solo se veían los 'activo').
-- Es una política adicional: se combina con select_active_control_points, no la reemplaza.
drop policy if exists "select_resolved_control_points" on control_points;
create policy "select_resolved_control_points"
    on control_points for select
    using (status = 'resuelto');

-- Historial filtrado por área visible del mapa (zona) y rango de fechas
create or replace function resolved_control_points_in_bbox(
    min_lat double precision,
    min_lng double precision,
    max_lat double precision,
    max_lng double precision,
    from_date timestamptz,
    to_date timestamptz
)
returns setof control_points
language sql
stable
as $$
    select *
    from control_points
    where status = 'resuelto'
      and resolved_at between from_date and to_date
      and geog && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    order by resolved_at desc
    limit 200;
$$;

grant execute on function resolved_control_points_in_bbox to anon, authenticated;
