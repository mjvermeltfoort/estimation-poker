import { getSessionState, submitVote } from "../api.js";
import { isApiConfigured } from "../config.js";
import { showToast } from "../notifications.js";
import { navigateTo } from "../router.js";
import { getStoredValue, removeStoredValue, roundStorageKey, setStoredValue, STORAGE_KEYS } from "../storage.js";
import {
  VOTE_VALUES, calculateStatistics, el, errorMessage, formatHours, normalizeList,
  safeJiraUrl, sortTickets, statusBadge,
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

function currentTicketFor(model) {
  return model.currentTicket
    || model.tickets.find((ticket) => String(ticket.id) === String(model.session.currentTicketId))
    || null;
}

function renderMemberChooser(app, model, sessionId) {
  const activeMembers = model.members.filter(isActiveMember);
  const grid = el("div", { className: "member-grid" });
  activeMembers.forEach((member) => {
    const button = el("button", { className: "member-card", type: "button" }, [
      el("span", { className: "avatar", text: String(member.displayName || "?").slice(0, 1).toUpperCase() }),
      el("strong", { text: member.displayName || member.id }),
      el("span", { className: "muted", text: member.role || "member" }),
    ]);
    button.addEventListener("click", () => {
      setStoredValue(STORAGE_KEYS.selectedMemberId, member.id);
      setStoredValue(STORAGE_KEYS.lastSessionId, sessionId);
      navigateTo(`/session/${encodeURIComponent(sessionId)}?member=${encodeURIComponent(member.id)}`);
    });
    grid.append(button);
  });

  app.replaceChildren(el("section", { className: "member-choice" }, [
    el("p", { className: "eyebrow", text: "Deelnemen" }),
    el("h1", { text: model.session.name || "Estimation-sessie" }),
    el("p", { className: "lead", text: "Wie bent u? Deze keuze is alleen voor herkenning en is geen authenticatie." }),
    activeMembers.length
      ? grid
      : el("div", { className: "empty-state empty-state--compact" }, [el("h2", { text: "Geen actieve teamleden" }), el("p", { text: "Vraag de facilitator om de teamconfiguratie te controleren." })]),
    el("a", { className: "button button--ghost", href: "#/", text: "Terug naar start" }),
  ]));
}

function renderParticipantStatus(model, currentVotes, revealed) {
  const list = el("ul", { className: "participant-list" });
  model.members.filter(isActiveMember).forEach((member) => {
    const vote = currentVotes.find((item) => String(item.teamMemberId) === String(member.id));
    const detail = revealed && vote
      ? formatHours(vote.estimateHours)
      : vote ? "Gestemd" : "Nog niet gestemd";
    list.append(el("li", { className: "participant" }, [
      el("span", { className: "avatar avatar--small", text: String(member.displayName || "?").slice(0, 1).toUpperCase() }),
      el("span", { className: "participant__name", text: member.displayName || member.id }),
      el("span", { className: `vote-state ${vote ? "vote-state--done" : ""}`, text: detail }),
    ]));
  });
  return list;
}

function renderStatistics(votes, suppliedStatistics, finalEstimateHours) {
  const stats = suppliedStatistics || calculateStatistics(votes);
  const grid = el("dl", { className: "stats-grid" });
  [
    ["Stemmen", stats.count],
    ["Gemiddelde", formatHours(stats.average)],
    ["Mediaan", formatHours(stats.median)],
    ["Minimum", formatHours(stats.min)],
    ["Maximum", formatHours(stats.max)],
  ].forEach(([label, value]) => grid.append(el("div", {}, [el("dt", { text: label }), el("dd", { text: String(value ?? "—") })])));
  if (finalEstimateHours !== undefined && finalEstimateHours !== null && finalEstimateHours !== "") {
    grid.append(el("div", { className: "stat-final" }, [el("dt", { text: "Definitief" }), el("dd", { text: formatHours(finalEstimateHours) })]));
  }
  return grid;
}

function renderSession(app, model, selectedMember, roundNumber, context) {
  const { sessionId, refresh } = context;
  const ticket = currentTicketFor(model);
  const tickets = sortTickets(model.tickets);
  const ticketIndex = ticket ? tickets.findIndex((item) => String(item.id) === String(ticket.id)) : -1;
  const currentVotes = ticket
    ? model.votes.filter((vote) => String(vote.ticketId) === String(ticket.id) && Number(vote.roundNumber || 1) === Number(roundNumber))
    : [];
  const revealed = ticket && ["revealed", "estimated"].includes(ticket.status);
  const canVote = ticket && ["pending", "voting"].includes(ticket.status) && model.session.status !== "completed";
  const ownVote = currentVotes.find((vote) => String(vote.teamMemberId) === String(selectedMember.id));

  const heading = el("div", { className: "page-heading" }, [
    el("div", {}, [
      el("p", { className: "eyebrow", text: `Deelnemer · ${selectedMember.displayName || selectedMember.id}` }),
      el("h1", { text: model.session.name || "Estimation-sessie" }),
      el("div", { className: "meta-row" }, [statusBadge(model.session.status), el("span", { text: ticketIndex >= 0 ? `${ticketIndex + 1} van ${tickets.length}` : `${tickets.length} tickets` })]),
    ]),
    el("div", { className: "button-row" }, [
      el("a", { className: "button button--ghost", href: "#/", text: "Startpagina" }),
      (() => {
        const change = el("button", { className: "button button--secondary", type: "button", text: "Ander teamlid" });
        change.addEventListener("click", () => {
          removeStoredValue(STORAGE_KEYS.selectedMemberId);
          navigateTo(`/session/${encodeURIComponent(sessionId)}`);
        });
        return change;
      })(),
    ]),
  ]);

  const ticketPanel = el("section", { className: "panel ticket-focus" });
  if (!ticket) {
    ticketPanel.append(el("div", { className: "empty-state empty-state--compact" }, [
      el("h2", { text: model.session.status === "completed" ? "Deze sessie is afgerond" : "Wachten op een ticket" }),
      el("p", { text: model.session.status === "completed" ? "De definitieve schattingen staan hieronder." : "De facilitator selecteert het volgende ticket." }),
    ]));
    if (model.session.status === "completed" && tickets.length) {
      const results = el("div", { className: "completed-ticket-list" });
      tickets.forEach((completedTicket) => {
        results.append(el("div", { className: "completed-ticket" }, [
          el("div", {}, [
            el("strong", { text: completedTicket.jiraIssueKey || "Ticket" }),
            el("span", { text: completedTicket.summary || "Geen titel" }),
          ]),
          el("span", {
            className: "completed-ticket__estimate",
            text: completedTicket.finalEstimateHours !== undefined && completedTicket.finalEstimateHours !== null && completedTicket.finalEstimateHours !== ""
              ? formatHours(completedTicket.finalEstimateHours)
              : "Niet geschat",
          }),
        ]));
      });
      ticketPanel.append(results);
    }
  } else {
    const jiraUrl = safeJiraUrl(model.team?.jiraBaseUrl || model.session.team?.jiraBaseUrl, ticket.jiraIssueKey);
    const key = jiraUrl
      ? el("a", { className: "ticket-key", href: jiraUrl.toString(), target: "_blank", rel: "noopener noreferrer", text: ticket.jiraIssueKey || "Ticket" })
      : el("span", { className: "ticket-key", text: ticket.jiraIssueKey || "Ticket" });
    ticketPanel.append(
      el("div", { className: "ticket-heading" }, [el("div", {}, [key, el("h2", { text: ticket.summary || "Geen titel" })]), statusBadge(ticket.status)]),
      ticket.description ? el("p", { className: "ticket-description", text: ticket.description }) : el("p", { className: "muted", text: "Geen omschrijving." }),
    );

    if (canVote) {
      const voteIntro = el("div", { className: "section-heading section-heading--compact" }, [
        el("div", {}, [el("h3", { text: ownVote ? "Uw schatting wijzigen" : "Kies uw schatting" }), el("p", { className: "muted", text: `Ronde ${roundNumber} · uren` })]),
        ownVote ? el("span", { className: "saved-indicator", text: "Stem opgeslagen" }) : null,
      ]);
      const cardGrid = el("div", { className: "vote-cards", role: "group", "aria-label": "Kies een schatting in uren" });
      const buttons = [];
      [...VOTE_VALUES, "?"].forEach((value) => {
        const selected = value !== "?" && Number(ownVote?.estimateHours) === Number(value);
        const button = el("button", {
          className: `vote-card${selected ? " vote-card--selected" : ""}`,
          type: "button",
          text: String(value),
          "aria-pressed": selected ? "true" : "false",
          "aria-label": value === "?" ? "Ticket moet worden verduidelijkt" : `${value} uur`,
        });
        button.addEventListener("click", async () => {
          if (value === "?") {
            button.classList.add("vote-card--question");
            button.setAttribute("aria-pressed", "true");
            showToast("Vraag om verduidelijking en kies daarna een numerieke waarde.", "warning");
            window.setTimeout(() => { button.classList.remove("vote-card--question"); button.setAttribute("aria-pressed", "false"); }, 1600);
            return;
          }
          buttons.forEach((item) => { item.disabled = true; });
          button.classList.add("vote-card--selected");
          try {
            await submitVote({
              sessionId,
              ticketId: ticket.id,
              teamMemberId: selectedMember.id,
              roundNumber,
              estimateHours: value,
            });
            showToast("Stem opgeslagen", "success");
            await refresh(true);
          } catch (error) {
            showToast(errorMessage(error), "error");
            buttons.forEach((item) => { item.disabled = false; });
          }
        });
        buttons.push(button);
        cardGrid.append(button);
      });
      ticketPanel.append(voteIntro, cardGrid);
    } else if (!revealed) {
      ticketPanel.append(el("div", { className: "inline-info", text: model.session.status === "completed" ? "Deze sessie is afgerond; stemmen is gesloten." : "Stemmen is op dit moment gesloten." }));
    }

    if (revealed) {
      ticketPanel.append(
        el("div", { className: "section-heading section-heading--compact" }, [el("div", {}, [el("h3", { text: "Resultaten" }), el("p", { className: "muted", text: `Ronde ${roundNumber}` })])]),
        renderStatistics(currentVotes, model.statistics, ticket.finalEstimateHours),
      );
    }
  }

  const participantPanel = el("aside", { className: "panel" }, [
    el("div", { className: "section-heading section-heading--compact" }, [
      el("div", {}, [el("h2", { text: "Deelnemers" }), el("p", { className: "muted", text: ticket ? `${currentVotes.length} van ${model.members.filter(isActiveMember).length} gestemd` : "Nog geen actief ticket" })]),
      el("span", { className: "refresh-indicator", id: "refresh-status", "aria-live": "polite" }),
    ]),
    renderParticipantStatus(model, currentVotes, Boolean(revealed)),
  ]);

  app.replaceChildren(heading, el("div", { className: "session-layout" }, [ticketPanel, participantPanel]));
}

export async function renderSessionView({ app, route, isCurrent = () => true, refresh }) {
  const sessionId = route.params.sessionId;
  document.title = "Sessie · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API nog niet geconfigureerd", error: new Error("Vul eerst apiUrl in site/js/config.js in.") });
    return;
  }
  if (!app.hasChildNodes()) app.append(el("section", { className: "loading-state", role: "status" }, [el("span", { className: "spinner" }), el("p", { text: "Sessie laden…" })]));
  try {
    const model = normalizeSessionState(await getSessionState(sessionId));
    if (!isCurrent()) return;
    if (!model) throw new Error("De sessie is niet gevonden of de response is onvolledig.");
    const activeMembers = model.members.filter(isActiveMember);
    const requestedId = route.query.get("member");
    const storedId = getStoredValue(STORAGE_KEYS.selectedMemberId, null);
    const selectedId = requestedId || storedId;
    const selectedMember = activeMembers.find((member) => String(member.id) === String(selectedId));
    if (!selectedMember) {
      if (storedId) removeStoredValue(STORAGE_KEYS.selectedMemberId);
      renderMemberChooser(app, model, sessionId);
      return;
    }
    setStoredValue(STORAGE_KEYS.selectedMemberId, selectedMember.id);
    setStoredValue(STORAGE_KEYS.lastSessionId, sessionId);
    const ticket = currentTicketFor(model);
    const roundNumber = ticket
      ? Number(getStoredValue(roundStorageKey(sessionId, ticket.id), model.currentRoundNumber || 1, "sessionStorage")) || 1
      : 1;
    renderSession(app, model, selectedMember, roundNumber, { sessionId, refresh });
  } catch (error) {
    if (!isCurrent()) return;
    if (app.querySelector(".session-layout")) {
      showToast(`Bijwerken mislukt: ${errorMessage(error)}`, "warning");
      return;
    }
    renderErrorView({ app, title: "Sessie kon niet worden geladen", error, retry: () => refresh(false) });
  }
}
