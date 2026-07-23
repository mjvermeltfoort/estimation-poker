-- Ensure admins inherit facilitator capabilities in permission helpers.

create or replace function public.current_facilitator_for_team(p_team_id uuid)
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
    and tm.role::text in ('facilitator', 'admin')
    and (
      tm.user_id = auth.uid()
      or lower(tm.email) = lower(public.current_user_email())
    )
  order by tm.created_at asc
  limit 1
$$;

create or replace function public.assert_team_facilitator(p_team_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_facilitator_member_id uuid;
begin
  v_facilitator_member_id := public.current_facilitator_for_team(p_team_id);
  if v_facilitator_member_id is null then
    raise exception 'FORBIDDEN: facilitator or admin membership required for team %', p_team_id;
  end if;
  return v_facilitator_member_id;
end;
$$;

grant execute on function public.current_facilitator_for_team(uuid) to authenticated;
grant execute on function public.assert_team_facilitator(uuid) to authenticated;
