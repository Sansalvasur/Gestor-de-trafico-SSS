-- =============================================
-- Notificaciones push a los agentes del grupo asignado a un punto de control
-- Ejecutar DESPUÉS de schema_dashboard_groups.sql y schema_control_point_attention.sql
-- (se puede ejecutar más de una vez sin problema)
-- =============================================

-- Una fila por navegador/teléfono suscrito. Solo el servidor (Edge Function) las lee.
create table if not exists push_subscriptions (
    endpoint text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    p256dh text not null,
    auth text not null,
    created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;
-- Sin políticas: el cliente solo entra por las funciones de abajo.

-- Evita avisar dos veces por el mismo punto
alter table control_points add column if not exists notified_at timestamptz;

-- Guarda la suscripción del usuario actual (si el navegador cambió de usuario, se reasigna)
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'No autorizado' using errcode = '42501';
    end if;
    insert into push_subscriptions (endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth)
    on conflict (endpoint) do update
        set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function remove_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

revoke execute on function save_push_subscription(text, text, text) from public, anon;
revoke execute on function remove_push_subscription(text) from public, anon;
grant execute on function save_push_subscription(text, text, text) to authenticated;
grant execute on function remove_push_subscription(text) to authenticated;
