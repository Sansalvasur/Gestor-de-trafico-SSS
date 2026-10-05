-- =============================================
-- Usuarios en línea (presencia)
-- Ejecutar DESPUÉS de schema_phase2.sql y schema_admin_panel.sql
-- (se puede ejecutar más de una vez sin problema)
-- =============================================

-- La app avisa cada minuto que el usuario sigue dentro; al cerrar sesión avisa que salió.
alter table profiles add column if not exists last_seen_at timestamptz;
alter table profiles add column if not exists is_online boolean not null default false;

-- Cada usuario marca solo su propia presencia. SECURITY DEFINER porque los
-- usuarios no tienen permiso de UPDATE sobre "profiles" (solo el admin).
create or replace function set_presence(p_online boolean)
returns void
language sql
security definer
set search_path = public
as $$
    update profiles
    set last_seen_at = now(), is_online = p_online
    where id = auth.uid();
$$;

revoke execute on function set_presence(boolean) from public, anon;
grant execute on function set_presence(boolean) to authenticated;

-- Quién puede VER la presencia: se lee de "profiles", así que aplican sus políticas
-- existentes (cada quien ve su fila; el admin ve todas). No hace falta política nueva.
