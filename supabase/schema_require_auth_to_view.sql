-- =============================================
-- Requerir sesión iniciada para VER cualquier dato del mapa
-- Ejecutar DESPUÉS de schema_phase2.sql (y schema_phase4_history.sql si ya lo corriste)
-- =============================================

-- Antes: cualquiera (sin sesión) podía leer los puntos activos. Ahora requiere sesión.
drop policy if exists "select_active_control_points" on control_points;
create policy "select_active_control_points"
    on control_points for select
    using (
        auth.uid() is not null
        and status = 'activo'
        and (expires_at is null or expires_at > now())
    );

-- Si ya corriste schema_phase4_history.sql, esta política existe; si no, no pasa nada (if exists)
drop policy if exists "select_resolved_control_points" on control_points;
create policy "select_resolved_control_points"
    on control_points for select
    using (auth.uid() is not null and status = 'resuelto');

-- Ubicaciones en vivo de agentes: también requieren sesión
drop policy if exists "select_agent_locations" on agent_locations;
create policy "select_agent_locations"
    on agent_locations for select
    using (auth.uid() is not null);

-- Confirmaciones comunitarias: también requieren sesión
drop policy if exists "select_confirmations" on control_point_confirmations;
create policy "select_confirmations"
    on control_point_confirmations for select
    using (auth.uid() is not null);
