-- =============================================
-- Fase 2: Autenticación, roles, confirmación comunitaria y expiración
-- Ejecutar DESPUÉS de schema.sql, en Supabase SQL Editor
-- =============================================

-- --- 1. Nuevas columnas en control_points ---
alter table control_points add column if not exists reported_by uuid references auth.users(id);
alter table control_points add column if not exists expires_at timestamptz;
alter table control_points add column if not exists confirmations_count integer not null default 0;

-- --- 2. Perfiles de usuario (rol: ciudadano | agente | admin) ---
create table if not exists profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    role text not null default 'ciudadano' check (role in ('ciudadano', 'agente', 'admin')),
    created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "select_own_profile" on profiles;
create policy "select_own_profile"
    on profiles for select
    using (auth.uid() = id);

-- Crear automáticamente un perfil (rol ciudadano) cuando alguien se registra
create or replace function handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id) values (new.id);
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();

-- Nota: para convertir un usuario en "agente" (puede resolver puntos de otros),
-- actualiza su fila manualmente desde el Table Editor:
--   update profiles set role = 'agente' where id = '<uuid-del-usuario>';

-- Función SECURITY DEFINER: consulta el rol saltándose RLS.
-- Evita recursión infinita cuando una política necesita verificar el rol
-- de otra tabla que a su vez depende de "profiles".
create or replace function is_agent_or_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (select 1 from profiles where id = uid and role in ('agente', 'admin'));
$$;

-- --- 3. Confirmaciones comunitarias ("¿sigue ahí?") ---
create table if not exists control_point_confirmations (
    id uuid primary key default gen_random_uuid(),
    control_point_id uuid not null references control_points(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (control_point_id, user_id)
);

alter table control_point_confirmations enable row level security;

drop policy if exists "select_confirmations" on control_point_confirmations;
create policy "select_confirmations"
    on control_point_confirmations for select
    using (true);

drop policy if exists "insert_own_confirmation" on control_point_confirmations;
create policy "insert_own_confirmation"
    on control_point_confirmations for insert
    with check (auth.uid() = user_id);

-- Mantener confirmations_count sincronizado en control_points
create or replace function increment_confirmations()
returns trigger as $$
begin
    update control_points
    set confirmations_count = confirmations_count + 1
    where id = new.control_point_id;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_increment_confirmations on control_point_confirmations;
create trigger trg_increment_confirmations
    after insert on control_point_confirmations
    for each row execute function increment_confirmations();

-- --- 4. Actualizar políticas de control_points ---

-- Ahora solo usuarios autenticados pueden crear puntos, y deben quedar como autores
drop policy if exists "insert_control_points" on control_points;
create policy "insert_control_points_authenticated"
    on control_points for insert
    with check (auth.uid() = reported_by);

-- Lectura pública, pero ocultando puntos ya expirados
drop policy if exists "select_active_control_points" on control_points;
create policy "select_active_control_points"
    on control_points for select
    using (status = 'activo' and (expires_at is null or expires_at > now()));

-- El autor del punto o un agente/admin pueden marcarlo como resuelto
drop policy if exists "update_own_or_agent" on control_points;
create policy "update_own_or_agent"
    on control_points for update
    using (auth.uid() = reported_by or is_agent_or_admin(auth.uid()))
    with check (auth.uid() = reported_by or is_agent_or_admin(auth.uid()));
