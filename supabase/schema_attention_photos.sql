-- =============================================
-- Fotos de evidencia de la atención: una al llegar y otra al finalizar
-- Ejecutar DESPUÉS de schema_control_point_attention.sql
-- (se puede ejecutar más de una vez sin problema)
-- =============================================

alter table control_points add column if not exists arrival_photo_path text;
alter table control_points add column if not exists resolution_photo_path text;

-- Bucket privado: las fotos se ven con enlaces temporales, solo para agentes y admins
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attention-photos', 'attention-photos', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "attention_photos_insert" on storage.objects;
create policy "attention_photos_insert"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'attention-photos' and is_agent_or_admin(auth.uid()));

drop policy if exists "attention_photos_select" on storage.objects;
create policy "attention_photos_select"
    on storage.objects for select
    to authenticated
    using (bucket_id = 'attention-photos' and is_agent_or_admin(auth.uid()));
