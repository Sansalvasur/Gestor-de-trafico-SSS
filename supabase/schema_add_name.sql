-- Agregar columna full_name
alter table profiles add column if not exists full_name text;

-- Actualizar trigger para guardar el nombre si viene en metadata
create or replace function handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, full_name) 
    values (
        new.id, 
        new.email, 
        new.raw_user_meta_data->>'full_name'
    );
    return new;
end;
$$ language plpgsql security definer;

-- Función para obtener nombre (o email si no hay nombre)
create or replace function get_user_name(uid uuid)
returns text
language sql
security definer
as $$
    select coalesce(full_name, email) from profiles where id = uid;
$$;

grant execute on function get_user_name to anon, authenticated;
