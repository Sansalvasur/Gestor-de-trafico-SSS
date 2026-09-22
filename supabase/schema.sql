-- =============================================
-- Esquema: Puntos de Control de Tráfico (MVP)
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query
-- =============================================

create extension if not exists pgcrypto;

create table if not exists control_points (
    id uuid primary key default gen_random_uuid(),
    lat double precision not null,
    lng double precision not null,
    type text not null check (type in ('reten', 'accidente', 'congestion', 'obra_vial', 'semaforo_danado', 'otro')),
    severity text not null default 'media' check (severity in ('baja', 'media', 'alta')),
    description text,
    status text not null default 'activo' check (status in ('activo', 'resuelto', 'expirado')),
    created_at timestamptz not null default now()
);

-- Row Level Security: en el MVP el registro es público (sin login).
-- Cualquiera puede crear y leer puntos activos; nadie puede editar/borrar desde el cliente.
alter table control_points enable row level security;

create policy "select_active_control_points"
    on control_points for select
    using (status = 'activo');

create policy "insert_control_points"
    on control_points for insert
    with check (true);
