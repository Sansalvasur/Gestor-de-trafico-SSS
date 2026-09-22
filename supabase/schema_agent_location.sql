-- =============================================
-- Ubicación en vivo del agente de tráfico
-- Ejecutar DESPUÉS de schema.sql y schema_phase2.sql
-- (depende de la tabla "profiles" para verificar el rol)
-- =============================================

create table if not exists agent_locations (
    user_id uuid primary key references auth.users(id) on delete cascade,
    lat double precision not null,
    lng double precision not null,
    updated_at timestamptz not null default now()
);

alter table agent_locations enable row level security;

-- Cualquiera puede ver dónde están los agentes activos
drop policy if exists "select_agent_locations" on agent_locations;
create policy "select_agent_locations"
    on agent_locations for select
    using (true);

-- Solo un agente/admin puede publicar su propia ubicación
-- (is_agent_or_admin es una función SECURITY DEFINER definida en schema_phase2.sql,
--  necesaria para evitar recursión infinita al consultar el rol en "profiles")
drop policy if exists "insert_own_agent_location" on agent_locations;
create policy "insert_own_agent_location"
    on agent_locations for insert
    with check (auth.uid() = user_id and is_agent_or_admin(auth.uid()));

drop policy if exists "update_own_agent_location" on agent_locations;
create policy "update_own_agent_location"
    on agent_locations for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and is_agent_or_admin(auth.uid()));

-- Al dejar de compartir, el propio agente borra su fila
drop policy if exists "delete_own_agent_location" on agent_locations;
create policy "delete_own_agent_location"
    on agent_locations for delete
    using (auth.uid() = user_id);

-- Habilitar Realtime para esta tabla (para que los demás vean el movimiento sin recargar)
alter publication supabase_realtime add table agent_locations;
