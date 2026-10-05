-- =============================================
-- Atención de puntos de control: grupo asignado, inicio ("ya está en el lugar") y fin
-- Ejecutar DESPUÉS de schema_dashboard_groups.sql
-- (se puede ejecutar más de una vez sin problema)
-- =============================================

-- Grupo delegado para resolver el punto, y cuándo/quién marcó que ya está en el lugar.
-- Un punto "en proceso" sigue con status = 'activo' y tiene attention_started_at lleno.
alter table control_points add column if not exists assigned_group_id uuid references agent_groups(id) on delete set null;
alter table control_points add column if not exists attention_started_at timestamptz;
alter table control_points add column if not exists attention_started_by uuid references auth.users(id) on delete set null;

-- ¿Puede este usuario atender un punto delegado a ese grupo?
-- Admin: siempre. Agente: si el punto no tiene grupo o si pertenece al grupo asignado.
create or replace function can_attend_point(p_uid uuid, p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from profiles p
        where p.id = p_uid
          and (p.role = 'admin'
               or (p.role = 'agente' and (p_group_id is null or p.group_id = p_group_id)))
    );
$$;

-- Al crear: solo agentes/admins pueden delegar a un grupo, y nadie nace "en proceso"
create or replace function set_control_point_insert_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is not null and not is_agent_or_admin(auth.uid()) then
        new.assigned_group_id := null;
    end if;
    new.attention_started_at := null;
    new.attention_started_by := null;
    return new;
end;
$$;

drop trigger if exists trg_set_control_point_insert_fields on control_points;
create trigger trg_set_control_point_insert_fields
    before insert on control_points
    for each row execute function set_control_point_insert_fields();

-- Al actualizar: inicio de atención y resolución se sellan en el servidor
-- (reemplaza la versión creada en schema_dashboard_groups.sql)
create or replace function set_resolution_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Inicio de atención: "ya está en el lugar"
    if new.attention_started_at is not null and old.attention_started_at is null then
        if auth.uid() is not null and not can_attend_point(auth.uid(), new.assigned_group_id) then
            raise exception 'Solo el grupo asignado o un administrador puede iniciar la atención'
                using errcode = '42501';
        end if;
        new.attention_started_at := now();
        new.attention_started_by := coalesce(auth.uid(), new.attention_started_by);
        -- Mientras se atiende, el punto no debe expirar ni desaparecer del mapa
        new.expires_at := null;
    elsif new.attention_started_at is distinct from old.attention_started_at then
        -- Una vez iniciado, el inicio no se puede cambiar ni borrar
        new.attention_started_at := old.attention_started_at;
        new.attention_started_by := old.attention_started_by;
    end if;

    -- Solo agentes/admins pueden cambiar el grupo asignado
    if new.assigned_group_id is distinct from old.assigned_group_id
       and auth.uid() is not null and not is_agent_or_admin(auth.uid()) then
        new.assigned_group_id := old.assigned_group_id;
    end if;

    -- Fin de la atención
    if new.status = 'resuelto' and old.status is distinct from 'resuelto' then
        new.resolved_by := coalesce(auth.uid(), new.resolved_by);
        new.resolved_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists trg_set_resolution_fields on control_points;
create trigger trg_set_resolution_fields
    before update on control_points
    for each row execute function set_resolution_fields();
