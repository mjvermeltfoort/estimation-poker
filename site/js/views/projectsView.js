import { getHomeState, getProjectsState, upsertProject } from "../api.js";
import { getCurrentUser } from "../authSession.js";
import { isApiConfigured } from "../config.js";
import { showToast } from "../notifications.js";
import { getStoredValue, setStoredValue, STORAGE_KEYS } from "../storage.js";
import { el, errorMessage, normalizeList, setBusy } from "../utils.js";
import { renderErrorView } from "./errorView.js";

function canManageProjects(membership) {
  return membership?.active !== false && ["facilitator", "admin"].includes(membership?.role);
}

function normalizeProject(project) {
  return {
    ...project,
    jiraProjectKey: String(project?.jiraProjectKey || "").trim().toUpperCase(),
  };
}

function projectRow(project, teamId, refresh) {
  const row = el("div", { className: "ticket-list-item" }, [
    el("span", { className: "ticket-list-item__order", text: project.isArchived ? "A" : "P" }),
    el("span", { className: "ticket-list-item__content" }, [
      el("strong", { text: project.name }),
      el("span", { text: `${project.jiraProjectKey}${project.isArchived ? " · archived" : ""}` }),
    ]),
  ]);

  const controls = el("div", { className: "button-row" });
  const edit = el("button", { className: "button button--secondary", type: "button", text: "Edit" });
  const toggle = el("button", {
    className: project.isArchived ? "button button--secondary" : "button button--danger",
    type: "button",
    text: project.isArchived ? "Unarchive" : "Archive",
  });

  edit.addEventListener("click", async () => {
    const nextName = window.prompt("Project name", project.name || "");
    if (nextName === null) return;
    const nextKey = window.prompt("Jira project key", project.jiraProjectKey || "");
    if (nextKey === null) return;
    setBusy([edit, toggle], true, "Saving…");
    try {
      await upsertProject({
        teamId,
        projectId: project.id,
        name: nextName,
        jiraProjectKey: nextKey,
        isArchived: project.isArchived === true,
      });
      showToast("Project updated", "success");
      await refresh();
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy([edit, toggle], false);
    }
  });

  toggle.addEventListener("click", async () => {
    setBusy([edit, toggle], true, "Saving…");
    try {
      await upsertProject({
        teamId,
        projectId: project.id,
        name: project.name,
        jiraProjectKey: project.jiraProjectKey,
        isArchived: project.isArchived !== true,
      });
      showToast(project.isArchived ? "Project unarchived" : "Project archived", "success");
      await refresh();
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy([edit, toggle], false);
    }
  });

  controls.append(edit, toggle);
  row.append(controls);
  return row;
}

