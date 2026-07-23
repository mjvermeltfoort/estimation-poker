-- Add team projects, project-linked tickets, and admin Jira settings RPCs.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  jira_project_key text not null,
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_projects_team_name_unique
  on public.projects(team_id, lower(name));

create unique index if not exists idx_projects_team_key_unique
  on public.projects(team_id, upper(jira_project_key));

alter table public.estimation_tickets
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists ticket_number text;

create index if not exists idx_tickets_session_project_sort
  on public.estimation_tickets(session_id, project_id, sort_order, created_at);

create unique index if not exists idx_tickets_session_project_number_unique
  on public.estimation_tickets(session_id, project_id, upper(ticket_number))
  where project_id is not null and ticket_number is not null;

update public.estimation_tickets
set ticket_number = split_part(jira_issue_key, '-', 2)
where ticket_number is null
  and position('-' in jira_issue_key) > 0;

alter table public.projects enable row level security;

drop policy if exists projects_select_member on public.projects;
create policy projects_select_member
on public.projects
for select
using (
  exists (
    select 1
    from public.team_members tm
    where tm.team_id = projects.team_id
      and tm.active = true
      and (
        tm.user_id = auth.uid()
        or lower(tm.email) = lower(public.current_user_email())
      )
  )
);

drop policy if exists projects_mutate_facilitator on public.projects;
create policy projects_mutate_facilitator
on public.projects
for all
using (public.current_user_can_facilitate(team_id))
with check (public.current_user_can_facilitate(team_id));

create or replace function public.projects_state(
  p_team_id uuid,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_projects jsonb;
begin
  if p_team_id is null then
    raise exception 'VALIDATION: team_id is required';
  end if;

  if public.current_member_for_team(p_team_id) is null then
    raise exception 'FORBIDDEN: membership required for team %', p_team_id;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', p.id,
      'teamId', p.team_id,
      'name', p.name,
      'jiraProjectKey', p.jira_project_key,
      'isArchived', p.is_archived,
      'createdAt', p.created_at,
      'updatedAt', p.updated_at
    ) order by p.is_archived asc, p.name asc),
    '[]'::jsonb
  )
  into v_projects
  from public.projects p
  where p.team_id = p_team_id
    and (p_include_archived or p.is_archived = false);

  return jsonb_build_object(
    'teamId', p_team_id,
    'projects', v_projects
  );
end;
$$;

create or replace function public.upsert_project(
  p_team_id uuid,
  p_name text,
  p_jira_project_key text,
  p_project_id uuid default null,
  p_is_archived boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_name text;
  v_key text;
begin
  if p_team_id is null then
    raise exception 'VALIDATION: team_id is required';
  end if;

  perform public.assert_team_facilitator(p_team_id);

  v_name := trim(coalesce(p_name, ''));
  v_key := upper(trim(coalesce(p_jira_project_key, '')));

  if v_name = '' then
    raise exception 'VALIDATION: project name is required';
  end if;

  if v_key = '' then
    raise exception 'VALIDATION: jira project key is required';
  end if;

  if p_project_id is null then
    insert into public.projects (
      team_id,
      name,
      jira_project_key,
      is_archived
    )
    values (
      p_team_id,
      v_name,
      v_key,
      coalesce(p_is_archived, false)
    )
    returning * into v_project;
  else
    update public.projects p
    set
      name = v_name,
      jira_project_key = v_key,
      is_archived = coalesce(p_is_archived, p.is_archived),
      updated_at = timezone('utc', now())
    where p.id = p_project_id
      and p.team_id = p_team_id
    returning * into v_project;

    if v_project.id is null then
      raise exception 'NOT_FOUND: project % not found for team %', p_project_id, p_team_id;
    end if;
  end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', v_project.id,
      'teamId', v_project.team_id,
      'name', v_project.name,
      'jiraProjectKey', v_project.jira_project_key,
      'isArchived', v_project.is_archived,
      'createdAt', v_project.created_at,
      'updatedAt', v_project.updated_at
    )
  );
end;
$$;

create or replace function public.admin_get_team_settings(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team public.teams;
begin
  if p_team_id is null then
    raise exception 'VALIDATION: team_id is required';
  end if;

  perform public.assert_team_admin(p_team_id);

  select *
  into v_team
  from public.teams t
  where t.id = p_team_id
    and t.active = true;

  if v_team.id is null then
    raise exception 'NOT_FOUND: team % not found', p_team_id;
  end if;

  return jsonb_build_object(
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'jiraBaseUrl', v_team.jira_base_url,
      'jiraProjectKey', v_team.jira_project_key,
      'active', v_team.active
    )
  );
end;
$$;

create or replace function public.admin_update_team_settings(
  p_team_id uuid,
  p_jira_base_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams;
  v_base text;
begin
  if p_team_id is null then
    raise exception 'VALIDATION: team_id is required';
  end if;

  perform public.assert_team_admin(p_team_id);

  v_base := trim(coalesce(p_jira_base_url, ''));
  if v_base = '' then
    raise exception 'VALIDATION: jira_base_url is required';
  end if;

  update public.teams t
  set jira_base_url = v_base
  where t.id = p_team_id
    and t.active = true
  returning * into v_team;

  if v_team.id is null then
    raise exception 'NOT_FOUND: team % not found', p_team_id;
  end if;

  return jsonb_build_object(
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'jiraBaseUrl', v_team.jira_base_url,
      'jiraProjectKey', v_team.jira_project_key,
      'active', v_team.active
    )
  );
