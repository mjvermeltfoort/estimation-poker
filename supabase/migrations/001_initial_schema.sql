-- Estimation Poker Supabase schema (phase 1)
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create type public.estimation_role as enum ('member', 'facilitator');
create type public.session_status as enum ('draft', 'active', 'completed', 'cancelled');
create type public.ticket_status as enum ('pending', 'voting', 'revealed', 'estimated', 'skipped');

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  jira_base_url text not null default '',
  jira_project_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  active boolean not null default true
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  email text not null,
  role public.estimation_role not null default 'member',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique (team_id, lower(email))
);

create table if not exists public.estimation_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  status public.session_status not null default 'draft',
  created_by_member_id uuid not null references public.team_members(id),
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  current_ticket_id uuid
);

create table if not exists public.estimation_tickets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.estimation_sessions(id) on delete cascade,
  jira_issue_key text not null,
  summary text not null,
  description text not null default '',
  status public.ticket_status not null default 'pending',
  sort_order integer not null default 1,
  final_estimate_hours numeric(8,2),
  current_round_number integer not null default 1,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.estimation_sessions
  add constraint estimation_sessions_current_ticket_fk
  foreign key (current_ticket_id) references public.estimation_tickets(id) on delete set null;

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.estimation_sessions(id) on delete cascade,
  ticket_id uuid not null references public.estimation_tickets(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  round_number integer not null,
  estimate_hours numeric(8,2) not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (ticket_id, team_member_id, round_number),
  constraint votes_round_positive check (round_number > 0),
  constraint votes_estimate_allowed check (estimate_hours in (0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40))
);

create index if not exists idx_team_members_user_id on public.team_members(user_id);
create index if not exists idx_sessions_team_id on public.estimation_sessions(team_id);
create index if not exists idx_tickets_session_id on public.estimation_tickets(session_id);
create index if not exists idx_votes_ticket_round on public.votes(ticket_id, round_number);

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select coalesce(nullif(auth.jwt() ->> 'email', ''), nullif(auth.jwt() -> 'user_metadata' ->> 'email', ''))
$$;

create or replace function public.current_member_for_team(p_team_id uuid)
returns uuid
language sql
stable
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

create or replace function public.current_user_can_facilitate(p_team_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.active = true
      and tm.role = 'facilitator'
      and (
        tm.user_id = auth.uid()
        or lower(tm.email) = lower(public.current_user_email())
      )
  )
$$;

create or replace function public.bind_user_memberships()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(public.current_user_email());
begin
  if v_uid is null or v_email is null then
    return;
  end if;

  update public.team_members
  set user_id = v_uid
  where user_id is null
    and lower(email) = v_email;
end;
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
    raise exception 'FORBIDDEN';
  end if;

  new.created_by_member_id := v_member_id;
  if new.created_at is null then
    new.created_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_session_creator on public.estimation_sessions;
create trigger trg_set_session_creator
before insert on public.estimation_sessions
for each row execute function public.set_session_creator();

create or replace function public.advance_round_on_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.status = 'voting'
    and old.status in ('revealed', 'estimated', 'skipped')
  then
    new.current_round_number := greatest(old.current_round_number + 1, 1);
  elsif tg_op = 'INSERT' and new.current_round_number is null then
    new.current_round_number := 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_advance_round_on_status_transition on public.estimation_tickets;
create trigger trg_advance_round_on_status_transition
before insert or update on public.estimation_tickets
for each row execute function public.advance_round_on_status_transition();

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.estimation_sessions enable row level security;
alter table public.estimation_tickets enable row level security;
alter table public.votes enable row level security;

create policy if not exists teams_select_member
on public.teams
for select
using (exists (
  select 1
  from public.team_members tm
  where tm.team_id = teams.id
    and tm.active = true
    and (tm.user_id = auth.uid() or lower(tm.email) = lower(public.current_user_email()))
));

create policy if not exists team_members_select_member
on public.team_members
for select
using (exists (
  select 1
  from public.team_members me
  where me.team_id = team_members.team_id
    and me.active = true
    and (me.user_id = auth.uid() or lower(me.email) = lower(public.current_user_email()))
));

create policy if not exists sessions_select_member
on public.estimation_sessions
for select
using (public.current_member_for_team(team_id) is not null);