export async function renderProjectsView({ app, isCurrent = () => true }) {
  document.title = "Projects · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API not configured", error: new Error("Set supabaseUrl and supabaseAnonKey in site/js/config.js first.") });
    return;
  }

  const memberships = normalizeList(getCurrentUser()?.memberships).filter(canManageProjects);
  if (!memberships.length) {
    app.replaceChildren(el("section", { className: "empty-state" }, [
      el("h1", { text: "Facilitator access required" }),
      el("p", { text: "Only facilitators and admins can manage projects." }),
      el("a", { className: "button button--secondary", href: "#/", text: "Back" }),
    ]));
    return;
  }

  app.replaceChildren(el("section", { className: "loading-state", role: "status" }, [
    el("span", { className: "spinner" }),
    el("p", { text: "Loading projects…" }),
  ]));

  try {
    const allowedTeamIds = new Set(memberships.map((membership) => String(membership.teamId)));
    const preferredTeamId = getStoredValue(STORAGE_KEYS.selectedTeamId, null);
    const homeState = await getHomeState(preferredTeamId);
    if (!isCurrent()) return;

    const teams = normalizeList(homeState?.teams).filter((team) => allowedTeamIds.has(String(team.id)));
    if (!teams.length) {
      app.replaceChildren(el("section", { className: "empty-state" }, [
        el("h1", { text: "No facilitator teams found" }),
        el("p", { text: "Your account has no active team with facilitator/admin project permissions." }),
        el("a", { className: "button button--secondary", href: "#/", text: "Back" }),
      ]));
      return;
    }

    const renderForTeam = async (teamId) => {
      const projectState = await getProjectsState(teamId, true);
      if (!isCurrent()) return;
      setStoredValue(STORAGE_KEYS.selectedTeamId, teamId);
      const projects = normalizeList(projectState?.projects).map(normalizeProject);
      const activeProjects = projects.filter((project) => project.isArchived !== true);

      const heading = el("div", { className: "page-heading" }, [
        el("div", {}, [
          el("p", { className: "eyebrow", text: "Facilitator tools" }),
          el("h1", { text: "Projects" }),
          el("p", { className: "muted", text: "Create, update, and archive projects used for ticket estimation." }),
        ]),
        el("a", { className: "button button--ghost", href: "#/", text: "Back to sessions" }),
      ]);

      const teamSelect = el("select", { id: "projects-team", className: "select" });
      teams.forEach((team) => teamSelect.append(el("option", {
        value: team.id,
        text: team.name || team.id,
        selected: String(team.id) === String(teamId),
      })));
      teamSelect.addEventListener("change", () => renderForTeam(teamSelect.value));

      const teamPicker = el("section", { className: "panel" }, [
        el("div", { className: "team-picker" }, [
          el("label", { htmlFor: "projects-team", text: "Team" }),
          teamSelect,
        ]),
      ]);

      const listPanel = el("section", { className: "panel" }, [
        el("div", { className: "section-heading section-heading--compact" }, [
          el("div", {}, [
            el("h2", { text: "Existing projects" }),
            el("p", { className: "muted", text: `${activeProjects.length} active · ${projects.length - activeProjects.length} archived` }),
          ]),
        ]),
      ]);

      const list = el("div", { className: "ticket-list" });
      if (!projects.length) {
        list.append(el("div", { className: "empty-state empty-state--compact", text: "No projects yet. Create one below." }));
      } else {
        projects.forEach((project) => list.append(projectRow(project, teamId, () => renderForTeam(teamId))));
      }
      listPanel.append(list);

      const createForm = el("form", { className: "panel form-grid", noValidate: true });
      const name = el("input", { id: "new-project-name", placeholder: "Project name" });
      const key = el("input", { id: "new-project-key", placeholder: "Jira project key (e.g. APP)" });
      const nameError = el("p", { className: "field-error" });
      const keyError = el("p", { className: "field-error" });
      const submit = el("button", { className: "button button--primary", type: "submit", text: "Create project" });

      createForm.append(
        el("div", { className: "field" }, [el("label", { htmlFor: "new-project-name", text: "Project name *" }), name, nameError]),
        el("div", { className: "field" }, [el("label", { htmlFor: "new-project-key", text: "Jira project key *" }), key, keyError]),
        el("div", { className: "field--wide" }, [submit]),
      );

      createForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        nameError.textContent = "";
        keyError.textContent = "";
        const projectName = name.value.trim();
        const projectKey = key.value.trim().toUpperCase();
        key.value = projectKey;

        let valid = true;
        if (!projectName) {
          nameError.textContent = "Enter a project name.";
          valid = false;
        }
        if (!projectKey) {
          keyError.textContent = "Enter a Jira project key.";
          valid = false;
        }
        if (activeProjects.some((project) => String(project.name || "").trim().toLowerCase() === projectName.toLowerCase())) {
          nameError.textContent = "This project name already exists.";
          valid = false;
        }
        if (activeProjects.some((project) => String(project.jiraProjectKey || "").trim().toUpperCase() === projectKey)) {
          keyError.textContent = "This Jira project key already exists.";
          valid = false;
        }
        if (!valid) return;

        setBusy(submit, true, "Creating…");
        try {
          await upsertProject({
            teamId,
            name: projectName,
            jiraProjectKey: projectKey,
            isArchived: false,
          });
          showToast("Project created", "success");
          await renderForTeam(teamId);
        } catch (error) {
          showToast(errorMessage(error), "error");
          setBusy(submit, false);
        }
      });

      app.replaceChildren(heading, teamPicker, listPanel, createForm);
    };

    const selectedTeamId = teams.some((team) => String(team.id) === String(homeState?.selectedTeamId))
      ? homeState.selectedTeamId
      : teams[0].id;
    await renderForTeam(selectedTeamId);
  } catch (error) {
    if (!isCurrent()) return;
    renderErrorView({ app, title: "The projects page could not be loaded", error, retry: () => renderProjectsView({ app, isCurrent }) });
  }
}