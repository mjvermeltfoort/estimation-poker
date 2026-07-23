import {
  activateTicket as activateTicketRequest,
  completeSession,
  createEstimationTicket,
  finalizeTicket,
  getSessionState,
  restartTicketVoting,
  revealTicket,
  upsertProject,
} from "../api.js";
import { getCurrentUser } from "../authSession.js";
import { isApiConfigured } from "../config.js";
import { showToast } from "../notifications.js";
import { getStoredValue, roundStorageKey, setStoredValue, STORAGE_KEYS } from "../storage.js";
import {
  VOTE_VALUES, calculateStatistics, el, errorMessage, formatHours, normalizeList,
  safeJiraUrl, setBusy, sortTickets, statusBadge,
} from "../utils.js";
import { renderErrorView } from "./errorView.js";

function isActiveMember(member) {
  return member.active !== false && String(member.active).toLowerCase() !== "false";
}

function normalizeSessionState(data) {
  if (!data || typeof data !== "object" || !data.session) return null;
  return {
    ...data,
    members: normalizeList(data.members),
    tickets: normalizeList(data.tickets),
    votes: normalizeList(data.votes),
  };
}

function getCurrentTicket(model) {
  return model.currentTicket
    || model.tickets.find((ticket) => String(ticket.id) === String(model.session.currentTicketId))
    || null;
}

function participantList(model, currentVotes, revealed) {
  const list = el("ul", { className: "participant-list" });
  model.members.filter(isActiveMember).forEach((member) => {
    const vote = currentVotes.find((item) => String(item.teamMemberId) === String(member.id));
    list.append(el("li", { className: "participant" }, [
      el("span", { className: "avatar avatar--small", text: String(member.displayName || "?").slice(0, 1).toUpperCase() }),
      el("span", { className: "participant__name", text: member.displayName || member.id }),
      el("span", { className: `vote-state ${vote ? "vote-state--done" : ""}`, text: revealed && vote ? formatHours(vote.estimateHours) : vote ? "Voted" : "Not voted yet" }),
    ]));
  });
  return list;
}

function statsGrid(votes, suppliedStatistics, finalEstimateHours) {
  const stats = suppliedStatistics || calculateStatistics(votes);
  const grid = el("dl", { className: "stats-grid" });
  [
    ["Votes", stats.count], ["Average", formatHours(stats.average)], ["Median", formatHours(stats.median)],
    ["Minimum", formatHours(stats.min)], ["Maximum", formatHours(stats.max)],
  ].forEach(([label, value]) => grid.append(el("div", {}, [el("dt", { text: label }), el("dd", { text: String(value ?? "—") })])));
  if (finalEstimateHours !== undefined && finalEstimateHours !== null && finalEstimateHours !== "") {
    grid.append(el("div", { className: "stat-final" }, [el("dt", { text: "Final" }), el("dd", { text: formatHours(finalEstimateHours) })]));
  }
  return { grid, stats };
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = el("textarea", { value: text, className: "clipboard-fallback", readOnly: true });
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copying is not supported by this browser.");
}

function renderTicketList(model, currentTicket, completed, activateTicket) {
  const tickets = sortTickets(model.tickets);
  const list = el("div", { className: "ticket-list" });
  tickets.forEach((ticket, index) => {
    const active = String(ticket.id) === String(currentTicket?.id);
    const button = el("button", {
      className: `ticket-list-item${active ? " ticket-list-item--active" : ""}`,
      type: "button",
      disabled: completed || active,
      "aria-current": active ? "true" : undefined,
    }, [
      el("span", { className: "ticket-list-item__order", text: String(index + 1) }),
      el("span", { className: "ticket-list-item__content" }, [
        el("strong", { text: ticket.jiraIssueKey || "Ticket" }),
        el("span", {
          text: ticket.finalEstimateHours !== undefined && ticket.finalEstimateHours !== null && ticket.finalEstimateHours !== ""
            ? `${ticket.summary || "No title"} · ${formatHours(ticket.finalEstimateHours)}`
            : ticket.summary || "No title",
        }),
      ]),
      statusBadge(ticket.status),
    ]);
    button.addEventListener("click", () => activateTicket(ticket));
    list.append(button);
  });
  return list;
}

