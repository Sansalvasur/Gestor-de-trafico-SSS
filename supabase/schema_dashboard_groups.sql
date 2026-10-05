-- =============================================
-- Dashboard de atención a reportes + grupos de agentes con encargado
-- Ejecutar DESPUÉS de schema_phase2.sql, schema_admin_panel.sql,
-- schema_add_name.sql y schema_phase4_history.sql
-- (se puede ejecutar más de una vez sin problema)
-- =============================================

-- --- 1. Quién atendió (resolvió) cada punto ---
alter table control_points add column if not exists resolved_by uuid references auth.users(id) on delete set null;

-- Se llena en el servidor para no depender de lo que envíe el cliente
create or replace function set_resolution_fields()
returns trigger
language plpgsql
as $$
begin
    if new.status = 'resuelto' and old.status is distinct from 'resuelto' then
        new.resolved_by := coalesce(auth.uid(), new.resolved_by);
        new.resolved_at := coalesce(new.resolved_at, now());
    end if;
    return new;
end;
$$;

drop trigger if exists trg_set_resolution_fields on control_points;
create trigger trg_set_resolution_fields
    before update on control_points
    for each row execute function set_resolution_fields();

-- --- 2. Grupos de agentes ---
create table if not exists agent_groups (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    leader_id uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

alter table profiles add column if not exists group_id uuid references agent_groups(id) on delete set null;

alter table agent_groups enable row level security;

drop policy if exists "select_agent_groups" on agent_groups;
create policy "select_agent_groups"
    on agent_groups for select
    using (auth.uid() is not null);

drop policy if exists "admin_manage_agent_groups" on agent_groups;
create policy "admin_manage_agent_groups"
    on agent_groups for all
    using (is_admin(auth.uid()))
    with check (is_admin(auth.uid()));

-- Si un encargado sale de su grupo (o deja de ser agente), el grupo queda sin encargado
create or replace function clear_leader_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update agent_groups
    set leader_id = null
    where leader_id = new.id
      and (id is distinct from new.group_id or new.role not in ('agente', 'admin'));
    return new;
end;
$$;

drop trigger if exists trg_clear_leader_on_profile_change on profiles;
create trigger trg_clear_leader_on_profile_change
    after update of group_id, role on profiles
    for each row execute function clear_leader_on_profile_change();

-- Delegar el encargado de un grupo (solo admin). Pasa null para dejarlo sin encargado.
-- El agente elegido pasa a ser miembro del grupo si no lo era.
create or replace function set_group_leader(p_group_id uuid, p_leader_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_admin(auth.uid()) then
        raise exception 'Solo un administrador puede delegar encargados' using errcode = '42501';
    end if;
    if p_leader_id is not null then
        if not is_agent_or_admin(p_leader_id) then
            raise exception 'El encargado debe tener rol de agente o admin';
        end if;
        update profiles set group_id = p_group_id where id = p_leader_id;
    end if;
    update agent_groups set leader_id = p_leader_id where id = p_group_id;
end;
$$;

revoke execute on function set_group_leader(uuid, uuid) from public, anon;
grant execute on function set_group_leader(uuid, uuid) to authenticated;

-- --- 3. Estadísticas de atención (solo agentes y admins) ---
-- SECURITY DEFINER: necesita contar también los puntos expirados, que RLS oculta.
create or replace function attention_stats(from_date timestamptz, to_date timestamptz)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    result json;
begin
    if not is_agent_or_admin(auth.uid()) then
        raise exception 'No autorizado' using errcode = '42501';
    end if;

    with cohort as (
        -- Reportes creados en el rango
        select
            cp.type,
            cp.created_at,
            cp.status = 'resuelto' as is_resolved,
            (cp.status = 'expirado'
                or (cp.status = 'activo' and cp.expires_at is not null and cp.expires_at <= now())) as is_expired,
            extract(epoch from (cp.resolved_at - cp.created_at)) / 60.0 as minutes
        from control_points cp
        where cp.created_at between from_date and to_date
    ),
    done as (
        -- Atenciones realizadas en el rango
        select
            cp.id,
            cp.resolved_by,
            cp.resolved_at,
            extract(epoch from (cp.resolved_at - cp.created_at)) / 60.0 as minutes
        from control_points cp
        where cp.status = 'resuelto'
          and cp.resolved_at between from_date and to_date
    )
    select json_build_object(
        'totals', (
            select json_build_object(
                'reported', count(*),
                'resolved', count(*) filter (where is_resolved),
                'expired', count(*) filter (where is_expired),
                'active', count(*) filter (where not is_resolved and not is_expired),
                'avg_minutes', avg(minutes) filter (where is_resolved),
                'median_minutes', percentile_cont(0.5) within group (order by minutes) filter (where is_resolved)
            )
            from cohort
        ),
        'by_type', coalesce((
            select json_agg(t order by t.reported desc)
            from (
                select
                    type,
                    count(*) as reported,
                    count(*) filter (where is_resolved) as resolved,
                    avg(minutes) filter (where is_resolved) as avg_minutes
                from cohort
                group by type
            ) t
        ), '[]'::json),
        'by_day', coalesce((
            select json_agg(json_build_object(
                'day', d.day,
                'reported', (select count(*) from cohort c
                             where (c.created_at at time zone 'America/El_Salvador')::date = d.day),
                'resolved', (select count(*) from done x
                             where (x.resolved_at at time zone 'America/El_Salvador')::date = d.day)
            ) order by d.day)
            from (
                select g::date as day
                from generate_series(
                    (from_date at time zone 'America/El_Salvador')::date,
                    (to_date at time zone 'America/El_Salvador')::date,
                    interval '1 day'
                ) g
            ) d
        ), '[]'::json),
        'by_agent', coalesce((
            select json_agg(a order by a.resolved desc, a.name)
            from (
                select
                    p.id as user_id,
                    coalesce(p.full_name, p.email) as name,
                    g.name as group_name,
                    (g.leader_id = p.id) as is_leader,
                    count(x.id) as resolved,
                    avg(x.minutes) as avg_minutes
                from profiles p
                left join agent_groups g on g.id = p.group_id
                left join done x on x.resolved_by = p.id
                where p.role in ('agente', 'admin')
                group by p.id, p.full_name, p.email, g.name, g.leader_id
            ) a
        ), '[]'::json),
        'by_group', coalesce((
            select json_agg(gr order by gr.resolved desc, gr.name)
            from (
                select
                    g.id as group_id,
                    g.name,
                    coalesce(l.full_name, l.email) as leader_name,
                    (select count(*) from profiles m where m.group_id = g.id) as members,
                    (select count(*) from done x join profiles m on m.id = x.resolved_by
                     where m.group_id = g.id) as resolved,
                    (select avg(x.minutes) from done x join profiles m on m.id = x.resolved_by
                     where m.group_id = g.id) as avg_minutes
                from agent_groups g
                left join profiles l on l.id = g.leader_id
            ) gr
        ), '[]'::json),
        -- Atenciones sin agente registrado (anteriores a esta migración)
        'unattributed', (select count(*) from done where resolved_by is null)
    ) into result;

    return result;
end;
$$;

revoke execute on function attention_stats(timestamptz, timestamptz) from public, anon;
grant execute on function attention_stats(timestamptz, timestamptz) to authenticated;
