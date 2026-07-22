import GLib from "gi://GLib";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createSheet(rows) {
  return {
    rows,
    readCount: 0,
    getLastColumn() { return this.rows[0]?.length || 0; },
    getLastRow() { return this.rows.length; },
    getDataRange() {
      this.readCount += 1;
      return this.getRange(1, 1, this.getLastRow(), this.getLastColumn());
    },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, rowOffset) => (
          Array.from({ length: columnCount }, (_, columnOffset) => (
            this.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ""
          ))
        )),
        setValues: (values) => {
          values.forEach((sourceRow, rowOffset) => {
            const targetIndex = row - 1 + rowOffset;
            if (!this.rows[targetIndex]) this.rows[targetIndex] = [];
            sourceRow.forEach((value, columnOffset) => {
              this.rows[targetIndex][column - 1 + columnOffset] = value;
            });
          });
        },
        setValue: (value) => {
          if (!this.rows[row - 1]) this.rows[row - 1] = [];
          this.rows[row - 1][column - 1] = value;
        },
      };
    },
    deleteRow(row) { this.rows.splice(row - 1, 1); },
  };
}

const sheets = {
  Teams: createSheet([
    ["id", "name", "jiraBaseUrl", "jiraProjectKey", "createdAt", "active", "privateNotes"],
    ["team-1", "Team one", "https://jira.example.test", "TEAM", "2026-01-01T00:00:00.000Z", true, "do not expose"],
    ["team-2", "Team two", "", "", "2026-01-01T00:00:00.000Z", true, "do not expose"],
  ]),
  TeamMembers: createSheet([
    ["id", "teamId", "displayName", "email", "role", "active", "createdAt", "privateNotes"],
    ["member-1", "team-1", "Ada", "ada@example.test", "facilitator", true, "2026-01-01T00:00:00.000Z", "do not expose"],
    ["member-2", "team-2", "Grace", "grace@example.test", "member", true, "2026-01-01T00:00:00.000Z", "do not expose"],
    ["member-3", "team-1", "Linus", "linus@example.test", "member", true, "2026-01-01T00:00:00.000Z", "do not expose"],
  ]),
  EstimationSessions: createSheet([
    ["id", "teamId", "name", "status", "createdByMemberId", "createdAt", "startedAt", "completedAt", "currentTicketId"],
    ["session-1", "team-1", "Refinement", "active", "member-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "", "ticket-1"],
  ]),
  EstimationTickets: createSheet([
    ["id", "sessionId", "jiraIssueKey", "summary", "description", "status", "sortOrder", "finalEstimateHours", "createdAt", "privateNotes"],
    ["ticket-1", "session-1", "TEAM-1", "Secure voting", "", "voting", 1, "", "2026-01-01T00:00:00.000Z", "do not expose"],
  ]),
  Votes: createSheet([
    ["id", "sessionId", "ticketId", "teamMemberId", "roundNumber", "estimateHours", "createdAt", "privateNotes"],
    ["vote-1", "session-1", "ticket-1", "member-1", 1, 8, "2026-01-01T00:00:00.000Z", "do not expose"],
  ]),
};

const properties = new Map();
let uuidCounter = 1;

globalThis.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: (name) => sheets[name] || null,
  }),
};
globalThis.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => properties.get(key) ?? null,
    setProperty: (key, value) => properties.set(key, value),
    deleteProperty: (key) => properties.delete(key),
  }),
};
globalThis.LockService = {
  getScriptLock: () => ({
    tryLock: () => true,
    releaseLock: () => {},
  }),
};
globalThis.Utilities = {
  getUuid: () => `generated-${uuidCounter++}`,
  computeHmacSha256Signature: (value, key) => new TextEncoder().encode(`${key}:${value}`),
  base64EncodeWebSafe: (bytes) => GLib.base64_encode(Uint8Array.from(bytes)).replace(/\+/g, "-").replace(/\//g, "_"),
  base64DecodeWebSafe: (value) => GLib.base64_decode(String(value).replace(/-/g, "+").replace(/_/g, "/")),
  newBlob: (value) => {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
    return {
      getBytes: () => bytes,
      getDataAsString: () => new TextDecoder().decode(bytes),
    };
  },
};
globalThis.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput: (text) => ({
    text,
    setMimeType() { return this; },
  }),
};
globalThis.UrlFetchApp = {
  fetch: (url, options) => {
    const response = url.includes("/token")
      ? {
        access_token: "google-access-token",
        id_token: ["header", Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify({
          iss: "https://accounts.google.com",
          aud: "test-client.apps.googleusercontent.com",
          sub: "google-ada",
          email: "ada@example.test",
          email_verified: true,
          hd: "example.test",
          exp: Math.floor(Date.now() / 1000) + 600,
        })).getBytes()).replace(/=+$/, ""), "signature"].join("."),
      }
      : {
        sub: "google-ada",
        email: "ada@example.test",
        email_verified: true,
      };
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify(response),
    };
  },
};