create policy if not exists sessions_mutate_facilitator
on public.estimation_sessions
for all
using (public.current_user_can_facilitate(team_id))
with check (public.current_user_can_facilitate(team_id));

create policy if not exists tickets_select_member
on public.estimation_tickets
for select
using (exists (
  select 1
  from public.estimation_sessions s
  where s.id = estimation_tickets.session_id
    and public.current_member_for_team(s.team_id) is not null
));

create policy if not exists tickets_mutate_facilitator
on public.estimation_tickets
for all
using (exists (
  select 1
  from public.estimation_sessions s
  where s.id = estimation_tickets.session_id
    and public.current_user_can_facilitate(s.team_id)
))
with check (exists (
  select 1
  from public.estimation_sessions s
  where s.id = estimation_tickets.session_id
    and public.current_user_can_facilitate(s.team_id)
));

-- Votes are written through RPC only and never selected directly.
create policy if not exists votes_no_direct_select
on public.votes
for select
using (false);

create policy if not exists votes_insert_member
on public.votes
for insert
with check (exists (
  select 1
  from public.estimation_sessions s
  join public.team_members tm on tm.team_id = s.team_id
  where s.id = votes.session_id
    and tm.id = votes.team_member_id
    and tm.active = true
    and (tm.user_id = auth.uid() or lower(tm.email) = lower(public.current_user_email()))
));

create policy if not exists votes_update_member
on public.votes
for update
using (exists (
  select 1
  from public.estimation_sessions s
  join public.team_members tm on tm.team_id = s.team_id
  where s.id = votes.session_id
    and tm.id = votes.team_member_id
    and tm.active = true
    and (tm.user_id = auth.uid() or lower(tm.email) = lower(public.current_user_email()))
))
with check (exists (
  select 1
  from public.estimation_sessions s
  join public.team_members tm on tm.team_id = s.team_id
  where s.id = votes.session_id
    and tm.id = votes.team_member_id
    and tm.active = true
    and (tm.user_id = auth.uid() or lower(tm.email) = lower(public.current_user_email()))
));

create or replace function public.me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with linked as (
    select
      tm.id,
      tm.team_id,
      tm.display_name,
      tm.role,
      tm.active
    from public.team_members tm
    where tm.active = true
      and (tm.user_id = auth.uid() or lower(tm.email) = lower(public.current_user_email()))
  )
  select jsonb_build_object(
    'id', auth.uid(),
    'email', public.current_user_email(),
    'display_name', coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', public.current_user_email()),
    'memberships', coalesce(
      jsonb_agg(jsonb_build_object(
        'memberId', linked.id,
        'teamId', linked.team_id,
        'displayName', linked.display_name,
        'role', linked.role,
        'active', linked.active
      )) filter (where linked.id is not null),
      '[]'::jsonb
    )
  )
  from linked;
$$;

create or replace function public.home_state(p_team_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with memberships as (
    select tm.team_id, bool_or(tm.role = 'facilitator') as can_facilitate
    from public.team_members tm
    where tm.active = true
      and (tm.user_id = auth.uid() or lower(tm.email) = lower(public.current_user_email()))
    group by tm.team_id
  ),
  visible_teams as (
    select t.*
    from public.teams t
    join memberships m on m.team_id = t.id
    where t.active = true
    order by t.name asc
  ),
  selected as (
    select coalesce(
      (select vt.id from visible_teams vt where vt.id = p_team_id),
      (select vt.id from visible_teams vt limit 1)
    ) as id
  )
  select jsonb_build_object(
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vt.id,
        'name', vt.name,
        'jiraBaseUrl', vt.jira_base_url,
        'jiraProjectKey', vt.jira_project_key,
        'createdAt', vt.created_at,
        'active', vt.active
      ))
      from visible_teams vt
    ), '[]'::jsonb),
    'selectedTeamId', (select id from selected),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'teamId', s.team_id,
        'name', s.name,
        'status', s.status,
        'createdByMemberId', s.created_by_member_id,
        'createdAt', s.created_at,
        'startedAt', s.started_at,
        'completedAt', s.completed_at,
        'currentTicketId', s.current_ticket_id,
        'ticketCount', (select count(*) from public.estimation_tickets t where t.session_id = s.id),
        'canFacilitate', coalesce(m.can_facilitate, false)
      ) order by s.created_at desc)
      from public.estimation_sessions s
      join selected sel on sel.id = s.team_id
      left join memberships m on m.team_id = s.team_id
    ), '[]'::jsonb)
  );
