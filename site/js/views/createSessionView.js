import { create, list } from "../api.js";
import { getCurrentUser } from "../authSession.js";
import { isApiConfigured } from "../config.js";
import { navigateTo } from "../router.js";
import { setStoredValue, STORAGE_KEYS } from "../storage.js";
import { el, errorMessage, normalizeList, setBusy } from "../utils.js";
import { showToast } from "../notifications.js";
import { renderErrorView } from "./errorView.js";

function isActive(record) {
  return record.active !== false && String(record.active).toLowerCase() !== "false";
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
    const facilitatorMemberships = (currentUser?.memberships || []).filter((membership) => membership.role === "facilitator");
    const facilitatorTeamIds = new Set(facilitatorMemberships.map((membership) => String(membership.teamId)));
    const teams = normalizeList(await list("teams"))
      .filter(isActive)
      .filter((team) => facilitatorTeamIds.has(String(team.id)));
    if (!isCurrent()) return;
    if (!teams.length) {
      app.replaceChildren(el("section", { className: "empty-state" }, [
        el("h1", { text: "Facilitator access required" }),
        el("p", { text: "Your signed-in account is not registered as a facilitator for an active team." }),
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
    const teamSelect = el("select", { id: "teamId", name: "teamId", required: true });
    teams.forEach((team) => teamSelect.append(el("option", { value: team.id, text: team.name || team.id })));
    const teamError = el("p", { className: "field-error", id: "teamId-error" });
    form.append(el("div", { className: "field" }, [el("label", { htmlFor: "teamId", text: "Team *" }), teamSelect, teamError]));

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
    const jiraKey = addField(form, { id: "jiraIssueKey", label: "Jira key", placeholder: "ABC-123" });
    const summary = addField(form, { id: "summary", label: "Ticket title", placeholder: "Add validation to the customer form" });
    const description = addField(form, { id: "description", label: "Description", multiline: true });
    description.input.closest(".field").classList.add("field--wide");

    const submit = el("button", { className: "button button--primary", type: "submit", text: "Create session" });
    form.append(el("div", { className: "button-row field--wide" }, [submit, el("a", { className: "button button--secondary", href: "#/", text: "Cancel" })]));
    section.append(form);
    app.replaceChildren(section);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      [teamError, name.error, jiraKey.error, summary.error].forEach((node) => { node.textContent = ""; });
      const normalizedKey = jiraKey.input.value.trim().toUpperCase();
      jiraKey.input.value = normalizedKey;
      let valid = true;
      if (!teamSelect.value) { teamError.textContent = "Select a team."; valid = false; }
      if (!name.input.value.trim()) { name.error.textContent = "Enter a session name."; valid = false; }
      if (normalizedKey && !summary.input.value.trim()) { summary.error.textContent = "A title is required when you enter a Jira key."; valid = false; }
      if (!normalizedKey && summary.input.value.trim()) { jiraKey.error.textContent = "A Jira key is required when you add a ticket."; valid = false; }
      if (!valid) return;

      setBusy(submit, true, "Creating…");
      try {
        const sessionData = await create("estimationSessions", {
          teamId: teamSelect.value,
          name: name.input.value.trim(),
          status: "draft",
          currentTicketId: null,
        });
        const session = sessionData?.session || sessionData;
        if (!session?.id) throw new Error("The server did not return a session ID.");
        setStoredValue(STORAGE_KEYS.selectedTeamId, teamSelect.value);
        setStoredValue(STORAGE_KEYS.lastSessionId, session.id);
        if (normalizedKey) {
          try {
            await create("estimationTickets", {
              sessionId: session.id,
              jiraIssueKey: normalizedKey,
              summary: summary.input.value.trim(),
              description: description.input.value.trim(),
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
