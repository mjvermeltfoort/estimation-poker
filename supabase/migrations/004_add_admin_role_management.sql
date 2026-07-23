-- Add admin role support with secure RPCs for user and role management.

alter type public.citation_role add value if not exists 'admin';

create or replace function public.current_admin_for_team(p_team_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.id
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.active = true
    and tm.role = 'admin'
    and (
      tm.user_id = auth.uid()
      or lower(tm.email) = lower(public.current_user_email())
    )
  order by tm.created_at asc
  limit 1
$$;

create or replace function public.assert_team_admin(p_team_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin_member_id uuid;
begin
  v_admin_member_id := public.current_admin_for_team(p_team_id);
  if v_admin_member_id is null then
    raise exception 'FORBIDDEN: admin membership required for team %', p_team_id;
  end if;
  return v_admin_member_id;
end;
$$;

create or replace function public.admin_state(p_team_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_selected_team_id uuid;
  v_teams jsonb := '[]'::jsonb;
  v_members jsonb := '[]'::jsonb;
  v_available_roles jsonb := '[]'::jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', team.id,
        'name', team.name,
        'jira_base_url', team.jira_base_url,
        'jira_project_key', team.jira_project_key,
        'active', team.active,
        'created_at', team.created_at
      )
      order by team.name asc
    ),
    '[]'::jsonb
  )
  into v_teams
  from public.teams team
  where team.active = true
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = team.id
        and tm.active = true
        and tm.role = 'admin'
        and (
          tm.user_id = auth.uid()
          or lower(tm.email) = lower(public.current_user_email())
        )
    );

  if jsonb_array_length(v_teams) = 0 then
    return jsonb_build_object(
      'teams', '[]'::jsonb,
      'selected_team_id', null,
      'members', '[]'::jsonb,
      'available_roles', jsonb_build_array('participant', 'facilitator', 'admin')
    );
  end if;

  if p_team_id is not null and exists (
    select 1
    from jsonb_array_elements(v_teams) item
    where (item ->> 'id')::uuid = p_team_id
  ) then
    v_selected_team_id := p_team_id;
  else
    select (item ->> 'id')::uuid
    into v_selected_team_id
    from jsonb_array_elements(v_teams) item
    order by item ->> 'name'
    limit 1;
  end if;

  perform public.assert_team_admin(v_selected_team_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tm.id,
        'team_id', tm.team_id,
        'user_id', tm.user_id,
        'display_name', tm.display_name,
        'email', tm.email,
        'role', tm.role,
        'active', tm.active,
        'created_at', tm.created_at
      )
      order by tm.active desc, tm.role asc, coalesce(tm.display_name, tm.email) asc
    ),
    '[]'::jsonb
  )
  into v_members
  from public.team_members tm
  where tm.team_id = v_selected_team_id;

  select coalesce(
    jsonb_agg(enumlabel order by enumsortorder),
    jsonb_build_array('participant', 'facilitator', 'admin')
  )
  into v_available_roles
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'citation_role';

  return jsonb_build_object(
    'teams', v_teams,
    'selected_team_id', v_selected_team_id,
    'members', v_members,
    'available_roles', v_available_roles
  );
end;
$$;

create or replace function public.admin_upsert_team_member(
  p_team_id uuid,
  p_email text,
  p_display_name text default null,
  p_role text default 'participant',
  p_active boolean default true
)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.team_members;
  v_role public.citation_role;
  v_user_id uuid;
  v_email text;
begin
  perform public.assert_team_admin(p_team_id);

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'VALIDATION: email is required';
  end if;

  v_role := coalesce(nullif(trim(coalesce(p_role, '')), ''), 'participant')::public.citation_role;

  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  select *
  into v_existing
  from public.team_members tm
  where tm.team_id = p_team_id
    and lower(tm.email) = v_email
  limit 1;

  if found then
    update public.team_members tm
    set
      role = v_role,
      active = coalesce(p_active, true),
      display_name = case
        when p_display_name is null then tm.display_name
        when trim(p_display_name) = '' then null
        else trim(p_display_name)
      end,
      user_id = coalesce(v_user_id, tm.user_id)
    where tm.id = v_existing.id
    returning * into v_existing;

    return v_existing;
  end if;

  insert into public.team_members (
    team_id,
    user_id,
    display_name,
    email,
    role,
    active,
    created_at
  )
  values (
    p_team_id,
    v_user_id,
    nullif(trim(coalesce(p_display_name, '')), ''),
    v_email,
    v_role,
    coalesce(p_active, true),
    timezone('utc', now())
  )
  returning * into v_existing;

  return v_existing;
end;
$$;

create or replace function public.admin_update_team_member(
  p_team_member_id uuid,
  p_role text default null,
  p_active boolean default null,
  p_display_name text default null
)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.team_members;
  v_role public.citation_role;
  v_remove_admin boolean := false;
  v_other_admin_count integer := 0;
begin
  select *
  into v_target
  from public.team_members tm
  where tm.id = p_team_member_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: team member % does not exist', p_team_member_id;
  end if;

  perform public.assert_team_admin(v_target.team_id);

  if p_role is not null then
    v_role := nullif(trim(p_role), '')::public.citation_role;
  else
    v_role := v_target.role;
  end if;

  if v_target.active = true and v_target.role = 'admin' and (
    (p_active is false)
    or (p_role is not null and v_role <> 'admin')
  ) then
    v_remove_admin := true;
  end if;

  if v_remove_admin then
    select count(*)
    into v_other_admin_count
    from public.team_members tm
    where tm.team_id = v_target.team_id
      and tm.active = true
      and tm.role = 'admin'
      and tm.id <> v_target.id;

    if v_other_admin_count = 0 then
      raise exception 'VALIDATION: at least one active admin is required per team';
    end if;
  end if;

  update public.team_members tm
  set
    role = v_role,
    active = coalesce(p_active, tm.active),
    display_name = case
      when p_display_name is null then tm.display_name
      when trim(p_display_name) = '' then null
      else trim(p_display_name)
    end
  where tm.id = v_target.id
  returning * into v_target;

  return v_target;
end;
$$;

grant execute on function public.admin_state(uuid) to authenticated;
grant execute on function public.admin_upsert_team_member(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.admin_update_team_member(uuid, text, boolean, text) to authenticated;