$$;

create or replace function public.session_state(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select s.*, t.name as team_name, t.jira_base_url, t.jira_project_key
    from public.estimation_sessions s
    join public.teams t on t.id = s.team_id
    where s.id = p_session_id
      and public.current_member_for_team(s.team_id) is not null
  ),
  ticket as (
    select et.*
    from public.estimation_tickets et
    join base b on b.current_ticket_id = et.id
  ),
  viewer as (
    select tm.id as member_id, tm.display_name, tm.role
    from public.team_members tm
    join base b on b.team_id = tm.team_id
    where tm.active = true
      and (tm.user_id = auth.uid() or lower(tm.email) = lower(public.current_user_email()))
    order by tm.created_at asc
    limit 1
  ),
  current_round as (
    select coalesce((select current_round_number from ticket), 1) as n
  ),
  current_votes as (
    select v.*
    from public.votes v
    join ticket t on t.id = v.ticket_id
    join current_round r on r.n = v.round_number
  ),
  stats as (
    select
      count(*)::int as count,
      min(estimate_hours) as min,
      max(estimate_hours) as max,
      round(avg(estimate_hours)::numeric, 2) as average,
      percentile_cont(0.5) within group (order by estimate_hours) as median
    from current_votes
  )
  select jsonb_build_object(
    'team', (select jsonb_build_object('id', b.team_id, 'name', b.team_name, 'jiraBaseUrl', b.jira_base_url, 'jiraProjectKey', b.jira_project_key) from base b),
    'session', (select jsonb_build_object(
      'id', b.id,
      'teamId', b.team_id,
      'name', b.name,
      'status', b.status,
      'createdByMemberId', b.created_by_member_id,
      'createdAt', b.created_at,
      'startedAt', b.started_at,
      'completedAt', b.completed_at,
      'currentTicketId', b.current_ticket_id
    ) from base b),
    'currentTicket', (select case when t.id is null then null else jsonb_build_object(
      'id', t.id,
      'sessionId', t.session_id,
      'jiraIssueKey', t.jira_issue_key,
      'summary', t.summary,
      'description', t.description,
      'status', t.status,
      'sortOrder', t.sort_order,
      'finalEstimateHours', t.final_estimate_hours,
      'createdAt', t.created_at
    ) end from ticket t),
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', et.id,
        'sessionId', et.session_id,
        'jiraIssueKey', et.jira_issue_key,
        'summary', et.summary,
        'description', et.description,
        'status', et.status,
        'sortOrder', et.sort_order,
        'finalEstimateHours', et.final_estimate_hours,
        'createdAt', et.created_at
      ) order by et.sort_order asc, et.created_at asc)
      from public.estimation_tickets et
      join base b on b.id = et.session_id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id,
        'teamId', tm.team_id,
        'displayName', tm.display_name,
        'role', tm.role,
        'active', tm.active,
        'createdAt', tm.created_at
      ) order by tm.display_name asc)
      from public.team_members tm
      join base b on b.team_id = tm.team_id
      where tm.active = true
    ), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'sessionId', v.session_id,
        'ticketId', v.ticket_id,
        'teamMemberId', v.team_member_id,
        'roundNumber', v.round_number,
        'hasVoted', true,
        'estimateHours', case when (select status from ticket) in ('revealed', 'estimated') then v.estimate_hours else null end,
        'createdAt', v.created_at
      ) order by v.created_at asc)
      from current_votes v
    ), '[]'::jsonb),
    'statistics', (select jsonb_build_object('count', s.count, 'min', s.min, 'max', s.max, 'average', s.average, 'median', s.median) from stats s),
    'viewer', (select jsonb_build_object(
      'memberId', v.member_id,
      'displayName', v.display_name,
      'role', v.role,
      'canFacilitate', (v.role = 'facilitator')
    ) from viewer v),
    'currentRoundNumber', (select n from current_round)
  );
$$;