function normalizedProjects(model) {
  return normalizeList(model.projects).map((project) => ({
    ...project,
    jiraProjectKey: String(project.jiraProjectKey || "").trim().toUpperCase(),
  }));
}

function activeProjects(model) {
  return normalizedProjects(model).filter((project) => project.isArchived !== true);
}

function getProjectSelectionMap() {
  return getStoredValue(STORAGE_KEYS.facilitatorProjectByTeam, {}, "localStorage") || {};
}

function setProjectSelectionForTeam(teamId, projectId) {
  const key = String(teamId || "").trim();
  if (!key || !projectId) return;
  const map = getProjectSelectionMap();
  map[key] = String(projectId);
  setStoredValue(STORAGE_KEYS.facilitatorProjectByTeam, map, "localStorage");
}

function getDefaultProjectId(model, availableProjects) {
  if (availableProjects.length === 1) return String(availableProjects[0].id);
  const map = getProjectSelectionMap();
  const saved = map[String(model.session?.teamId || "")];
  if (saved && availableProjects.some((project) => String(project.id) === String(saved))) {
    return String(saved);
  }
  return availableProjects.length ? String(availableProjects[0].id) : "";
}

function projectManager(model, completed, refresh) {
  const panel = el("section", { className: "panel" });
  const projects = normalizedProjects(model);
  const active = projects.filter((project) => project.isArchived !== true);
  const teamId = model.session?.teamId;

  panel.append(el("div", { className: "section-heading section-heading--compact" }, [
    el("div", {}, [
      el("h2", { text: "Projects" }),
      el("p", { className: "muted", text: completed ? "A completed session is read-only." : "Create, edit, and archive projects for this team." }),
    ]),
  ]));

  const list = el("div", { className: "ticket-list" });
  if (!projects.length) {
    list.append(el("div", { className: "empty-state empty-state--compact", text: "No projects yet." }));
  } else {
    projects.forEach((project) => {
      const item = el("div", { className: "ticket-list-item" }, [
        el("span", { className: "ticket-list-item__order", text: project.isArchived ? "A" : "P" }),
        el("span", { className: "ticket-list-item__content" }, [
          el("strong", { text: project.name }),
          el("span", { text: `${project.jiraProjectKey}${project.isArchived ? " · archived" : ""}` }),
        ]),
      ]);

      if (!completed) {
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
            await refresh(true);
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
            await refresh(true);
          } catch (error) {
            showToast(errorMessage(error), "error");
            setBusy([edit, toggle], false);
          }
        });

        controls.append(edit, toggle);
        item.append(controls);
      }

      list.append(item);
    });
  }
  panel.append(list);

  const createForm = el("form", { className: "compact-form", noValidate: true });
  const name = el("input", { id: "new-project-name", placeholder: "Project name", disabled: completed });
  const key = el("input", { id: "new-project-key", placeholder: "Project key (e.g. APP)", disabled: completed });
  const nameError = el("p", { className: "field-error" });
  const keyError = el("p", { className: "field-error" });
  const submit = el("button", { className: "button button--primary", type: "submit", text: "Create project", disabled: completed });
  createForm.append(
    el("div", { className: "field" }, [el("label", { htmlFor: "new-project-name", text: "Name *" }), name, nameError]),
    el("div", { className: "field" }, [el("label", { htmlFor: "new-project-key", text: "Jira key *" }), key, keyError]),
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
    if (active.some((project) => String(project.name || "").trim().toLowerCase() === projectName.toLowerCase())) {
      nameError.textContent = "This project name already exists.";
      valid = false;
    }
    if (active.some((project) => String(project.jiraProjectKey || "").trim().toUpperCase() === projectKey)) {
      keyError.textContent = "This Jira project key already exists.";
      valid = false;
    }
    if (!valid) return;
    setBusy(submit, true, "Creating…");
    try {
      const result = await upsertProject({
        teamId,
        name: projectName,
        jiraProjectKey: projectKey,
        isArchived: false,
      });
      if (result?.project?.id) {
        setProjectSelectionForTeam(teamId, result.project.id);
      }
      showToast("Project created", "success");
      await refresh(true);
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(submit, false);
    }
  });

  panel.append(createForm);
  return panel;
}

