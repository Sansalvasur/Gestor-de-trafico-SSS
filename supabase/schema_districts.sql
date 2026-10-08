-- =============================================
-- Distritos de San Salvador Sur (agentes y puntos de control)
-- (se puede ejecutar más de una vez sin problema)
-- =============================================

alter table profiles add column if not exists district text;
alter table control_points add column if not exists district text;

alter table profiles drop constraint if exists profiles_district_check;
alter table profiles add constraint profiles_district_check
    check (district is null or district in ('Panchimalco', 'Rosario de Mora', 'San Marcos', 'Santiago Texacuangos', 'Santo Tomás'));

alter table control_points drop constraint if exists control_points_district_check;
alter table control_points add constraint control_points_district_check
    check (district is null or district in ('Panchimalco', 'Rosario de Mora', 'San Marcos', 'Santiago Texacuangos', 'Santo Tomás'));

-- Reportes por distrito para el dashboard (solo agentes y admins)
create or replace function attention_by_district(from_date timestamptz, to_date timestamptz)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
begin
    if not is_agent_or_admin(auth.uid()) then
        raise exception 'No autorizado' using errcode = '42501';
    end if;
    return coalesce((
        select json_agg(t order by t.reported desc)
        from (
            select
                coalesce(district, 'Sin distrito') as district,
                count(*) as reported,
                count(*) filter (where status = 'resuelto') as resolved
            from control_points
            where created_at between from_date and to_date
            group by 1
        ) t
    ), '[]'::json);
end;
$$;

revoke execute on function attention_by_district(timestamptz, timestamptz) from public, anon;
grant execute on function attention_by_district(timestamptz, timestamptz) to authenticated;
