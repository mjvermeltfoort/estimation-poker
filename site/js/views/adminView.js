import { adminUpdateTeamMember, adminUpsertTeamMember, getAdminState } from "../api.js";
import { getCurrentUser } from "../authSession.js";
import { isApiConfigured } from "../config.js";
import { showToast } from "../notifications.js";
import { getStoredValue, setStoredValue, STORAGE_KEYS } from "../storage.js";
import { el, errorMessage, normalizeList, setBusy } from "../utils.js";
import { renderErrorView } from "./errorView.js";

const DEFAULT_ROLES = ["participant", "facilitator", "admin"];

function isAdminMembership(membership) {
  return membership && membership.role === "admin" && membership.active !== false;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function roleOptions(availableRoles = []) {
  const normalized = normalizeList(availableRoles).map(normalizeRole).filter(Boolean);
  const unique = Array.from(new Set([...DEFAULT_ROLES, ...normalized]));
  return unique;
}

function buildRoleSelect(value, roles, disabled = false) {
  const select = el("select", { disabled, "aria-label": "Member role" });
  roles.forEach((role) => {
    select.append(el("option", {
      value: role,
      text: role.charAt(0).toUpperCase() + role.slice(1),
      selected: normalizeRole(value) === role,
    }));
  });
  return select;
}

function memberRow(member, roles, onRoleChange, onActiveToggle) {
  const roleSelect = buildRoleSelect(member.role, roles, false);
  const saveRole = el("button", { className: "button button--secondary", type: "button", text: "Save role" });
  saveRole.addEventListener("click", () => onRoleChange(member, roleSelect, saveRole));

  const activeToggle = el("button", {
    className: member.active === false ? "button button--secondary" : "button button--danger",
    type: "button",
    text: member.active === false ? "Activate" : "Deactivate",
  });
  activeToggle.addEventListener("click", () => onActiveToggle(member, activeToggle));

  return el("tr", {}, [
    el("td", { text: member.displayName || "-" }),
    el("td", { text: member.email || "-" }),
    el("td", {}, [roleSelect]),
    el("td", { text: member.active === false ? "Inactive" : "Active" }),
    el("td", {}, [el("div", { className: "button-row" }, [saveRole, activeToggle])]),
  ]);
}

function renderTeamMembersSection(adminState, teamId, refresh) {
  const members = normalizeList(adminState?.members);
  const roles = roleOptions(adminState?.availableRoles);
  const currentTeam = normalizeList(adminState?.teams).find((team) => String(team.id) === String(teamId));

  const heading = el("div", { className: "section-heading section-heading--compact" }, [
    el("div", {}, [
      el("h2", { text: "Team members" }),
      el("p", {
        className: "muted",
        text: currentTeam ? `Manage users for ${currentTeam.name || currentTeam.id}` : "Select a team.",
      }),
    ]),
  ]);

  const table = el("table", { className: "admin-table" });
  table.append(
    el("thead", {}, [el("tr", {}, [
      el("th", { text: "Name" }),
      el("th", { text: "Email" }),
      el("th", { text: "Role" }),
      el("th", { text: "Status" }),
      el("th", { text: "Actions" }),
    ])]),
  );

  const body = el("tbody");
  const onRoleChange = async (member, roleSelect, button) => {
    const nextRole = normalizeRole(roleSelect.value);
    if (!nextRole || nextRole === normalizeRole(member.role)) {
      showToast("No role change to save", "warning");
      return;
    }
    setBusy(button, true, "Saving…");
    try {
      await adminUpdateTeamMember({ teamMemberId: member.id, role: nextRole });
      showToast("Role updated", "success");
      await refresh();
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(button, false);
    }
  };

  const onActiveToggle = async (member, button) => {
    const nextActive = member.active === false;
    setBusy(button, true, nextActive ? "Activating…" : "Deactivating…");
    try {
      await adminUpdateTeamMember({ teamMemberId: member.id, active: nextActive });
      showToast(nextActive ? "User activated" : "User deactivated", "success");
      await refresh();
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(button, false);
    }
  };

  members.forEach((member) => {
    body.append(memberRow(member, roles, onRoleChange, onActiveToggle));
  });

  if (!members.length) {
    body.append(el("tr", {}, [
      el("td", { colSpan: 5, text: "No team members yet." }),
    ]));
  }

  table.append(body);

  const addForm = el("form", { className: "panel form-grid", noValidate: true });
  const nameInput = el("input", { id: "admin-display-name", placeholder: "Name (optional)" });
  const emailInput = el("input", { id: "admin-email", placeholder: "Email", type: "email", required: true });
  const roleSelect = buildRoleSelect("participant", roles, false);
  roleSelect.id = "admin-role";
  const submit = el("button", { className: "button button--primary", type: "submit", text: "Add user" });
  const emailError = el("p", { className: "field-error" });

  addForm.append(
    el("div", { className: "field" }, [el("label", { htmlFor: "admin-display-name", text: "Display name" }), nameInput]),
    el("div", { className: "field" }, [el("label", { htmlFor: "admin-email", text: "Email *" }), emailInput, emailError]),
    el("div", { className: "field" }, [el("label", { htmlFor: "admin-role", text: "Role" }), roleSelect]),
    el("div", { className: "field" }, [el("label", { text: "Status" }), el("p", { className: "readonly-value", text: "Active" })]),
    el("div", { className: "field--wide" }, [submit]),
  );

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    emailError.textContent = "";
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      emailError.textContent = "Enter a valid email address.";
      return;
    }
    setBusy(submit, true, "Saving…");
    try {
      await adminUpsertTeamMember({
        teamId,
        email,
        displayName: nameInput.value.trim(),
        role: normalizeRole(roleSelect.value) || "participant",
        active: true,
      });
      showToast("User saved", "success");
      await refresh();
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(submit, false);
    }
  });

  return el("section", { className: "admin-page" }, [
    heading,
    el("div", { className: "panel admin-table-wrap" }, [table]),
    el("div", { className: "form-divider" }, [
      el("h2", { text: "Add or update user" }),
      el("p", { className: "muted", text: "Adding an email that already exists in this team updates its role and reactivates the user." }),
    ]),
    addForm,
  ]);
}