end;
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
    select et.*, p.name as project_name, p.jira_project_key as project_key, p.is_archived
    from public.estimation_tickets et
    join base b on b.current_ticket_id = et.id
    left join public.projects p on p.id = et.project_id
  ),
  viewer as (
    select tm.id as member_id, tm.display_name, tm.role
    from public.team_members tm
    join base b on b.team_id = tm.team_id
    where tm.active = true
      and (
        tm.user_id = auth.uid()
        or lower(tm.email) = lower(public.current_user_email())
      )
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
      'projectId', t.project_id,
      'projectName', t.project_name,
      'projectKey', t.project_key,
      'ticketNumber', t.ticket_number,
      'jiraIssueKey', t.jira_issue_key,
      'jiraBrowseUrl', case
        when coalesce((select jira_base_url from base), '') = '' then null
        else regexp_replace((select jira_base_url from base), '/+$', '') || '/browse/' || t.jira_issue_key
      end,
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
        'projectId', et.project_id,
        'projectName', p.name,
        'projectKey', p.jira_project_key,
        'ticketNumber', et.ticket_number,
        'jiraIssueKey', et.jira_issue_key,
        'jiraBrowseUrl', case
          when coalesce((select jira_base_url from base), '') = '' then null
          else regexp_replace((select jira_base_url from base), '/+$', '') || '/browse/' || et.jira_issue_key
        end,
        'summary', et.summary,
        'description', et.description,
        'status', et.status,
        'sortOrder', et.sort_order,
        'finalEstimateHours', et.final_estimate_hours,
        'createdAt', et.created_at
      ) order by et.sort_order asc, et.created_at asc)
      from public.estimation_tickets et
      join base b on b.id = et.session_id
      left join public.projects p on p.id = et.project_id
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'teamId', p.team_id,
        'name', p.name,
        'jiraProjectKey', p.jira_project_key,
        'isArchived', p.is_archived,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
      ) order by p.is_archived asc, p.name asc)
      from public.projects p
      join base b on b.team_id = p.team_id
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
      'canFacilitate', (v.role::text in ('facilitator', 'admin'))
    ) from viewer v),
    'currentRoundNumber', (select n from current_round)
  );
$$;

create or replace function public.create_estimation_ticket(
  p_session_id uuid,
  p_project_id uuid,
  p_ticket_number text,
  p_summary text,
  p_description text default '',
  p_status public.ticket_status default 'pending',
  p_sort_order integer default 1,
  p_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.estimation_sessions;
  v_project public.projects;
  v_ticket public.estimation_tickets;
  v_ticket_number text;
  v_jira_issue_key text;
begin
  select *
  into v_session
  from public.estimation_sessions s
  where s.id = p_session_id;

  if v_session.id is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    raise exception 'SESSION_COMPLETED';
  end if;

  if p_project_id is null then
    raise exception 'VALIDATION: project_id is required';
  end if;

  select *
  into v_project
  from public.projects p
  where p.id = p_project_id
    and p.team_id = v_session.team_id;

  if v_project.id is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_project.is_archived then
    raise exception 'PROJECT_ARCHIVED';
  end if;

  v_ticket_number := upper(trim(coalesce(p_ticket_number, '')));
  if v_ticket_number = '' then
    raise exception 'VALIDATION: ticket_number is required';
  end if;

  if nullif(trim(coalesce(p_summary, '')), '') is null then
    raise exception 'VALIDATION: summary is required';
  end if;

  if coalesce(p_sort_order, 0) < 1 then
    raise exception 'VALIDATION: sort_order must be positive';
  end if;

  perform public.assert_team_facilitator(v_session.team_id);

  v_jira_issue_key := v_project.jira_project_key || '-' || v_ticket_number;

  insert into public.estimation_tickets (
    session_id,
    project_id,
    ticket_number,
    jira_issue_key,
    summary,
    description,
    status,
    sort_order,
    created_at
  )
  values (
    v_session.id,
    v_project.id,
    v_ticket_number,
    v_jira_issue_key,
    trim(p_summary),
    trim(coalesce(p_description, '')),
    coalesce(p_status, 'pending'::public.ticket_status),
    coalesce(p_sort_order, 1),
    coalesce(p_created_at, timezone('utc', now()))
  )
  returning * into v_ticket;

  return jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'sessionId', v_ticket.session_id,
      'projectId', v_ticket.project_id,
      'projectName', v_project.name,
      'projectKey', v_project.jira_project_key,
      'ticketNumber', v_ticket.ticket_number,
      'jiraIssueKey', v_ticket.jira_issue_key,
      'jiraBrowseUrl', case
        when coalesce((select jira_base_url from public.teams where id = v_session.team_id), '') = '' then null
        else regexp_replace((select jira_base_url from public.teams where id = v_session.team_id), '/+$', '') || '/browse/' || v_ticket.jira_issue_key
      end,
      'summary', v_ticket.summary,
      'description', v_ticket.description,
      'status', v_ticket.status,
      'sortOrder', v_ticket.sort_order,
      'finalEstimateHours', v_ticket.final_estimate_hours,
      'createdAt', v_ticket.created_at
    ),
    'sessionState', public.session_state(v_session.id)
  );
end;
$$;

grant execute on function public.projects_state(uuid, boolean) to authenticated;
grant execute on function public.upsert_project(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.admin_get_team_settings(uuid) to authenticated;
grant execute on function public.admin_update_team_settings(uuid, text) to authenticated;
grant execute on function public.create_estimation_ticket(uuid, uuid, text, text, text, public.ticket_status, integer, timestamptz) to authenticated;
