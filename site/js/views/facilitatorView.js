import { create, finalizeTicket, getSessionState, revealTicket, update } from "../api.js";
import { isApiConfigured } from "../config.js";
import { showToast } from "../notifications.js";
import { navigateTo } from "../router.js";
import { getStoredValue, removeStoredValue, roundStorageKey, setStoredValue, STORAGE_KEYS } from "../storage.js";
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

function chooseFacilitator(app, model, sessionId) {
  const activeMembers = model.members.filter(isActiveMember);
  const facilitators = activeMembers.filter((member) => member.role === "facilitator");
  const choices = facilitators.length ? facilitators : activeMembers;
  const chooser = el("section", { className: "member-choice" }, [
    el("p", { className: "eyebrow", text: "Faciliteren" }),
    el("h1", { text: model.session.name || "Estimation-sessie" }),
    el("p", { className: "lead", text: "Kies wie deze sessie begeleidt. Dit is herkenning, geen veilige autorisatie." }),
  ]);
  if (!facilitators.length && activeMembers.length) {
    chooser.append(el("p", { className: "inline-warning", text: "Geen actief teamlid heeft de facilitatorrol. Voor deze MVP kan ieder actief teamlid worden gekozen." }));
  }
  const grid = el("div", { className: "member-grid" });
  choices.forEach((member) => {
    const button = el("button", { className: "member-card", type: "button" }, [
      el("span", { className: "avatar", text: String(member.displayName || "?").slice(0, 1).toUpperCase() }),
      el("strong", { text: member.displayName || member.id }),
      el("span", { className: "muted", text: member.role || "member" }),
    ]);
    button.addEventListener("click", () => {
      setStoredValue(STORAGE_KEYS.facilitatorMemberId, member.id);
      setStoredValue(STORAGE_KEYS.lastSessionId, sessionId);
      navigateTo(`/facilitate/${encodeURIComponent(sessionId)}`);
    });
    grid.append(button);
  });
  chooser.append(choices.length ? grid : el("div", { className: "empty-state empty-state--compact" }, [el("h2", { text: "Geen actieve teamleden" }), el("p", { text: "Voeg eerst een actief teamlid toe." })]));
  chooser.append(el("a", { className: "button button--ghost", href: "#/", text: "Terug naar start" }));
  app.replaceChildren(chooser);
}

function participantList(model, currentVotes, revealed) {
  const list = el("ul", { className: "participant-list" });
  model.members.filter(isActiveMember).forEach((member) => {
    const vote = currentVotes.find((item) => String(item.teamMemberId) === String(member.id));
    list.append(el("li", { className: "participant" }, [
      el("span", { className: "avatar avatar--small", text: String(member.displayName || "?").slice(0, 1).toUpperCase() }),
      el("span", { className: "participant__name", text: member.displayName || member.id }),
      el("span", { className: `vote-state ${vote ? "vote-state--done" : ""}`, text: revealed && vote ? formatHours(vote.estimateHours) : vote ? "Gestemd" : "Nog niet gestemd" }),
    ]));
  });
  return list;
}

function statsGrid(votes, suppliedStatistics, finalEstimateHours) {
  const stats = suppliedStatistics || calculateStatistics(votes);
  const grid = el("dl", { className: "stats-grid" });
  [
    ["Stemmen", stats.count], ["Gemiddelde", formatHours(stats.average)], ["Mediaan", formatHours(stats.median)],
    ["Minimum", formatHours(stats.min)], ["Maximum", formatHours(stats.max)],
  ].forEach(([label, value]) => grid.append(el("div", {}, [el("dt", { text: label }), el("dd", { text: String(value ?? "—") })])));
  if (finalEstimateHours !== undefined && finalEstimateHours !== null && finalEstimateHours !== "") {
    grid.append(el("div", { className: "stat-final" }, [el("dt", { text: "Definitief" }), el("dd", { text: formatHours(finalEstimateHours) })]));
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
  if (!copied) throw new Error("Kopiëren wordt niet ondersteund door deze browser.");
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
            ? `${ticket.summary || "Geen titel"} · ${formatHours(ticket.finalEstimateHours)}`
            : ticket.summary || "Geen titel",
        }),
      ]),
      statusBadge(ticket.status),
    ]);
    button.addEventListener("click", () => activateTicket(ticket));
    list.append(button);
  });
  return list;
}