function addTicketForm(model, completed, refresh) {
  const form = el("form", { className: "compact-form", noValidate: true });
  const projects = activeProjects(model);
  const projectSelect = el("select", {
    id: "new-ticket-project",
    disabled: completed || !projects.length,
    required: true,
  });
  const defaultProjectId = getDefaultProjectId(model, projects);
  if (!projects.length) {
    projectSelect.append(el("option", { value: "", text: "No active project", selected: true }));
  } else {
    projects.forEach((project) => projectSelect.append(el("option", {
      value: project.id,
      text: `${project.name} (${project.jiraProjectKey})`,
      selected: String(project.id) === String(defaultProjectId),
    })));
  }

  const key = el("input", { id: "new-jira-key", placeholder: "123", disabled: completed || !projects.length });
  const summary = el("input", { id: "new-ticket-summary", placeholder: "Ticket title", disabled: completed });
  const description = el("textarea", { id: "new-ticket-description", placeholder: "Description (optional)", rows: 3, disabled: completed });
  const projectError = el("p", { className: "field-error" });
  const keyError = el("p", { className: "field-error" });
  const summaryError = el("p", { className: "field-error" });
  const submit = el("button", { className: "button button--primary", type: "submit", text: "Add ticket", disabled: completed });
  projectSelect.addEventListener("change", () => {
    if (projectSelect.value) {
      setProjectSelectionForTeam(model.session?.teamId, projectSelect.value);
    }
  });
  form.append(
    el("div", { className: "field" }, [el("label", { htmlFor: "new-ticket-project", text: "Project *" }), projectSelect, projectError]),
    el("div", { className: "field" }, [el("label", { htmlFor: "new-jira-key", text: "Ticket number *" }), key, keyError]),
    el("div", { className: "field" }, [el("label", { htmlFor: "new-ticket-summary", text: "Title *" }), summary, summaryError]),
    el("div", { className: "field field--wide" }, [el("label", { htmlFor: "new-ticket-description", text: "Description" }), description]),
    el("div", { className: "field--wide" }, [submit]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const normalizedKey = key.value.trim().toUpperCase();
    key.value = normalizedKey;
    projectError.textContent = "";
    keyError.textContent = "";
    summaryError.textContent = "";
    let valid = true;
    if (!projectSelect.value) { projectError.textContent = "Select a project first."; valid = false; }
    if (!normalizedKey) { keyError.textContent = "Enter a ticket number."; valid = false; }
    if (!summary.value.trim()) { summaryError.textContent = "Enter a title."; valid = false; }
    const selectedProject = projects.find((project) => String(project.id) === String(projectSelect.value));
    const expectedIssueKey = `${selectedProject?.jiraProjectKey || ""}-${normalizedKey}`;
    if (model.tickets.some((ticket) => String(ticket.jiraIssueKey || "").trim().toUpperCase() === expectedIssueKey)) {
      keyError.textContent = "This ticket number is already in the session for that project.";
      valid = false;
    }
    if (!valid) return;
    setBusy(submit, true, "Adding…");
    try {
      setProjectSelectionForTeam(model.session?.teamId, projectSelect.value);
      const sortOrder = model.tickets.reduce((maximum, ticket) => Math.max(maximum, Number(ticket.sortOrder) || 0), 0) + 1;
      const result = await createEstimationTicket({
        sessionId: model.session.id,
        projectId: projectSelect.value,
        ticketNumber: normalizedKey,
        summary: summary.value.trim(),
        description: description.value.trim(),
        status: "pending",
        sortOrder,
        createdAt: new Date().toISOString(),
      });
      showToast("Ticket added", "success");
      await refresh(true, result.sessionState);
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(submit, false);
    }
  });
  return form;
}