create or replace function public.activate_ticket(p_session_id uuid, p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.estimation_sessions where id = p_session_id;
  if v_team_id is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if not public.current_user_can_facilitate(v_team_id) then
    raise exception 'FACILITATOR_REQUIRED';
  end if;

  update public.estimation_tickets
  set status = 'voting'
  where id = p_ticket_id and session_id = p_session_id;

  update public.estimation_sessions
  set current_ticket_id = p_ticket_id,
      status = case when status = 'draft' then 'active' else status end,
      started_at = case when started_at is null then timezone('utc', now()) else started_at end
  where id = p_session_id;

  return jsonb_build_object('sessionState', public.session_state(p_session_id));
end;
$$;

create or replace function public.submit_vote(
  p_session_id uuid,
  p_ticket_id uuid,
  p_round_number integer,
  p_estimate_hours numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.estimation_sessions;
  v_ticket public.estimation_tickets;
  v_member_id uuid;
begin
  select * into v_session from public.estimation_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  v_member_id := public.current_member_for_team(v_session.team_id);
  if v_member_id is null then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_ticket
  from public.estimation_tickets
  where id = p_ticket_id and session_id = p_session_id;

  if v_ticket.id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  if v_session.current_ticket_id is distinct from p_ticket_id then
    raise exception 'TICKET_NOT_ACTIVE';
  end if;

  if v_session.status <> 'active' or v_ticket.status not in ('pending', 'voting') then
    raise exception 'VOTING_CLOSED';
  end if;

  if p_round_number <> v_ticket.current_round_number then
    raise exception 'ROUND_MISMATCH';
  end if;

  insert into public.votes (session_id, ticket_id, team_member_id, round_number, estimate_hours)
  values (p_session_id, p_ticket_id, v_member_id, p_round_number, p_estimate_hours)
  on conflict (ticket_id, team_member_id, round_number)
  do update set
    estimate_hours = excluded.estimate_hours,
    created_at = timezone('utc', now());

  return jsonb_build_object(
    'hasVoted', true,
    'sessionState', public.session_state(p_session_id)
  );
end;
$$;

create or replace function public.reveal_ticket(p_ticket_id uuid, p_round_number integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_team_id uuid;
begin
  select t.session_id, s.team_id
  into v_session_id, v_team_id
  from public.estimation_tickets t
  join public.estimation_sessions s on s.id = t.session_id
  where t.id = p_ticket_id;

  if v_session_id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;
  if not public.current_user_can_facilitate(v_team_id) then
    raise exception 'FACILITATOR_REQUIRED';
  end if;

  if exists (
    select 1
    from public.estimation_tickets t
    where t.id = p_ticket_id
      and t.current_round_number <> p_round_number
  ) then
    raise exception 'ROUND_MISMATCH';
  end if;

  update public.estimation_tickets
  set status = 'revealed'
  where id = p_ticket_id;

  return jsonb_build_object('sessionState', public.session_state(v_session_id));
end;
$$;

create or replace function public.finalize_ticket(p_ticket_id uuid, p_final_estimate_hours numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_team_id uuid;
begin
  select t.session_id, s.team_id
  into v_session_id, v_team_id
  from public.estimation_tickets t
  join public.estimation_sessions s on s.id = t.session_id
  where t.id = p_ticket_id;

  if v_session_id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;
  if not public.current_user_can_facilitate(v_team_id) then
    raise exception 'FACILITATOR_REQUIRED';
  end if;

  update public.estimation_tickets
  set status = 'estimated',
      final_estimate_hours = p_final_estimate_hours
  where id = p_ticket_id;

  return jsonb_build_object('status', 'estimated', 'sessionState', public.session_state(v_session_id));
end;
$$;

grant usage on schema public to anon, authenticated;
grant execute on function public.me() to authenticated;
grant execute on function public.home_state(uuid) to authenticated;
grant execute on function public.session_state(uuid) to authenticated;
grant execute on function public.activate_ticket(uuid, uuid) to authenticated;
grant execute on function public.submit_vote(uuid, uuid, integer, numeric) to authenticated;
grant execute on function public.reveal_ticket(uuid, integer) to authenticated;
grant execute on function public.finalize_ticket(uuid, numeric) to authenticated;