function addTicketForm(model, completed, refresh) {
  const form = el("form", { className: "compact-form", noValidate: true });
  const key = el("input", { id: "new-jira-key", placeholder: "ABC-123", disabled: completed });
  const summary = el("input", { id: "new-ticket-summary", placeholder: "Tickettitel", disabled: completed });
  const description = el("textarea", { id: "new-ticket-description", placeholder: "Omschrijving (optioneel)", rows: 3, disabled: completed });
  const keyError = el("p", { className: "field-error" });
  const summaryError = el("p", { className: "field-error" });
  const submit = el("button", { className: "button button--primary", type: "submit", text: "Ticket toevoegen", disabled: completed });
  form.append(
    el("div", { className: "field" }, [el("label", { htmlFor: "new-jira-key", text: "Jira-key *" }), key, keyError]),
    el("div", { className: "field" }, [el("label", { htmlFor: "new-ticket-summary", text: "Titel *" }), summary, summaryError]),
    el("div", { className: "field field--wide" }, [el("label", { htmlFor: "new-ticket-description", text: "Omschrijving" }), description]),
    el("div", { className: "field--wide" }, [submit]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const normalizedKey = key.value.trim().toUpperCase();
    key.value = normalizedKey;
    keyError.textContent = "";
    summaryError.textContent = "";
    let valid = true;
    if (!normalizedKey) { keyError.textContent = "Vul een Jira-key in."; valid = false; }
    if (!summary.value.trim()) { summaryError.textContent = "Vul een titel in."; valid = false; }
    if (model.tickets.some((ticket) => String(ticket.jiraIssueKey || "").trim().toUpperCase() === normalizedKey)) {
      keyError.textContent = "Deze Jira-key staat al in de sessie.";
      valid = false;
    }
    if (!valid) return;
    setBusy(submit, true, "Toevoegen…");
    try {
      const sortOrder = model.tickets.reduce((maximum, ticket) => Math.max(maximum, Number(ticket.sortOrder) || 0), 0) + 1;
      await create("estimationTickets", {
        sessionId: model.session.id,
        jiraIssueKey: normalizedKey,
        summary: summary.value.trim(),
        description: description.value.trim(),
        status: "pending",
        sortOrder,
        createdAt: new Date().toISOString(),
      });
      showToast("Ticket toegevoegd", "success");
      await refresh(true);
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
      && !window.confirm("Dit ticket is al behandeld. Wilt u het toch opnieuw activeren?")) return;
    try {
      await update("estimationSessions", sessionId, {
        currentTicketId: ticket.id,
        status: "active",
        startedAt: session.startedAt || new Date().toISOString(),
      });
      await update("estimationTickets", ticket.id, { status: "voting" });
      const key = roundStorageKey(sessionId, ticket.id);
      if (!getStoredValue(key, null, "sessionStorage")) setStoredValue(key, 1, "sessionStorage");
      showToast(`${ticket.jiraIssueKey || "Ticket"} is actief`, "success");
      await refresh(true);
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  const heading = el("div", { className: "page-heading" }, [
    el("div", {}, [
      el("p", { className: "eyebrow", text: `Facilitator · ${facilitator.displayName || facilitator.id}` }),
      el("h1", { text: session.name || "Estimation-sessie" }),
      el("div", { className: "meta-row" }, [statusBadge(session.status), el("span", { text: `${model.tickets.length} ticket${model.tickets.length === 1 ? "" : "s"}` }), el("span", { className: "refresh-indicator", id: "refresh-status", "aria-live": "polite" })]),
    ]),
    el("div", { className: "button-row" }, [
      el("a", { className: "button button--ghost", href: "#/", text: "Startpagina" }),
      (() => {
        const change = el("button", { className: "button button--secondary", type: "button", text: "Wissel facilitator" });
        change.addEventListener("click", () => { removeStoredValue(STORAGE_KEYS.facilitatorMemberId); refresh(true); });
        return change;
      })(),
    ]),
  ]);

  const sharePanel = el("section", { className: "share-bar" }, [
    el("div", {}, [el("strong", { text: "Deelnemerslink" }), el("span", { className: "share-url", text: shareUrl })]),
    (() => {
      const copy = el("button", { className: "button button--secondary", type: "button", text: "Link kopiëren" });
      copy.addEventListener("click", async () => {
        try { await copyText(shareUrl); showToast("Deelnemerslink gekopieerd", "success"); }
        catch (error) { showToast(errorMessage(error), "error"); }
      });
      return copy;
    })(),
  ]);

  const ticketSidebar = el("aside", { className: "panel facilitator-sidebar" }, [
    el("div", { className: "section-heading section-heading--compact" }, [el("div", {}, [el("h2", { text: "Tickets" }), el("p", { className: "muted", text: model.tickets.length ? "Selecteer een ticket om te starten." : "Voeg het eerste ticket toe." })])]),
    model.tickets.length ? renderTicketList(model, currentTicket, completed, activateTicket) : el("div", { className: "empty-state empty-state--compact", text: "Nog geen tickets." }),
  ]);

  const focus = el("section", { className: "panel facilitator-focus" });
  if (!currentTicket) {
    focus.append(el("div", { className: "empty-state empty-state--compact" }, [
      el("h2", { text: completed ? "Sessie afgerond" : "Geen actief ticket" }),
      el("p", { text: completed ? "De sessie is read-only. Eerder opgeslagen schattingen blijven in de ticketlijst zichtbaar." : model.tickets.length ? "Kies een ticket uit de lijst om de stemronde te starten." : "Voeg hieronder een ticket toe." }),
    ]));
  } else {
    const jiraUrl = safeJiraUrl(model.team?.jiraBaseUrl || session.team?.jiraBaseUrl, currentTicket.jiraIssueKey);
    const keyNode = jiraUrl
      ? el("a", { className: "ticket-key", href: jiraUrl.toString(), target: "_blank", rel: "noopener noreferrer", text: currentTicket.jiraIssueKey || "Ticket" })
      : el("span", { className: "ticket-key", text: currentTicket.jiraIssueKey || "Ticket" });
    focus.append(
      el("div", { className: "ticket-heading" }, [el("div", {}, [keyNode, el("h2", { text: currentTicket.summary || "Geen titel" })]), statusBadge(currentTicket.status)]),
      currentTicket.description ? el("p", { className: "ticket-description", text: currentTicket.description }) : el("p", { className: "muted", text: "Geen omschrijving." }),
      el("div", { className: "round-strip" }, [
        el("span", { text: `Ronde ${roundNumber}` }),
        el("strong", { text: `${currentVotes.length} van ${activeMembers.length} stemmen` }),
      ]),
      participantList(model, currentVotes, Boolean(revealed)),
    );
    if (revealed) {
      const result = statsGrid(currentVotes, model.statistics, currentTicket.finalEstimateHours);
      focus.append(el("div", { className: "results-block" }, [el("h3", { text: "Resultaten" }), result.grid]));

      if (currentTicket.status !== "estimated" && !completed) {
        const estimateInput = el("input", { id: "final-estimate", type: "number", min: "0", max: "1000", step: "0.01", value: result.stats.median ?? "" });
        const estimateError = el("p", { className: "field-error" });
        const chips = el("div", { className: "estimate-chips", role: "group", "aria-label": "Snelle schattingskeuzes" });
        VOTE_VALUES.forEach((value) => {
          const chip = el("button", { className: "chip", type: "button", text: String(value) });
          chip.addEventListener("click", () => { estimateInput.value = value; estimateInput.focus(); });
          chips.append(chip);
        });
        const save = el("button", { className: "button button--primary", type: "button", text: "Schatting opslaan" });
        save.addEventListener("click", async () => {
          estimateError.textContent = "";
          const raw = estimateInput.value.trim();
          const value = Number(raw.replace(",", "."));
          if (!raw) { estimateError.textContent = "Vul een definitieve schatting in."; return; }
          if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw) || !Number.isFinite(value) || value < 0 || value > 1000) {
            estimateError.textContent = "Gebruik een waarde van 0 t/m 1000 met maximaal twee decimalen.";
            return;
          }
          setBusy(save, true, "Opslaan…");
          try {
            await finalizeTicket(currentTicket.id, value);
            showToast("Definitieve schatting opgeslagen", "success");
            await refresh(true);
          } catch (error) {
            showToast(errorMessage(error), "error");
            setBusy(save, false);
          }
        });
        focus.append(el("div", { className: "estimate-form" }, [
          el("div", { className: "field" }, [el("label", { htmlFor: "final-estimate", text: "Definitieve schatting (uren)" }), estimateInput, estimateError]),
          chips,
          save,
        ]));
      }
    }
  }

  const reveal = el("button", {
    className: "button button--primary",
    type: "button",
    text: `Stemmen onthullen (${currentVotes.length})`,
    disabled: completed || !currentTicket || currentTicket.status !== "voting",
  });
  reveal.addEventListener("click", async () => {
    if (currentVotes.length < activeMembers.length
      && !window.confirm(`${currentVotes.length} van ${activeMembers.length} deelnemers hebben gestemd. Toch onthullen?`)) return;
    setBusy(reveal, true, "Onthullen…");
    try {
      await revealTicket(currentTicket.id, roundNumber);
      showToast("Stemmen onthuld", "success");
      await refresh(true);
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(reveal, false);
    }
  });

  const newRound = el("button", {
    className: "button button--secondary", type: "button", text: "Nieuwe ronde",
    disabled: completed || !currentTicket || !["revealed", "estimated"].includes(currentTicket.status),
  });
  newRound.addEventListener("click", async () => {
    if (!window.confirm("Nieuwe stemronde starten? De stemmen uit de huidige ronde blijven bewaard als historie.")) return;
    const nextRound = roundNumber + 1;
    try {
      setStoredValue(roundStorageKey(sessionId, currentTicket.id), nextRound, "sessionStorage");
      await update("estimationTickets", currentTicket.id, { status: "voting" });
      showToast(`Ronde ${nextRound} gestart`, "success");
      await refresh(true);
    } catch (error) {
      setStoredValue(roundStorageKey(sessionId, currentTicket.id), roundNumber, "sessionStorage");
      showToast(errorMessage(error), "error");
    }
  });

  const next = el("button", {
    className: "button button--secondary", type: "button",
    text: nextTicket ? "Volgend open ticket" : "Alle tickets zijn geschat",
    disabled: completed || !nextTicket,
  });
  next.addEventListener("click", () => activateTicket(nextTicket));

  const finish = el("button", { className: "button button--danger", type: "button", text: "Sessie afronden", disabled: completed });
  finish.addEventListener("click", async () => {
    const warning = openTickets.length
      ? `Er zijn nog ${openTickets.length} openstaande tickets. Wilt u de sessie toch afronden?`
      : "Wilt u deze sessie afronden? Daarna is stemmen niet meer mogelijk.";
    if (!window.confirm(warning)) return;
    setBusy(finish, true, "Afronden…");
    try {
      await update("estimationSessions", sessionId, { status: "completed", completedAt: new Date().toISOString(), currentTicketId: "" });
      showToast("Sessie afgerond", "success");
      await refresh(true);
    } catch (error) {
      showToast(errorMessage(error), "error");
      setBusy(finish, false);
    }
  });

  const actionBar = el("div", { className: "facilitator-actions", role: "group", "aria-label": "Facilitatoracties" }, [reveal, newRound, next, finish]);
  const ticketFormPanel = el("section", { className: "panel" }, [
    el("div", { className: "section-heading section-heading--compact" }, [el("div", {}, [el("h2", { text: "Ticket toevoegen" }), el("p", { className: "muted", text: completed ? "Een afgeronde sessie is read-only." : "Voeg Jira-tickets handmatig toe." })])]),
    addTicketForm(model, completed, refresh),
  ]);

  app.replaceChildren(
    heading,
    completed ? el("div", { className: "completion-banner" }, [el("strong", { text: "Deze sessie is afgerond." }), el("span", { text: " Resultaten blijven zichtbaar; wijzigingen zijn uitgeschakeld." })]) : sharePanel,
    el("div", { className: "facilitator-layout" }, [ticketSidebar, focus]),
    actionBar,
    ticketFormPanel,
  );
}

export async function renderFacilitatorView({ app, route, isCurrent = () => true, refresh }) {
  const sessionId = route.params.sessionId;
  document.title = "Faciliteren · Estimation Poker";
  if (!isApiConfigured()) {
    renderErrorView({ app, title: "API nog niet geconfigureerd", error: new Error("Vul eerst apiUrl in site/js/config.js in.") });
    return;
  }
  if (!app.hasChildNodes()) app.append(el("section", { className: "loading-state", role: "status" }, [el("span", { className: "spinner" }), el("p", { text: "Facilitatorscherm laden…" })]));
  try {
    const model = normalizeSessionState(await getSessionState(sessionId));
    if (!isCurrent()) return;
    if (!model) throw new Error("De sessie is niet gevonden of de response is onvolledig.");
    const activeMembers = model.members.filter(isActiveMember);
    const roleFacilitators = activeMembers.filter((member) => member.role === "facilitator");
    const eligibleFacilitators = roleFacilitators.length ? roleFacilitators : activeMembers;
    const storedId = getStoredValue(STORAGE_KEYS.facilitatorMemberId, null);
    const facilitator = eligibleFacilitators.find((member) => String(member.id) === String(storedId));
    if (!facilitator) {
      if (storedId) removeStoredValue(STORAGE_KEYS.facilitatorMemberId);
      chooseFacilitator(app, model, sessionId);
      return;
    }
    setStoredValue(STORAGE_KEYS.facilitatorMemberId, facilitator.id);
    setStoredValue(STORAGE_KEYS.lastSessionId, sessionId);
    const currentTicket = getCurrentTicket(model);
    const roundNumber = currentTicket
      ? Number(getStoredValue(roundStorageKey(sessionId, currentTicket.id), model.currentRoundNumber || 1, "sessionStorage")) || 1
      : 1;
    renderFacilitator(app, model, facilitator, roundNumber, { sessionId, refresh });
  } catch (error) {
    if (!isCurrent()) return;
    if (app.querySelector(".facilitator-layout")) {
      showToast(`Bijwerken mislukt: ${errorMessage(error)}`, "warning");
      return;
    }
    renderErrorView({ app, title: "Facilitatorscherm kon niet worden geladen", error, retry: () => refresh(false) });
  }
}
