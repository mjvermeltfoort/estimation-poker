-- Fix recursive RLS evaluation on public.team_members.
-- The original team_members SELECT policy queried team_members directly,
-- which can recurse during policy checks.

create or replace function public.current_member_for_team(p_team_id uuid)
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
    and (
      tm.user_id = auth.uid()
      or lower(tm.email) = lower(public.current_user_email())
    )
  order by tm.created_at asc
  limit 1
$$;

drop policy if exists team_members_select_member on public.team_members;

create policy team_members_select_member
on public.team_members
for select
using (public.current_member_for_team(team_members.team_id) is not null);
