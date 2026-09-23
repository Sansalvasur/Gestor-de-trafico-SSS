create or replace function get_user_email(uid uuid)
returns text
language sql
security definer
as $$
    select email from profiles where id = uid;
$$;

grant execute on function get_user_email to anon, authenticated;
