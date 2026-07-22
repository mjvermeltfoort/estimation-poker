import { getHealth, list } from "../api.js";
import { isApiConfigured } from "../config.js";
import { state, setState } from "../state.js";
import { getStoredValue, setStoredValue, STORAGE_KEYS } from "../storage.js";
import { el, formatDate, normalizeList, statusBadge } from "../utils.js";
import { renderErrorView } from "./errorView.js";

const SESSION_ORDER = { active: 0, draft: 1, completed: 2, cancelled: 3 };

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const statusDifference = (SESSION_ORDER[a.status] ?? 99) - (SESSION_ORDER[b.status] ?? 99);
    if (statusDifference) return statusDifference;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function renderSessionCard(session) {
  const metadata = el("div", { className: "session-card__meta" }, [
    statusBadge(session.status),
    el("span", { text: `Aangemaakt ${formatDate(session.createdAt)}` }),
  ]);
  if (session.ticketCount !== undefined && session.ticketCount !== null) {
    metadata.append(el("span", { text: `${session.ticketCount} ticket${Number(session.ticketCount) === 1 ? "" : "s"}` }));
  }
  return el("article", { className: "session-card" }, [
    el("div", {}, [
      el("h3", { text: session.name || "Naamloze sessie" }),
      metadata,
    ]),
    el("div", { className: "button-row session-card__actions" }, [
      el("a", { className: "button button--primary", href: `#/session/${encodeURIComponent(session.id)}`, text: "Deelnemen" }),
      el("a", { className: "button button--secondary", href: `#/facilitate/${encodeURIComponent(session.id)}`, text: "Faciliteren" }),
    ]),
  ]);
}

function renderHome(app) {
  const selectedTeam = state.teams.find((team) => String(team.id) === String(state.selectedTeamId));
  const header = el("div", { className: "hero" }, [
    el("div", {}, [
      el("p", { className: "eyebrow", text: "Samen schatten, helder beslissen" }),
      el("h1", { text: "Estimation Poker" }),
      el("p", { className: "lead", text: "Schat werk onafhankelijk in uren, bespreek verschillen en leg samen een definitieve inschatting vast." }),
    ]),
    el("div", { className: "api-status" }, [
      el("span", { className: `status-dot status-dot--${state.apiStatus}` }),
      el("span", { text: state.apiStatus === "online" ? "API bereikbaar" : "API-status onbekend" }),
    ]),
  ]);

  const content = el("section", { className: "panel" });
  if (!state.teams.length) {
    content.append(el("div", { className: "empty-state empty-state--compact" }, [
      el("h2", { text: "Nog geen teams" }),
      el("p", { text: "Voeg eerst een actief team toe aan de gekoppelde Google Sheet." }),
    ]));
    app.replaceChildren(header, content);
    return;
  }

  const teamSelect = el("select", { id: "team-select", className: "select" });
  state.teams.forEach((team) => teamSelect.append(el("option", {
    value: team.id,
    text: team.name || team.id,
    selected: String(team.id) === String(state.selectedTeamId),
  })));
  teamSelect.addEventListener("change", async () => {
    setState({ selectedTeamId: teamSelect.value, sessions: [], initialLoading: true });
    setStoredValue(STORAGE_KEYS.selectedTeamId, teamSelect.value);
    renderLoading(app, "Sessies laden…");
    try {
      const sessions = normalizeList(await list("estimationSessions", { teamId: teamSelect.value }));
      setState({ sessions, initialLoading: false, error: null });
      renderHome(app);
    } catch (error) {
      setState({ initialLoading: false, error });
      renderErrorView({ app, title: "Sessies konden niet worden geladen", error, retry: () => renderHomeView({ app }) });
    }
  });

  content.append(el("div", { className: "section-heading" }, [
    el("div", {}, [
      el("h2", { text: "Sessies" }),
      el("p", { className: "muted", text: selectedTeam ? `Team ${selectedTeam.name}` : "Kies een team" }),
    ]),
    el("div", { className: "team-picker" }, [
      el("label", { htmlFor: "team-select", text: "Team" }),
      teamSelect,
      el("a", { className: "button button--primary", href: "#/sessions/new", text: "Nieuwe sessie" }),
    ]),
  ]));

  if (!state.sessions.length) {
    content.append(el("div", { className: "empty-state empty-state--compact" }, [
      el("h3", { text: "Geen sessies voor dit team" }),
      el("p", { text: "Maak een eerste sessie aan om tickets te schatten." }),
      el("a", { className: "button button--primary", href: "#/sessions/new", text: "Nieuwe sessie" }),
    ]));
  } else {
    content.append(el("div", { className: "session-list" }, sortSessions(state.sessions).map(renderSessionCard)));
  }
  app.replaceChildren(header, content);
}

function renderLoading(app, label = "Teams en sessies laden…") {
  app.replaceChildren(el("section", { className: "loading-state", role: "status" }, [
    el("span", { className: "spinner", "aria-hidden": "true" }),
    el("p", { text: label }),
  ]));
}

export async function renderHomeView({ app, isCurrent = () => true }) {
  document.title = "Estimation Poker";
  if (!isApiConfigured()) {
    setState({ apiStatus: "unconfigured", teams: [], sessions: [] });
    app.replaceChildren(
      el("section", { className: "hero" }, [
        el("p", { className: "eyebrow", text: "Configuratie nodig" }),
        el("h1", { text: "Estimation Poker" }),
        el("p", { className: "lead", text: "De interface is gereed. Vul de Google Apps Script /exec-URL in om teams en sessies te laden." }),
      ]),
      el("section", { className: "empty-state" }, [
        el("h2", { text: "Nog niet verbonden" }),
        el("p", { text: "Pas apiUrl aan in site/js/config.js. Tot die tijd worden bewust geen netwerkverzoeken uitgevoerd." }),
      ]),
    );
    return;
  }

  setState({ initialLoading: true, error: null });
  renderLoading(app);
  try {
    const [health, teamData] = await Promise.all([getHealth(), list("teams")]);
    if (!isCurrent()) return;
    const allTeams = normalizeList(teamData);
    const activeTeams = allTeams.filter((team) => team.active !== false && String(team.active).toLowerCase() !== "false");
    const teams = activeTeams.length ? activeTeams : allTeams;
    const storedTeamId = getStoredValue(STORAGE_KEYS.selectedTeamId, null);
    const selectedTeamId = teams.some((team) => String(team.id) === String(storedTeamId))
      ? storedTeamId
      : teams[0]?.id || null;
    const sessions = selectedTeamId
      ? normalizeList(await list("estimationSessions", { teamId: selectedTeamId }))
      : [];
    if (!isCurrent()) return;
    setState({ apiStatus: health === false ? "offline" : "online", teams, selectedTeamId, sessions, initialLoading: false });
    if (selectedTeamId) setStoredValue(STORAGE_KEYS.selectedTeamId, selectedTeamId);
    renderHome(app);
  } catch (error) {
    if (!isCurrent()) return;
    setState({ apiStatus: "offline", initialLoading: false, error });
    renderErrorView({ app, title: "De API is niet bereikbaar", error, retry: () => renderHomeView({ app, isCurrent }) });
  }
}
