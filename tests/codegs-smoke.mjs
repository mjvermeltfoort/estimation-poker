import GLib from "gi://GLib";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createSheet(rows) {
  return {
    rows,
    getLastColumn() { return this.rows[0]?.length || 0; },
    getLastRow() { return this.rows.length; },
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
    ["id", "name", "jiraBaseUrl", "jiraProjectKey", "createdAt", "active"],
    ["team-1", "Team één", "https://jira.example.test", "TEAM", "2026-01-01T00:00:00.000Z", true],
    ["team-2", "Team twee", "", "", "2026-01-01T00:00:00.000Z", true],
  ]),
  TeamMembers: createSheet([
    ["id", "teamId", "displayName", "email", "role", "active", "createdAt"],
    ["member-1", "team-1", "Ada", "", "facilitator", true, "2026-01-01T00:00:00.000Z"],
    ["member-2", "team-2", "Grace", "", "member", true, "2026-01-01T00:00:00.000Z"],
  ]),
  EstimationSessions: createSheet([
    ["id", "teamId", "name", "status", "createdByMemberId", "createdAt", "startedAt", "completedAt", "currentTicketId"],
    ["session-1", "team-1", "Refinement", "active", "member-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "", "ticket-1"],
  ]),
  EstimationTickets: createSheet([
    ["id", "sessionId", "jiraIssueKey", "summary", "description", "status", "sortOrder", "finalEstimateHours", "createdAt"],
    ["ticket-1", "session-1", "TEAM-1", "Veilig stemmen", "", "voting", 1, "", "2026-01-01T00:00:00.000Z"],
  ]),
  Votes: createSheet([
    ["id", "sessionId", "ticketId", "teamMemberId", "roundNumber", "estimateHours", "createdAt"],
    ["vote-1", "session-1", "ticket-1", "member-1", 1, 8, "2026-01-01T00:00:00.000Z"],
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
};
globalThis.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput: (text) => ({
    text,
    setMimeType() { return this; },
  }),
};

const [loaded, contents] = GLib.file_get_contents(
  GLib.build_filenamev([GLib.get_current_dir(), "resources", "Code.gs"]),
);
assert(loaded, "Code.gs kon niet worden geladen.");
const source = new TextDecoder().decode(contents);
const backend = eval(`${source}\n({ handleRequest: handleRequest_ });`);

function request(method, parameter = {}, body = null) {
  const event = { parameter };
  if (body) event.postData = { contents: JSON.stringify(body) };
  return JSON.parse(backend.handleRequest(method, event).text);
}

const health = request("GET", { action: "health" });
assert(health.ok === true && health.data.apiVersion === "v1", "Healthresponse voldoet niet aan het frontendcontract.");

const protectedVotes = request("GET", { action: "list", entity: "votes" });
assert(protectedVotes.ok === false && protectedVotes.error.code === "PROTECTED_ENTITY", "Stemmen zijn generiek uitleesbaar.");

let state = request("GET", { action: "sessionState", sessionId: "session-1" });
assert(state.ok === true && state.data.team.id === "team-1", "Sessiestatus mist teamgegevens.");
assert(state.data.votes.length === 1 && state.data.votes[0].hasVoted === true, "Verborgen stemstatus ontbreekt.");
assert(!("estimateHours" in state.data.votes[0]), "Een stemwaarde lekt vóór reveal.");

const invalidMemberVote = request("POST", {}, {
  action: "submitVote",
  sessionId: "session-1",
  ticketId: "ticket-1",
  teamMemberId: "member-2",
  roundNumber: 1,
  estimateHours: 8,
});
assert(invalidMemberVote.ok === false && invalidMemberVote.error.code === "MEMBER_NOT_ELIGIBLE", "Een lid van een ander team kan stemmen.");

const revealed = request("POST", {}, {
  action: "revealTicket",
  ticketId: "ticket-1",
  roundNumber: 1,
});
assert(revealed.ok === true && revealed.data.votes[0].estimateHours === 8, "Reveal geeft de stemwaarde niet vrij.");
assert(revealed.data.statistics.median === 8, "Reveal-statistieken zijn onjuist.");

state = request("GET", { action: "sessionState", sessionId: "session-1" });
assert(state.data.votes[0].estimateHours === 8, "Een onthulde stem wordt ten onrechte verborgen.");

const newRound = request("POST", {}, {
  action: "update",
  entity: "estimationTickets",
  id: "ticket-1",
  data: { status: "voting" },
});
assert(newRound.ok === true, "Een nieuwe ronde kon niet worden gestart.");

state = request("GET", { action: "sessionState", sessionId: "session-1" });
assert(state.data.currentRoundNumber === 2, "Het backend-rondenummer is niet verhoogd.");
assert(state.data.votes.length === 0, "Stemmen uit een vorige ronde verschijnen in de nieuwe ronde.");

const staleVote = request("POST", {}, {
  action: "submitVote",
  sessionId: "session-1",
  ticketId: "ticket-1",
  teamMemberId: "member-1",
  roundNumber: 1,
  estimateHours: 8,
});
assert(staleVote.ok === false && staleVote.error.code === "ROUND_MISMATCH", "Een stem voor een verouderde ronde is geaccepteerd.");

const currentVote = request("POST", {}, {
  action: "submitVote",
  sessionId: "session-1",
  ticketId: "ticket-1",
  teamMemberId: "member-1",
  roundNumber: 2,
  estimateHours: 12,
});
assert(currentVote.ok === true && currentVote.data.hasVoted === true, "Een geldige stem is geweigerd.");

state = request("GET", { action: "sessionState", sessionId: "session-1" });
assert(state.data.votes.length === 1 && !("estimateHours" in state.data.votes[0]), "De nieuwe stem lekt vóór reveal.");

const secondReveal = request("POST", {}, {
  action: "revealTicket",
  ticketId: "ticket-1",
  roundNumber: 2,
});
assert(secondReveal.ok === true, "De tweede ronde kon niet worden onthuld.");

const finalized = request("POST", {}, {
  action: "finalizeTicket",
  ticketId: "ticket-1",
  finalEstimateHours: 12,
});
assert(finalized.ok === true && finalized.data.status === "estimated", "De definitieve schatting kon niet worden opgeslagen.");

state = request("GET", { action: "sessionState", sessionId: "session-1" });
assert(state.data.votes[0].estimateHours === 12, "Stemmen verdwijnen nadat een ticket definitief is geschat.");
assert(state.data.statistics.median === 12, "Definitieve sessiestatistieken zijn onjuist.");

print("Code.gs-smoketests geslaagd");
