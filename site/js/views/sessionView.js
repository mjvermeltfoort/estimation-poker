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
    el("p", { className: "eyebrow", text: "Join" }),
    el("h1", { text: model.session.name || "Estimation session" }),
    el("p", { className: "lead", text: "Who are you? This selection is only for identification and does not provide authentication." }),
    activeMembers.length
      ? grid
      : el("div", { className: "empty-state empty-state--compact" }, [el("h2", { text: "No active team members" }), el("p", { text: "Ask the facilitator to check the team configuration." })]),
    el("a", { className: "button button--ghost", href: "#/", text: "Back to home" }),
  ]));
}

function renderParticipantStatus(model, currentVotes, revealed) {
  const list = el("ul", { className: "participant-list" });
  model.members.filter(isActiveMember).forEach((member) => {
    const vote = currentVotes.find((item) => String(item.teamMemberId) === String(member.id));
    const detail = revealed && vote
      ? formatHours(vote.estimateHours)
      : vote ? "Voted" : "Not voted yet";
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
    ["Votes", stats.count],
    ["Average", formatHours(stats.average)],
    ["Median", formatHours(stats.median)],
    ["Minimum", formatHours(stats.min)],
    ["Maximum", formatHours(stats.max)],
  ].forEach(([label, value]) => grid.append(el("div", {}, [el("dt", { text: label }), el("dd", { text: String(value ?? "—") })])));
  if (finalEstimateHours !== undefined && finalEstimateHours !== null && finalEstimateHours !== "") {
    grid.append(el("div", { className: "stat-final" }, [el("dt", { text: "Final" }), el("dd", { text: formatHours(finalEstimateHours) })]));
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
      el("p", { className: "eyebrow", text: `Participant · ${selectedMember.displayName || selectedMember.id}` }),
      el("h1", { text: model.session.name || "Estimation session" }),
      el("div", { className: "meta-row" }, [statusBadge(model.session.status), el("span", { text: ticketIndex >= 0 ? `${ticketIndex + 1} of ${tickets.length}` : `${tickets.length} tickets` })]),
    ]),
    el("div", { className: "button-row" }, [
      el("a", { className: "button button--ghost", href: "#/", text: "Home" }),
      (() => {
        const change = el("button", { className: "button button--secondary", type: "button", text: "Change team member" });
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
      el("h2", { text: model.session.status === "completed" ? "This session is complete" : "Waiting for a ticket" }),
      el("p", { text: model.session.status === "completed" ? "The final estimates are listed below." : "The facilitator will select the next ticket." }),
    ]));
    if (model.session.status === "completed" && tickets.length) {
      const results = el("div", { className: "completed-ticket-list" });
      tickets.forEach((completedTicket) => {
        results.append(el("div", { className: "completed-ticket" }, [
          el("div", {}, [
            el("strong", { text: completedTicket.jiraIssueKey || "Ticket" }),
            el("span", { text: completedTicket.summary || "No title" }),
          ]),
          el("span", {
            className: "completed-ticket__estimate",
            text: completedTicket.finalEstimateHours !== undefined && completedTicket.finalEstimateHours !== null && completedTicket.finalEstimateHours !== ""
              ? formatHours(completedTicket.finalEstimateHours)
              : "Not estimated",
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
      el("div", { className: "ticket-heading" }, [el("div", {}, [key, el("h2", { text: ticket.summary || "No title" })]), statusBadge(ticket.status)]),
      ticket.description ? el("p", { className: "ticket-description", text: ticket.description }) : el("p", { className: "muted", text: "No description." }),
    );

    if (canVote) {
      const voteIntro = el("div", { className: "section-heading section-heading--compact" }, [
        el("div", {}, [el("h3", { text: ownVote ? "Change your estimate" : "Choose your estimate" }), el("p", { className: "muted", text: `Round ${roundNumber} · hours` })]),
        ownVote ? el("span", { className: "saved-indicator", text: "Vote saved" }) : null,
      ]);
      const cardGrid = el("div", { className: "vote-cards", role: "group", "aria-label": "Choose an estimate in hours" });
      const buttons = [];
      [...VOTE_VALUES, "?"].forEach((value) => {
        const selected = value !== "?" && Number(ownVote?.estimateHours) === Number(value);
        const button = el("button", {
          className: `vote-card${selected ? " vote-card--selected" : ""}`,
          type: "button",
          text: String(value),
          "aria-pressed": selected ? "true" : "false",
          "aria-label": value === "?" ? "Ticket needs clarification" : `${value} ${Number(value) === 1 ? "hour" : "hours"}`,
        });
        button.addEventListener("click", async () => {
          if (value === "?") {
            button.classList.add("vote-card--question");
            button.setAttribute("aria-pressed", "true");
            showToast("Ask for clarification, then choose a numeric value.", "warning");
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
            showToast("Vote saved", "success");
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
      ticketPanel.append(el("div", { className: "inline-info", text: model.session.status === "completed" ? "This session is complete; voting is closed." : "Voting is currently closed." }));
    }

    if (revealed) {
      ticketPanel.append(
        el("div", { className: "section-heading section-heading--compact" }, [el("div", {}, [el("h3", { text: "Results" }), el("p", { className: "muted", text: `Round ${roundNumber}` })])]),
        renderStatistics(currentVotes, model.statistics, ticket.finalEstimateHours),
      );
    }
  }

  const participantPanel = el("aside", { className: "panel" }, [
    el("div", { className: "section-heading section-heading--compact" }, [
      el("div", {}, [el("h2", { text: "Participants" }), el("p", { className: "muted", text: ticket ? `${currentVotes.length} of ${model.members.filter(isActiveMember).length} voted` : "No active ticket yet" })]),
      el("span", { className: "refresh-indicator", id: "refresh-status", "aria-live": "polite" }),
    ]),
    renderParticipantStatus(model, currentVotes, Boolean(revealed)),
  ]);

  app.replaceChildren(heading, el("div", { className: "session-layout" }, [ticketPanel, participantPanel]));
}

export async function renderSessionView({ app, route, isCurrent = () => true, refresh }) {
  const sessionId = route.params.sessionId;
  document.title = "Session · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API not configured", error: new Error("Set apiUrl in site/js/config.js first.") });
    return;
  }
  if (!app.hasChildNodes()) app.append(el("section", { className: "loading-state", role: "status" }, [el("span", { className: "spinner" }), el("p", { text: "Loading session…" })]));
  try {
    const model = normalizeSessionState(await getSessionState(sessionId));
    if (!isCurrent()) return;
    if (!model) throw new Error("The session was not found or the response is incomplete.");
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
    let roundNumber = 1;
    if (ticket) {
      const serverRound = Number(model.currentRoundNumber);
      const storedRound = Number(getStoredValue(roundStorageKey(sessionId, ticket.id), 1, "sessionStorage"));
      roundNumber = Number.isInteger(serverRound) && serverRound > 0
        ? serverRound
        : Number.isInteger(storedRound) && storedRound > 0 ? storedRound : 1;
      setStoredValue(roundStorageKey(sessionId, ticket.id), roundNumber, "sessionStorage");
    }
    renderSession(app, model, selectedMember, roundNumber, { sessionId, refresh });
  } catch (error) {
    if (!isCurrent()) return;
    if (app.querySelector(".session-layout")) {
      showToast(`Refresh failed: ${errorMessage(error)}`, "warning");
      return;
    }
    renderErrorView({ app, title: "The session could not be loaded", error, retry: () => refresh(false) });
  }
}
