-- =============================================
-- Ejecutar TODO este archivo de una sola vez en Supabase SQL Editor
-- (requiere que schema.sql ya se haya corrido antes)
-- Combina: schema_phase2.sql + schema_agent_location.sql + schema_admin_panel.sql
-- =============================================

-- ======= Fase 2: Autenticación, roles, confirmaciones y expiración =======

alter table control_points add column if not exists reported_by uuid references auth.users(id);
alter table control_points add column if not exists expires_at timestamptz;
alter table control_points add column if not exists confirmations_count integer not null default 0;

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

drop policy if exists "insert_control_points" on control_points;
create policy "insert_control_points_authenticated"
    on control_points for insert
    with check (auth.uid() = reported_by);

drop policy if exists "select_active_control_points" on control_points;
create policy "select_active_control_points"
    on control_points for select
    using (status = 'activo' and (expires_at is null or expires_at > now()));

create or replace function is_agent_or_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (select 1 from profiles where id = uid and role in ('agente', 'admin'));
$$;

drop policy if exists "update_own_or_agent" on control_points;
create policy "update_own_or_agent"
    on control_points for update
    using (auth.uid() = reported_by or is_agent_or_admin(auth.uid()))
    with check (auth.uid() = reported_by or is_agent_or_admin(auth.uid()));

-- ======= Ubicación en vivo del agente de tráfico =======

create table if not exists agent_locations (
    user_id uuid primary key references auth.users(id) on delete cascade,
    lat double precision not null,
    lng double precision not null,
    updated_at timestamptz not null default now()
);

alter table agent_locations enable row level security;

drop policy if exists "select_agent_locations" on agent_locations;
create policy "select_agent_locations"
    on agent_locations for select
    using (true);

drop policy if exists "insert_own_agent_location" on agent_locations;
create policy "insert_own_agent_location"
    on agent_locations for insert
    with check (auth.uid() = user_id and is_agent_or_admin(auth.uid()));

drop policy if exists "update_own_agent_location" on agent_locations;
create policy "update_own_agent_location"
    on agent_locations for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id and is_agent_or_admin(auth.uid()));

drop policy if exists "delete_own_agent_location" on agent_locations;
create policy "delete_own_agent_location"
    on agent_locations for delete
    using (auth.uid() = user_id);

alter publication supabase_realtime add table agent_locations;

-- ======= Panel de administración de usuarios =======

alter table profiles add column if not exists email text;

update profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

create or replace function handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email) values (new.id, new.email);
    return new;
end;
$$ language plpgsql security definer;

create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (select 1 from profiles where id = uid and role = 'admin');
$$;

drop policy if exists "admin_select_all_profiles" on profiles;
create policy "admin_select_all_profiles"
    on profiles for select
    using (is_admin(auth.uid()));

drop policy if exists "admin_update_any_profile" on profiles;
create policy "admin_update_any_profile"
    on profiles for update
    using (is_admin(auth.uid()))
    with check (is_admin(auth.uid()));
