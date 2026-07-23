-- Make ticket summary/description optional for project-linked ticket creation.
-- This migration is additive for environments where 008 has already been applied.

create or replace function public.create_estimation_ticket(
  p_session_id uuid,
  p_project_id uuid,
  p_ticket_number text,
  p_summary text default null,
  p_description text default null,
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
    coalesce(nullif(trim(coalesce(p_summary, '')), ''), v_jira_issue_key),
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

grant execute on function public.create_estimation_ticket(uuid, uuid, text, text, text, public.ticket_status, integer, timestamptz) to authenticated;