function renderFacilitator(app, model, facilitator, roundNumber, context) {
  const { sessionId, refresh } = context;
  const session = model.session;
  const currentTicket = getCurrentTicket(model);
  const completed = session.status === "completed";
  const activeMembers = model.members.filter(isActiveMember);
  const currentVotes = currentTicket
    ? model.votes.filter((vote) => String(vote.ticketId) === String(currentTicket.id) && Number(vote.roundNumber || 1) === Number(roundNumber))
    : [];
  const revealed = currentTicket && ["revealed", "estimated"].includes(currentTicket.status);
  const sortedTickets = sortTickets(model.tickets);
  const openTickets = sortedTickets.filter((ticket) => !["estimated", "skipped"].includes(ticket.status));
  const nextTicket = sortedTickets.find((ticket) => ticket.status === "pending") || null;
  const shareUrl = new URL(`#/session/${encodeURIComponent(sessionId)}`, window.location.href).toString();

  async function activateTicket(ticket) {
    if (completed) return;
    if (["estimated", "revealed", "skipped"].includes(ticket.status)
      && !window.confirm("This ticket has already been handled. Do you still want to reactivate it?")) return;
    try {
      const result = await activateTicketRequest(sessionId, ticket.id);
      const key = roundStorageKey(sessionId, ticket.id);
      if (!getStoredValue(key, null, "sessionStorage")) setStoredValue(key, 1, "sessionStorage");
      showToast(`${ticket.jiraIssueKey || "Ticket"} is active`, "success");
      await refresh(true, result.sessionState);
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  const heading = el("div", { className: "page-heading" }, [
    el("div", {}, [
      el("p", { className: "eyebrow", text: `Facilitator · ${facilitator.displayName || facilitator.id}` }),
      el("h1", { text: session.name || "Estimation session" }),
      el("div", { className: "meta-row" }, [statusBadge(session.status), el("span", { text: `${model.tickets.length} ticket${model.tickets.length === 1 ? "" : "s"}` }), el("span", { className: "refresh-indicator", id: "refresh-status", "aria-live": "polite" })]),
    ]),
    el("div", { className: "button-row" }, [el("a", { className: "button button--ghost", href: "#/", text: "Home" })]),
  ]);

  const sharePanel = el("section", { className: "share-bar" }, [
    el("div", {}, [el("strong", { text: "Participant link" }), el("span", { className: "share-url", text: shareUrl })]),
    (() => {
      const copy = el("button", { className: "button button--secondary", type: "button", text: "Copy link" });
      copy.addEventListener("click", async () => {
        try { await copyText(shareUrl); showToast("Participant link copied", "success"); }
        catch (error) { showToast(errorMessage(error), "error"); }
      });
      return copy;
    })(),
  ]);

  const ticketSidebar = el("aside", { className: "panel facilitator-sidebar" }, [
    el("div", { className: "section-heading section-heading--compact" }, [el("div", {}, [el("h2", { text: "Tickets" }), el("p", { className: "muted", text: model.tickets.length ? "Select a ticket to start." : "Add the first ticket." })])]),
    model.tickets.length ? renderTicketList(model, currentTicket, completed, activateTicket) : el("div", { className: "empty-state empty-state--compact", text: "No tickets yet." }),
  ]);

  const focus = el("section", { className: "panel facilitator-focus" });
  if (!currentTicket) {
    focus.append(el("div", { className: "empty-state empty-state--compact" }, [
      el("h2", { text: completed ? "Session completed" : "No active ticket" }),
      el("p", { text: completed ? "The session is read-only. Previously saved estimates remain visible in the ticket list." : model.tickets.length ? "Select a ticket from the list to start the voting round." : "Add a ticket below." }),
    ]));
  } else {
    const jiraUrl = safeJiraUrl(model.team?.jiraBaseUrl || session.team?.jiraBaseUrl, currentTicket.jiraIssueKey);
    const keyNode = jiraUrl
      ? el("a", { className: "ticket-key", href: jiraUrl.toString(), target: "_blank", rel: "noopener noreferrer", text: currentTicket.jiraIssueKey || "Ticket" })
      : el("span", { className: "ticket-key", text: currentTicket.jiraIssueKey || "Ticket" });
    focus.append(
      el("div", { className: "ticket-heading" }, [el("div", {}, [keyNode, el("h2", { text: currentTicket.summary || "No title" })]), statusBadge(currentTicket.status)]),
      currentTicket.projectName
        ? el("p", { className: "muted", text: `Project: ${currentTicket.projectName} (${currentTicket.projectKey || ""})` })
        : null,
      currentTicket.description ? el("p", { className: "ticket-description", text: currentTicket.description }) : el("p", { className: "muted", text: "No description." }),
      el("div", { className: "round-strip" }, [
        el("span", { text: `Round ${roundNumber}` }),
        el("strong", { text: `${currentVotes.length} of ${activeMembers.length} votes` }),
      ]),
      participantList(model, currentVotes, Boolean(revealed)),
    );
    if (revealed) {
      const result = statsGrid(currentVotes, model.statistics, currentTicket.finalEstimateHours);
      focus.append(el("div", { className: "results-block" }, [el("h3", { text: "Results" }), result.grid]));

      if (currentTicket.status !== "estimated" && !completed) {
        const estimateInput = el("input", { id: "final-estimate", type: "number", min: "0", max: "1000", step: "0.01", value: result.stats.median ?? "" });
        const estimateError = el("p", { className: "field-error" });
        const chips = el("div", { className: "estimate-chips", role: "group", "aria-label": "Quick estimate choices" });
        VOTE_VALUES.forEach((value) => {
          const chip = el("button", { className: "chip", type: "button", text: String(value) });
          chip.addEventListener("click", () => { estimateInput.value = value; estimateInput.focus(); });
          chips.append(chip);
        });
        const save = el("button", { className: "button button--primary", type: "button", text: "Save estimate" });
        save.addEventListener("click", async () => {
          estimateError.textContent = "";
          const raw = estimateInput.value.trim();
          const value = Number(raw.replace(",", "."));
          if (!raw) { estimateError.textContent = "Enter a final estimate."; return; }
          if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw) || !Number.isFinite(value) || value < 0 || value > 1000) {
            estimateError.textContent = "Use a value from 0 to 1000 with no more than two decimal places.";
            return;
          }
          setBusy(save, true, "Saving…");
          try {
            const result = await finalizeTicket(
              currentTicket.id,
              value,
              { includeSessionState: true },
            );
            showToast("Final estimate saved", "success");
            await refresh(true, result.sessionState);
          } catch (error) {
            showToast(errorMessage(error), "error");
            setBusy(save, false);
          }
        });
        focus.append(el("div", { className: "estimate-form" }, [
          el("div", { className: "field" }, [el("label", { htmlFor: "final-estimate", text: "Final estimate (hours)" }), estimateInput, estimateError]),
          chips,
          save,
        ]));
      }
    }
  }

  const reveal = el("button", {
    className: "button button--primary",
    type: "button",
    text: `Reveal votes (${currentVotes.length})`,
    disabled: completed || !currentTicket || currentTicket.status !== "voting",
  });
  reveal.addEventListener("click", async () => {
    if (currentVotes.length < activeMembers.length
      && !window.confirm(`${currentVotes.length} of ${activeMembers.length} participants have voted. Reveal anyway?`)) return;
    setBusy(reveal, true, "Revealing…");
    try {
      const result = await revealTicket(
        currentTicket.id,
        roundNumber,
        { includeSessionState: true },
      );
      showToast("Votes revealed", "success");
      await refresh(true, result.sessionState);
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(reveal, false);
    }
  });

  const newRound = el("button", {
    className: "button button--secondary", type: "button", text: "New round",
    disabled: completed || !currentTicket || !["revealed", "estimated"].includes(currentTicket.status),
  });
  newRound.addEventListener("click", async () => {
    if (!window.confirm("Start a new voting round? Votes from the current round will be retained in the history.")) return;
    const nextRound = roundNumber + 1;
    try {
      setStoredValue(roundStorageKey(sessionId, currentTicket.id), nextRound, "sessionStorage");
      const result = await restartTicketVoting(currentTicket.id);
      showToast(`Round ${nextRound} started`, "success");
      await refresh(true, result.sessionState);
    } catch (error) {
      setStoredValue(roundStorageKey(sessionId, currentTicket.id), roundNumber, "sessionStorage");
      showToast(errorMessage(error), "error");
    }
  });

  const next = el("button", {
    className: "button button--secondary", type: "button",
    text: nextTicket ? "Next open ticket" : "All tickets are estimated",
    disabled: completed || !nextTicket,
  });
  next.addEventListener("click", () => activateTicket(nextTicket));

  const finish = el("button", { className: "button button--danger", type: "button", text: "Complete session", disabled: completed });
  finish.addEventListener("click", async () => {
    const warning = openTickets.length
      ? `There are still ${openTickets.length} open tickets. Do you want to complete the session anyway?`
      : "Do you want to complete this session? Voting will no longer be possible afterwards.";
    if (!window.confirm(warning)) return;
    setBusy(finish, true, "Completing…");
    try {
      const result = await completeSession(sessionId);
      showToast("Session completed", "success");
      await refresh(true, result.sessionState);
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(finish, false);
    }
  });

  const actionBar = el("div", { className: "facilitator-actions", role: "group", "aria-label": "Facilitator actions" }, [reveal, newRound, next, finish]);
  const projectPanel = projectManager(model, completed, refresh);
  const ticketFormPanel = el("section", { className: "panel" }, [
    el("div", { className: "section-heading section-heading--compact" }, [el("div", {}, [el("h2", { text: "Add ticket" }), el("p", { className: "muted", text: completed ? "A completed session is read-only." : "Add Jira tickets manually." })])]),
    addTicketForm(model, completed, refresh),
  ]);

  app.replaceChildren(
    heading,
    completed ? el("div", { className: "completion-banner" }, [el("strong", { text: "This session is complete." }), el("span", { text: " Results remain visible; changes are disabled." })]) : sharePanel,
    el("div", { className: "facilitator-layout" }, [ticketSidebar, focus]),
    actionBar,
    projectPanel,
    ticketFormPanel,
  );
}

