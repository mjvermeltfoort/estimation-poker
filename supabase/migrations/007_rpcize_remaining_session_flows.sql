-- Move remaining session and ticket flows behind RPCs and align admin/facilitator semantics.

create or replace function public.current_user_can_facilitate(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_facilitator_for_team(p_team_id) is not null
$$;

create or replace function public.home_state(p_team_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with memberships as (
    select tm.team_id, bool_or(tm.role::text in ('facilitator', 'admin')) as can_facilitate
    from public.team_members tm
    where tm.active = true
      and (
        tm.user_id = auth.uid()
        or lower(tm.email) = lower(public.current_user_email())
      )
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
      'canFacilitate', (v.role::text in ('facilitator', 'admin'))
    ) from viewer v),
    'currentRoundNumber', (select n from current_round)
  );
$$;

create or replace function public.create_session(
  p_team_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.estimation_sessions;
begin
  if p_team_id is null then
    raise exception 'VALIDATION: team_id is required';
  end if;

  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'VALIDATION: session name is required';
  end if;

  perform public.assert_team_facilitator(p_team_id);

  insert into public.estimation_sessions (
    team_id,
    name
  )
  values (
    p_team_id,
    trim(p_name)
  )
  returning * into v_session;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'teamId', v_session.team_id,
      'name', v_session.name,
      'status', v_session.status,
      'createdByMemberId', v_session.created_by_member_id,
      'createdAt', v_session.created_at,
      'startedAt', v_session.started_at,
      'completedAt', v_session.completed_at,
      'currentTicketId', v_session.current_ticket_id
    )
  );
end;
$$;

create or replace function public.create_estimation_ticket(
  p_session_id uuid,
  p_jira_issue_key text,
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
  v_ticket public.estimation_tickets;
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

  if nullif(trim(coalesce(p_jira_issue_key, '')), '') is null then
    raise exception 'VALIDATION: jira_issue_key is required';
  end if;

  if nullif(trim(coalesce(p_summary, '')), '') is null then
    raise exception 'VALIDATION: summary is required';
  end if;

  if coalesce(p_sort_order, 0) < 1 then
    raise exception 'VALIDATION: sort_order must be positive';
  end if;

  perform public.assert_team_facilitator(v_session.team_id);

  insert into public.estimation_tickets (
    session_id,
    jira_issue_key,
    summary,
    description,
    status,
    sort_order,
    created_at
  )
  values (
    v_session.id,
    upper(trim(p_jira_issue_key)),
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
      'jiraIssueKey', v_ticket.jira_issue_key,
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

create or replace function public.restart_ticket_voting(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.estimation_tickets;
  v_session public.estimation_sessions;
begin
  select *
  into v_ticket
  from public.estimation_tickets t
  where t.id = p_ticket_id;

  if v_ticket.id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  select *
  into v_session
  from public.estimation_sessions s
  where s.id = v_ticket.session_id;

  if v_session.id is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.status = 'completed' then
    raise exception 'SESSION_COMPLETED';
  end if;

  if v_ticket.status not in ('revealed', 'estimated', 'skipped') then
    raise exception 'ROUND_RESTART_NOT_ALLOWED';
  end if;

  perform public.assert_team_facilitator(v_session.team_id);

  update public.estimation_tickets
  set status = 'voting'
  where id = v_ticket.id;

  return jsonb_build_object(
    'sessionState', public.session_state(v_session.id)
  );
end;
$$;

create or replace function public.complete_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.estimation_sessions;
begin
  select *
  into v_session
  from public.estimation_sessions s
  where s.id = p_session_id;

  if v_session.id is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  perform public.assert_team_facilitator(v_session.team_id);

  update public.estimation_sessions
  set status = 'completed',
      completed_at = coalesce(completed_at, timezone('utc', now())),
      current_ticket_id = null
  where id = v_session.id;

  return jsonb_build_object(
    'sessionState', public.session_state(v_session.id)
  );
end;
$$;

grant execute on function public.current_user_can_facilitate(uuid) to authenticated;
grant execute on function public.home_state(uuid) to authenticated;
grant execute on function public.session_state(uuid) to authenticated;
grant execute on function public.create_session(uuid, text) to authenticated;
grant execute on function public.create_estimation_ticket(uuid, text, text, text, public.ticket_status, integer, timestamptz) to authenticated;
grant execute on function public.restart_ticket_voting(uuid) to authenticated;
grant execute on function public.complete_session(uuid) to authenticated;