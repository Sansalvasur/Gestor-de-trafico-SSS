-- =============================================
-- FIX: recursión infinita en políticas de "profiles"
-- Ejecutar AHORA en el SQL Editor (corrige el proyecto ya desplegado)
-- =============================================

-- Funciones que consultan el rol saltándose RLS (evita que la política
-- de "profiles" se dispare a sí misma al verificar si el usuario es admin/agente)
create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (select 1 from profiles where id = uid and role = 'admin');
$$;

create or replace function is_agent_or_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (select 1 from profiles where id = uid and role in ('agente', 'admin'));
$$;

-- --- profiles: reescribir políticas de admin usando las funciones ---
drop policy if exists "admin_select_all_profiles" on profiles;
create policy "admin_select_all_profiles"
    on profiles for select
    using (is_admin(auth.uid()));

drop policy if exists "admin_update_any_profile" on profiles;
create policy "admin_update_any_profile"
    on profiles for update
    using (is_admin(auth.uid()))
    with check (is_admin(auth.uid()));

-- --- control_points: misma verificación, ahora sin recursión ---
drop policy if exists "update_own_or_agent" on control_points;
create policy "update_own_or_agent"
    on control_points for update
    using (auth.uid() = reported_by or is_agent_or_admin(auth.uid()))
    with check (auth.uid() = reported_by or is_agent_or_admin(auth.uid()));

-- --- agent_locations: misma verificación, ahora sin recursión ---
drop policy if exists "insert_own_agent_location" on agent_locations;
create policy "insert_own_agent_location"
    on agent_locations for insert
    with check (auth.uid() = user_id and is_agent_or_admin(auth.uid()));

drop policy if exists "update_own_agent_location" on agent_locations;
create policy "update_own_agent_location"
    on agent_locations for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and is_agent_or_admin(auth.uid()));