export async function renderFacilitatorView({
  app,
  route,
  isCurrent = () => true,
  refresh,
  prefetchedSessionState = null,
}) {
  const sessionId = route.params.sessionId;
  document.title = "Facilitate · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API not configured", error: new Error("Set supabaseUrl and supabaseAnonKey in site/js/config.js first.") });
    return;
  }
  if (!app.hasChildNodes()) app.append(el("section", { className: "loading-state", role: "status" }, [el("span", { className: "spinner" }), el("p", { text: "Loading facilitator screen…" })]));
  try {
    const model = normalizeSessionState(prefetchedSessionState || await getSessionState(sessionId));
    if (!isCurrent()) return;
    if (!model) throw new Error("The session was not found or the response is incomplete.");
    const hasAdminMembershipForTeam = (getCurrentUser()?.memberships || []).some((membership) => (
      membership.role === "admin" && String(membership.teamId) === String(model.session?.teamId)
    ));
    if (!model.viewer?.canFacilitate && !hasAdminMembershipForTeam) {
      throw new Error("Your signed-in account does not have facilitator permission for this team.");
    }
    const facilitator = { id: model.viewer.memberId, displayName: model.viewer.displayName };
    setStoredValue(STORAGE_KEYS.lastSessionId, sessionId);
    const currentTicket = getCurrentTicket(model);
    let roundNumber = 1;
    if (currentTicket) {
      const serverRound = Number(model.currentRoundNumber);
      const storedRound = Number(getStoredValue(roundStorageKey(sessionId, currentTicket.id), 1, "sessionStorage"));
      roundNumber = Number.isInteger(serverRound) && serverRound > 0
        ? serverRound
        : Number.isInteger(storedRound) && storedRound > 0 ? storedRound : 1;
      setStoredValue(roundStorageKey(sessionId, currentTicket.id), roundNumber, "sessionStorage");
    }
    renderFacilitator(app, model, facilitator, roundNumber, { sessionId, refresh });
  } catch (error) {
    if (!isCurrent()) return;
    if (app.querySelector(".facilitator-layout")) {
      showToast(`Refresh failed: ${errorMessage(error)}`, "warning");
      return;
    }
    renderErrorView({ app, title: "The facilitator screen could not be loaded", error, retry: () => refresh(false) });
  }
}
