-- Harden session creator lookup for OAuth/PKCE sessions and improve diagnostics.

create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (
      select nullif(u.email, '')
      from auth.users u
      where u.id = auth.uid()
      limit 1
    ),
    nullif(auth.jwt() -> 'user_metadata' ->> 'email', '')
  )
$$;

create or replace function public.set_session_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  v_member_id := public.current_member_for_team(new.team_id);
  if v_member_id is null then
    raise exception 'FORBIDDEN: facilitator membership not found for team %', new.team_id;
  end if;

  new.created_by_member_id := v_member_id;
  if new.created_at is null then
    new.created_at := timezone('utc', now());
  end if;
  return new;
end;
$$;
