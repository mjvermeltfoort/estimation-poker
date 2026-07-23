import { getAdminState, getAdminTeamSettings, updateAdminTeamSettings } from "../api.js";
import { getCurrentUser } from "../authSession.js";
import { isApiConfigured } from "../config.js";
import { showToast } from "../notifications.js";
import { getStoredValue, setStoredValue, STORAGE_KEYS } from "../storage.js";
import { el, errorMessage, normalizeList, setBusy } from "../utils.js";
import { renderErrorView } from "./errorView.js";

function isAdminMembership(membership) {
  return membership && membership.role === "admin" && membership.active !== false;
}

export async function renderAdminSettingsView({ app, isCurrent = () => true }) {
  document.title = "Admin settings · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API not configured", error: new Error("Set supabaseUrl and supabaseAnonKey in site/js/config.js first.") });
    return;
  }

  const currentUser = getCurrentUser();
  if (!currentUser || !normalizeList(currentUser.memberships).some(isAdminMembership)) {
    app.replaceChildren(el("section", { className: "empty-state" }, [
      el("h1", { text: "Admin access required" }),
      el("p", { text: "Only admins can access settings." }),
      el("a", { className: "button button--secondary", href: "#/", text: "Back" }),
    ]));
    return;
  }

  app.replaceChildren(el("section", { className: "loading-state", role: "status" }, [
    el("span", { className: "spinner" }),
    el("p", { text: "Loading settings…" }),
  ]));

  try {
    const preferredTeamId = getStoredValue(STORAGE_KEYS.selectedTeamId, null);
    const adminState = await getAdminState(preferredTeamId);
    if (!isCurrent()) return;

    const teams = normalizeList(adminState?.teams);
    if (!teams.length) {
      app.replaceChildren(el("section", { className: "empty-state" }, [
        el("h1", { text: "No admin teams found" }),
        el("p", { text: "You do not have admin access to any active team." }),
        el("a", { className: "button button--secondary", href: "#/", text: "Back" }),
      ]));
      return;
    }

    const selectedTeamId = teams.some((team) => String(team.id) === String(adminState?.selectedTeamId))
      ? adminState.selectedTeamId
      : teams[0].id;

    const renderWithTeam = async (teamId) => {
      const settings = await getAdminTeamSettings(teamId);
      if (!isCurrent()) return;
      setStoredValue(STORAGE_KEYS.selectedTeamId, teamId);

      const heading = el("div", { className: "page-heading" }, [
        el("div", {}, [
          el("p", { className: "eyebrow", text: "Administration" }),
          el("h1", { text: "Settings" }),
          el("p", { className: "muted", text: "Manage team-level Jira configuration." }),
        ]),
        el("a", { className: "button button--ghost", href: "#/admin", text: "Back to admin" }),
      ]);

      const teamSelect = el("select", { id: "settings-team", className: "select" });
      teams.forEach((team) => teamSelect.append(el("option", {
        value: team.id,
        text: team.name || team.id,
        selected: String(team.id) === String(teamId),
      })));

      teamSelect.addEventListener("change", () => renderWithTeam(teamSelect.value));

      const picker = el("section", { className: "panel" }, [
        el("div", { className: "team-picker" }, [
          el("label", { htmlFor: "settings-team", text: "Team" }),
          teamSelect,
        ]),
      ]);

      const form = el("form", { className: "panel form-grid", noValidate: true });
      const baseUrl = el("input", {
        id: "jiraBaseUrl",
        value: settings?.team?.jiraBaseUrl || "",
        placeholder: "https://your-domain.atlassian.net",
      });
      const baseUrlError = el("p", { className: "field-error" });
      const submit = el("button", { className: "button button--primary", type: "submit", text: "Save settings" });

      form.append(
        el("div", { className: "field field--wide" }, [
          el("label", { htmlFor: "jiraBaseUrl", text: "Jira base URL *" }),
          baseUrl,
          baseUrlError,
          el("p", { className: "muted", text: "Ticket links use this URL with /browse/{PROJECT}-{NUMBER}." }),
        ]),
        el("div", { className: "field--wide" }, [submit]),
      );

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        baseUrlError.textContent = "";
        const value = baseUrl.value.trim();
        if (!value) {
          baseUrlError.textContent = "Enter a Jira base URL.";
          return;
        }
        try {
          const parsed = new URL(value);
          if (!/^https?:$/.test(parsed.protocol)) {
            baseUrlError.textContent = "Use an http or https URL.";
            return;
          }
        } catch {
          baseUrlError.textContent = "Enter a valid URL.";
          return;
        }

        setBusy(submit, true, "Saving…");
        try {
          await updateAdminTeamSettings({ teamId, jiraBaseUrl: value });
          showToast("Settings saved", "success");
          await renderWithTeam(teamId);
        } catch (error) {
          showToast(errorMessage(error), "error");
          setBusy(submit, false);
        }
      });

      app.replaceChildren(heading, picker, form);
    };

    await renderWithTeam(selectedTeamId);
  } catch (error) {
    if (!isCurrent()) return;
    renderErrorView({ app, title: "The settings page could not be loaded", error, retry: () => renderAdminSettingsView({ app, isCurrent }) });
  }
}