export async function renderAdminView({ app, isCurrent = () => true }) {
  document.title = "Admin · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API not configured", error: new Error("Set supabaseUrl and supabaseAnonKey in site/js/config.js first.") });
    return;
  }

  const currentUser = getCurrentUser();
  if (!currentUser || !normalizeList(currentUser.memberships).some(isAdminMembership)) {
    app.replaceChildren(el("section", { className: "empty-state" }, [
      el("h1", { text: "Admin access required" }),
      el("p", { text: "Your signed-in account is not registered as an admin for an active team." }),
      el("a", { className: "button button--secondary", href: "#/", text: "Back" }),
    ]));
    return;
  }

  app.replaceChildren(el("section", { className: "loading-state", role: "status" }, [
    el("span", { className: "spinner" }),
    el("p", { text: "Loading admin panel…" }),
  ]));

  try {
    const preferredTeamId = getStoredValue(STORAGE_KEYS.selectedTeamId, null);
    const adminState = await getAdminState(preferredTeamId);
    if (!isCurrent()) return;

    const teams = normalizeList(adminState?.teams);
    if (!teams.length) {
      app.replaceChildren(el("section", { className: "empty-state" }, [
        el("h1", { text: "No admin teams found" }),
        el("p", { text: "You are signed in, but no active team grants you admin access." }),
        el("a", { className: "button button--secondary", href: "#/", text: "Back" }),
      ]));
      return;
    }

    const selectedTeamId = teams.some((team) => String(team.id) === String(adminState?.selectedTeamId))
      ? adminState.selectedTeamId
      : teams[0].id;
    setStoredValue(STORAGE_KEYS.selectedTeamId, selectedTeamId);

    const heading = el("div", { className: "page-heading" }, [
      el("div", {}, [
        el("p", { className: "eyebrow", text: "Administration" }),
        el("h1", { text: "Users and roles" }),
        el("p", { className: "muted", text: "Add users, assign roles, and control team access." }),
      ]),
      el("a", { className: "button button--ghost", href: "#/", text: "Back to sessions" }),
    ]);

    const teamSelect = el("select", { id: "admin-team", className: "select" });
    teams.forEach((team) => teamSelect.append(el("option", {
      value: team.id,
      text: team.name || team.id,
      selected: String(team.id) === String(selectedTeamId),
    })));

    const teamPicker = el("section", { className: "panel" }, [
      el("div", { className: "team-picker" }, [
        el("label", { htmlFor: "admin-team", text: "Team" }),
        teamSelect,
      ]),
    ]);

    const refresh = async () => {
      const next = await getAdminState(teamSelect.value || selectedTeamId);
      if (!isCurrent()) return;
      setStoredValue(STORAGE_KEYS.selectedTeamId, teamSelect.value || selectedTeamId);
      app.replaceChildren(
        heading,
        teamPicker,
        renderTeamMembersSection(next, teamSelect.value || selectedTeamId, refresh),
      );
      const syncedSelect = app.querySelector("#admin-team");
      if (syncedSelect) {
        syncedSelect.value = String(teamSelect.value || selectedTeamId);
      }
    };

    teamSelect.addEventListener("change", refresh);

    app.replaceChildren(
      heading,
      teamPicker,
      renderTeamMembersSection(adminState, selectedTeamId, refresh),
    );
  } catch (error) {
    if (!isCurrent()) return;
    renderErrorView({ app, title: "The admin panel could not be loaded", error, retry: () => renderAdminView({ app, isCurrent }) });
  }
}