const [loaded, contents] = GLib.file_get_contents(
  GLib.build_filenamev([GLib.get_current_dir(), "resources", "Code.gs"]),
);
assert(loaded, "Code.gs could not be loaded.");
const source = new TextDecoder().decode(contents);
const backend = eval(`${source}\n({ handleRequest: handleRequest_, issueSessionToken: issueSessionToken_ });`);

properties.set("estimationPoker.auth.member.member-1", "google-ada");
properties.set("estimationPoker.auth.subject.google-ada", JSON.stringify(["member-1"]));
properties.set("estimationPoker.auth.member.member-2", "google-grace");
properties.set("estimationPoker.auth.subject.google-grace", JSON.stringify(["member-2"]));
properties.set("estimationPoker.auth.member.member-3", "google-linus");
properties.set("estimationPoker.auth.subject.google-linus", JSON.stringify(["member-3"]));
properties.set("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
properties.set("GOOGLE_CLIENT_SECRET", "server-only-secret");
properties.set("GOOGLE_ALLOWED_ORIGINS", "https://poker.example.test,http://localhost:8080");
properties.set("GOOGLE_ALLOWED_DOMAIN", "example.test");
const adaToken = backend.issueSessionToken({
  sub: "google-ada",
  email: "ada@example.test",
  memberships: [{ id: "member-1", teamId: "team-1", displayName: "Ada", role: "facilitator", active: true }],
}).token;
const graceToken = backend.issueSessionToken({
  sub: "google-grace",
  email: "grace@example.test",
  memberships: [{ id: "member-2", teamId: "team-2", displayName: "Grace", role: "member", active: true }],
}).token;
const linusToken = backend.issueSessionToken({
  sub: "google-linus",
  email: "linus@example.test",
  memberships: [{ id: "member-3", teamId: "team-1", displayName: "Linus", role: "member", active: true }],
}).token;

function request(method, parameter = {}, body = null, authToken = adaToken) {
  const event = { parameter };
  if (body) event.postData = { contents: JSON.stringify(authToken ? { ...body, authToken } : body) };
  return JSON.parse(backend.handleRequest(method, event).text);
}

const health = request("GET", { action: "health" });
assert(health.ok === true && health.data.apiVersion === "v2", "Health response does not satisfy the frontend contract.");

const signedIn = request("POST", {}, {
  action: "authenticate",
  code: "valid-code",
  redirectOrigin: "https://poker.example.test",
}, null);
assert(signedIn.ok === true && signedIn.data.user.email === "ada@example.test", "Google sign-in did not create an application session.");
assert(signedIn.data.token && signedIn.data.expiresAt > Date.now(), "Google sign-in did not return a valid session token.");
assert(!("sub" in signedIn.data.user), "The stable Google account identifier leaks to the frontend.");

const rejectedOrigin = request("POST", {}, {
  action: "authenticate",
  code: "valid-code",
  redirectOrigin: "https://attacker.example.test",
}, null);
assert(rejectedOrigin.ok === false && rejectedOrigin.error.code === "ORIGIN_NOT_ALLOWED", "An untrusted origin can exchange a Google authorization code.");

const unauthenticated = request("POST", {}, { action: "sessionState", sessionId: "session-1" }, null);
assert(unauthenticated.ok === false && unauthenticated.error.code === "AUTH_REQUIRED", "A protected endpoint accepted a request without a session.");

const forgedSession = request("POST", {}, { action: "sessionState", sessionId: "session-1" }, `${adaToken}tampered`);
assert(forgedSession.ok === false && forgedSession.error.code === "INVALID_SESSION", "A modified application session was accepted.");

const protectedVotes = request("POST", {}, { action: "list", entity: "votes", filters: {} });
assert(protectedVotes.ok === false && protectedVotes.error.code === "PROTECTED_ENTITY", "Votes can be read through the generic endpoint.");

const visibleMembers = request("POST", {}, { action: "list", entity: "teamMembers", filters: { teamId: "team-1" } });
assert(visibleMembers.ok === true && visibleMembers.data.length === 2, "Team members could not be listed by their team.");
assert(!("email" in visibleMembers.data[0]), "Team-member email addresses leak through the API.");
assert(!("privateNotes" in visibleMembers.data[0]), "Unknown Sheet columns leak through the member API.");

const homeState = request("POST", {}, { action: "homeState", teamId: "team-2" });
assert(homeState.ok === true && homeState.data.teams.length === 1, "The combined home response did not return accessible teams.");
assert(homeState.data.selectedTeamId === "team-1" && homeState.data.sessions.length === 1, "The combined home response selected an inaccessible team or omitted sessions.");

const createdSession = request("POST", {}, {
  action: "create",
  entity: "estimationSessions",
  data: { teamId: "team-1", name: "Authenticated creation", createdByMemberId: "member-3" },
});
assert(createdSession.ok === true && createdSession.data.createdByMemberId === "member-1", "A client can forge the session creator identity.");

const forbiddenTeamCreation = request("POST", {}, {
  action: "create",
  entity: "teams",
  data: { name: "Injected team" },
});
assert(forbiddenTeamCreation.ok === false && forbiddenTeamCreation.error.code === "FORBIDDEN", "A client can create teams through the public API.");

const memberSessionCreation = request("POST", {}, {
  action: "create",
  entity: "estimationSessions",
  data: { teamId: "team-1", name: "Unauthorized creation", createdByMemberId: "member-3" },
}, linusToken);
assert(memberSessionCreation.ok === false && memberSessionCreation.error.code === "FACILITATOR_REQUIRED", "A regular member can create a session.");

Object.values(sheets).forEach((sheet) => { sheet.readCount = 0; });
let state = request("POST", {}, { action: "sessionState", sessionId: "session-1" });
assert(state.ok === true && state.data.team.id === "team-1", "Session state is missing team data.");
assert(sheets.TeamMembers.readCount === 1, "Team members were read more than once in a session-state request.");
assert([sheets.Teams, sheets.EstimationSessions, sheets.EstimationTickets, sheets.Votes].every((sheet) => sheet.readCount === 1), "A session-state sheet was read more than once in one request.");
assert(!("privateNotes" in state.data.team) && !("privateNotes" in state.data.currentTicket), "Unknown Sheet columns leak through session state.");
assert(state.data.viewer.memberId === "member-1", "Session identity was not derived from the signed-in account.");
assert(state.data.viewer.role === "facilitator" && state.data.viewer.canFacilitate === true, "Facilitator membership is not exposed correctly to the UI.");
assert(state.data.votes.length === 1 && state.data.votes[0].hasVoted === true, "Hidden vote status is missing.");
assert(!("estimateHours" in state.data.votes[0]), "A vote value leaks before reveal.");

const invalidMemberVote = request("POST", {}, {
  action: "submitVote",
  sessionId: "session-1",
  ticketId: "ticket-1",
  teamMemberId: "member-2",
  roundNumber: 1,
  estimateHours: 8,
});
assert(invalidMemberVote.ok === false && invalidMemberVote.error.code === "IDENTITY_MISMATCH", "A vote can be submitted as another member.");

const otherTeamState = request("POST", {}, { action: "sessionState", sessionId: "session-1" }, graceToken);
assert(otherTeamState.ok === false && otherTeamState.error.code === "FORBIDDEN", `A member can read another team's session: ${JSON.stringify(otherTeamState)}`);

const memberReveal = request("POST", {}, { action: "revealTicket", ticketId: "ticket-1", roundNumber: 1 }, linusToken);
assert(memberReveal.ok === false && memberReveal.error.code === "FACILITATOR_REQUIRED", "A regular team member can reveal votes.");

const memberMutation = request("POST", {}, {
  action: "update",
  entity: "estimationSessions",
  id: "session-1",
  data: { name: "Compromised" },
}, linusToken);
assert(memberMutation.ok === false && memberMutation.error.code === "FACILITATOR_REQUIRED", "A regular team member can mutate a session.");

const revealed = request("POST", {}, {
  action: "revealTicket",
  ticketId: "ticket-1",
  roundNumber: 1,
});
assert(revealed.ok === true && revealed.data.votes[0].estimateHours === 8, "Reveal does not expose the vote value.");
assert(!("privateNotes" in revealed.data.votes[0]), "Unknown vote columns leak after reveal.");
assert(revealed.data.statistics.median === 8, "Reveal statistics are incorrect.");

state = request("POST", {}, { action: "sessionState", sessionId: "session-1" });
assert(state.data.votes[0].estimateHours === 8, "A revealed vote is incorrectly hidden.");

const newRound = request("POST", {}, {
  action: "update",
  entity: "estimationTickets",
  id: "ticket-1",
  data: { status: "voting" },
});
assert(newRound.ok === true, "A new round could not be started.");

state = request("POST", {}, { action: "sessionState", sessionId: "session-1" });
assert(state.data.currentRoundNumber === 2, "The backend round number was not incremented.");
assert(state.data.votes.length === 0, "Votes from a previous round appear in the new round.");

const staleVote = request("POST", {}, {
  action: "submitVote",
  sessionId: "session-1",
  ticketId: "ticket-1",
  roundNumber: 1,
  estimateHours: 8,
});
assert(staleVote.ok === false && staleVote.error.code === "ROUND_MISMATCH", "A vote for a stale round was accepted.");

Object.values(sheets).forEach((sheet) => { sheet.readCount = 0; });
const currentVote = request("POST", {}, {
  action: "submitVote",
  sessionId: "session-1",
  ticketId: "ticket-1",
  roundNumber: 2,
  estimateHours: 12,
  includeSessionState: true,
});
assert(currentVote.ok === true && currentVote.data.hasVoted === true, "A facilitator could not join as a participant and vote.");
assert(currentVote.data.sessionState.votes.length === 1 && !("estimateHours" in currentVote.data.sessionState.votes[0]), "A combined mutation response leaks an unrevealed vote.");
assert(Object.values(sheets).every((sheet) => sheet.readCount === 1), "A combined vote-and-refresh request read a sheet more than once.");

state = request("POST", {}, { action: "sessionState", sessionId: "session-1" });
assert(state.data.votes.length === 1 && !("estimateHours" in state.data.votes[0]), "The new vote leaks before reveal.");

const secondReveal = request("POST", {}, {
  action: "revealTicket",
  ticketId: "ticket-1",
  roundNumber: 2,
});
assert(secondReveal.ok === true, "The second round could not be revealed.");

const finalized = request("POST", {}, {
  action: "finalizeTicket",
  ticketId: "ticket-1",
  finalEstimateHours: 12,
});
assert(finalized.ok === true && finalized.data.status === "estimated", "The final estimate could not be saved.");

state = request("POST", {}, { action: "sessionState", sessionId: "session-1" });
assert(state.data.votes[0].estimateHours === 12, "Votes disappear after a ticket receives a final estimate.");
assert(state.data.statistics.median === 12, "Final session statistics are incorrect.");

const activated = request("POST", {}, {
  action: "activateTicket",
  sessionId: "session-1",
  ticketId: "ticket-1",
});
assert(activated.ok === true && activated.data.sessionState.currentTicket.status === "voting", "Ticket activation did not return refreshed session state.");
assert(activated.data.sessionState.currentRoundNumber === 3, "Reactivating an estimated ticket did not advance the round.");
assert(activated.data.sessionState.votes.length === 0, "A combined activation response included votes from an earlier round.");

print("Code.gs smoke tests passed");
