import { createEstimationTicket, createSession, getHomeState, getProjectsState, upsertProject } from "../api.js";
import { getCurrentUser } from "../authSession.js";
import { isApiConfigured } from "../config.js";
import { navigateTo } from "../router.js";
import { setStoredValue, STORAGE_KEYS } from "../storage.js";
import { el, errorMessage, normalizeList, parseJiraTicketInput, setBusy } from "../utils.js";
import { showToast } from "../notifications.js";
import { renderErrorView } from "./errorView.js";

function isActive(record) {
  return record.active !== false && String(record.active).toLowerCase() !== "false";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function addField(form, { id, label, type = "text", required = false, placeholder = "", multiline = false }) {
  const input = el(multiline ? "textarea" : "input", {
    id,
    name: id,
    type: multiline ? undefined : type,
    required,
    placeholder,
    rows: multiline ? 4 : undefined,
  });
  const error = el("p", { className: "field-error", id: `${id}-error` });
  const group = el("div", { className: "field" }, [
    el("label", { htmlFor: id, text: `${label}${required ? " *" : ""}` }), input, error,
  ]);
  form.append(group);
  return { input, error };
}

export async function renderCreateSessionView({ app, isCurrent = () => true }) {
  document.title = "New session · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API not configured", error: new Error("Set supabaseUrl and supabaseAnonKey in site/js/config.js first.") });
    return;
  }
  app.replaceChildren(el("section", { className: "loading-state", role: "status" }, [el("span", { className: "spinner" }), el("p", { text: "Loading form…" })]));

  try {
    const currentUser = getCurrentUser();
    const facilitatorMemberships = (currentUser?.memberships || []).filter((membership) => ["facilitator", "admin"].includes(membership.role));
    const facilitatorTeamIds = new Set(facilitatorMemberships.map((membership) => String(membership.teamId)));
    const homeState = await getHomeState();
    const teams = normalizeList(homeState?.teams)
      .filter(isActive)
      .filter((team) => facilitatorTeamIds.has(String(team.id)));
    if (!isCurrent()) return;
    if (!teams.length) {
      app.replaceChildren(el("section", { className: "empty-state" }, [
        el("h1", { text: "Facilitator access required" }),
        el("p", { text: "Your signed-in account is not registered as a facilitator or admin for an active team." }),
        el("a", { className: "button button--secondary", href: "#/", text: "Back" }),
      ]));
      return;
    }

    const section = el("section", { className: "form-page" }, [
      el("div", { className: "page-heading" }, [
        el("div", {}, [el("p", { className: "eyebrow", text: "Set up" }), el("h1", { text: "New session" })]),
        el("a", { className: "button button--ghost", href: "#/", text: "Cancel" }),
      ]),
    ]);
    const form = el("form", { className: "panel form-grid", noValidate: true });
    let currentProjects = [];
    const teamSelect = el("select", { id: "teamId", name: "teamId", required: true });
    teams.forEach((team) => teamSelect.append(el("option", { value: team.id, text: team.name || team.id })));
    const teamError = el("p", { className: "field-error", id: "teamId-error" });
    form.append(el("div", { className: "field" }, [el("label", { htmlFor: "teamId", text: "Team *" }), teamSelect, teamError]));

    const projectSelect = el("select", { id: "projectId", name: "projectId", required: true });
    const projectError = el("p", { className: "field-error", id: "projectId-error" });
    form.append(el("div", { className: "field" }, [el("label", { htmlFor: "projectId", text: "Project *" }), projectSelect, projectError]));

    const quickProjectName = el("input", { id: "quickProjectName", placeholder: "New project name" });
    const quickProjectKey = el("input", { id: "quickProjectKey", placeholder: "New Jira project key (e.g. APP)" });
    const quickProjectError = el("p", { className: "field-error", id: "quickProject-error" });
    const quickProjectButton = el("button", { className: "button button--secondary", type: "button", text: "Create project" });
    form.append(el("div", { className: "field field--wide" }, [
      el("label", { htmlFor: "quickProjectName", text: "Quick create project" }),
      el("div", { className: "button-row" }, [quickProjectName, quickProjectKey, quickProjectButton]),
      quickProjectError,
    ]));

    const name = addField(form, { id: "sessionName", label: "Session name", required: true, placeholder: "For example, Sprint 18 refinement" });
    const facilitatorName = el("p", { className: "readonly-value", text: currentUser?.displayName || currentUser?.email || "Signed-in facilitator" });
    form.append(el("div", { className: "field" }, [
      el("span", { className: "field-label", text: "Facilitator" }),
      facilitatorName,
        el("p", { className: "muted", text: "Verified from your signed-in account." }),
    ]));

    const divider = el("div", { className: "form-divider field--wide" }, [
      el("h2", { text: "First ticket (optional)" }),
      el("p", { className: "muted", text: "You can add more tickets later from the facilitator screen." }),
    ]);
    form.append(divider);
    const ticketInput = addField(form, {
      id: "jiraIssueInput",
      label: "Ticket",
      placeholder: "Paste APP-123, 123, or Jira /browse URL",
    });
    ticketInput.input.closest(".field").classList.add("field--wide");

    const submit = el("button", { className: "button button--primary", type: "submit", text: "Create session" });
    form.append(el("div", { className: "button-row field--wide" }, [submit, el("a", { className: "button button--secondary", href: "#/", text: "Cancel" })]));
    section.append(form);
    app.replaceChildren(section);

    async function loadProjectsForTeam(teamId, preferredProjectId = null) {
      projectSelect.replaceChildren();
      projectSelect.append(el("option", { value: "", text: "Loading projects…", selected: true }));
      const state = await getProjectsState(teamId, false);
      const projects = normalizeList(state?.projects).filter(isActive);
      currentProjects = projects.map((project) => ({
        ...project,
        jiraProjectKey: String(project.jiraProjectKey || "").trim().toUpperCase(),
      }));
      projectSelect.replaceChildren();
      if (!currentProjects.length) {
        projectSelect.append(el("option", { value: "", text: "No active project", selected: true }));
        return;
      }
      const selected = preferredProjectId && currentProjects.some((project) => String(project.id) === String(preferredProjectId))
        ? String(preferredProjectId)
        : String(currentProjects[0].id);
      currentProjects.forEach((project) => projectSelect.append(el("option", {
        value: project.id,
        text: `${project.name} (${project.jiraProjectKey})`,
        dataset: { projectKey: project.jiraProjectKey },
        selected: String(project.id) === selected,
      })));
    }

    await loadProjectsForTeam(teamSelect.value);

    teamSelect.addEventListener("change", async () => {
      projectError.textContent = "";
      try {
        await loadProjectsForTeam(teamSelect.value);
      } catch (error) {
        projectError.textContent = errorMessage(error);
      }
    });

    quickProjectButton.addEventListener("click", async () => {
      quickProjectError.textContent = "";
      const projectName = quickProjectName.value.trim();
      const projectKey = quickProjectKey.value.trim().toUpperCase();
      quickProjectKey.value = projectKey;
      if (!projectName || !projectKey) {
        quickProjectError.textContent = "Enter both a project name and Jira key.";
        return;
      }
      setBusy(quickProjectButton, true, "Creating…");
      try {
        const result = await upsertProject({
          teamId: teamSelect.value,
          name: projectName,
          jiraProjectKey: projectKey,
          isArchived: false,
        });
        await loadProjectsForTeam(teamSelect.value, result?.project?.id || null);
        quickProjectName.value = "";
        quickProjectKey.value = "";
        showToast("Project created", "success");
      } catch (error) {
        quickProjectError.textContent = errorMessage(error);
        setBusy(quickProjectButton, false);
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      [teamError, projectError, quickProjectError, name.error, ticketInput.error].forEach((node) => { node.textContent = ""; });
      const parsed = parseJiraTicketInput(ticketInput.input.value);
      let valid = true;
      if (!teamSelect.value) { teamError.textContent = "Select a team."; valid = false; }
      if (teamSelect.value && !isUuid(teamSelect.value)) { teamError.textContent = "Select a valid team."; valid = false; }
      if (!projectSelect.value) { projectError.textContent = "Select a project."; valid = false; }
      if (!name.input.value.trim()) { name.error.textContent = "Enter a session name."; valid = false; }
      if (ticketInput.input.value.trim() && !parsed.ticketNumber) {
        ticketInput.error.textContent = "Paste a ticket number, key (APP-123), or Jira /browse URL.";
        valid = false;
      }

      if (parsed.projectKey) {
        const matchingProject = currentProjects.find((project) => project.jiraProjectKey === parsed.projectKey);
        if (matchingProject) {
          projectSelect.value = matchingProject.id;
        } else {
          ticketInput.error.textContent = `No active project matches ${parsed.projectKey}.`;
          valid = false;
        }
      }

      if (!valid) return;

      setBusy(submit, true, "Creating…");
      try {
        const sessionData = await createSession({
          teamId: teamSelect.value,
          name: name.input.value.trim(),
        });
        const session = sessionData?.session || sessionData;
        if (!session?.id) throw new Error("The server did not return a session ID.");
        setStoredValue(STORAGE_KEYS.selectedTeamId, teamSelect.value);
        setStoredValue(STORAGE_KEYS.lastSessionId, session.id);
        if (parsed.ticketNumber) {
          try {
            await createEstimationTicket({
              sessionId: session.id,
              projectId: projectSelect.value,
              ticketNumber: parsed.ticketNumber,
              status: "pending",
              sortOrder: 1,
              createdAt: new Date().toISOString(),
            });
          } catch (ticketError) {
            showToast(`The session was created, but the first ticket was not: ${errorMessage(ticketError)}`, "warning");
            navigateTo(`/facilitate/${encodeURIComponent(session.id)}`);
            return;
          }
        }
        showToast("Session created", "success");
        navigateTo(`/facilitate/${encodeURIComponent(session.id)}`);
      } catch (error) {
        showToast(errorMessage(error), "error");
        setBusy(submit, false);
      }
    });
  } catch (error) {
    if (!isCurrent()) return;
    renderErrorView({ app, title: "The form could not be loaded", error, retry: () => renderCreateSessionView({ app, isCurrent }) });
  }
}
