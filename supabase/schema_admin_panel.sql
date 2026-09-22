-- =============================================
-- Panel de administración de usuarios
-- Ejecutar DESPUÉS de schema_phase2.sql
-- =============================================

-- Guardamos el email en profiles para poder listar usuarios desde el cliente
-- (auth.users no es accesible directamente vía la API pública)
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
-- El trigger on_auth_user_created ya apunta a esta función (creado en schema_phase2.sql)

-- Función SECURITY DEFINER: consulta el rol saltándose RLS.
-- Necesaria porque una política de "profiles" que consulta "profiles" directamente
-- para verificar el rol dispara su propia política y entra en recursión infinita.
create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (select 1 from profiles where id = uid and role = 'admin');
$$;

-- Un admin puede ver todos los perfiles (además de poder ver siempre el suyo propio)
drop policy if exists "admin_select_all_profiles" on profiles;
create policy "admin_select_all_profiles"
    on profiles for select
    using (is_admin(auth.uid()));

-- Un admin puede cambiar el rol de cualquier usuario
drop policy if exists "admin_update_any_profile" on profiles;
create policy "admin_update_any_profile"
    on profiles for update
    using (is_admin(auth.uid()))
    with check (is_admin(auth.uid()));
