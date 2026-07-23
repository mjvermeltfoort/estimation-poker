function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const storedValues = new Map();
const dispatchedEvents = [];

globalThis.CustomEvent = class CustomEvent {
  constructor(type) { this.type = type; }
};
globalThis.AbortController = class AbortController {
  constructor() { this.signal = {}; }
  abort() {}
};
globalThis.URL = class URL {
  constructor(value) {
    this.value = String(value);
    this.searchParams = { set() {} };
  }
  toString() { return this.value; }
};
Object.assign(globalThis.window, {
  sessionStorage: {
    getItem: (key) => storedValues.get(key) ?? null,
    setItem: (key, value) => storedValues.set(key, value),
    removeItem: (key) => storedValues.delete(key),
  },
  setTimeout: () => 1,
  clearTimeout() {},
  dispatchEvent: (event) => dispatchedEvents.push(event.type),
});

let capturedRequest = null;
globalThis.fetch = async (url, options) => {
  capturedRequest = { url: String(url), options };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, data: [] }),
  };
};

const { clearAuthSession, getAuthToken, setAuthSession } = await import("../site/js/authSession.js");
const { CONFIG } = await import("../site/js/config.js");
const { createSession, createEstimationTicket } = await import("../site/js/api.js");

CONFIG.supabaseUrl = "https://supabase.example.test";
CONFIG.supabaseAnonKey = "anon-key-for-tests";

setAuthSession({
  token: "signed-session-token",
  expiresAt: Date.now() + 60_000,
  user: { email: "ada@example.test", memberships: [] },
});
assert(getAuthToken() === "signed-session-token", "The signed session was not stored for this browser tab.");

await createSession({ teamId: "team-123", name: "Sprint planning" });
assert(capturedRequest.options.method === "POST", "RPC requests must use POST.");
assert(capturedRequest.url.includes("rest/v1/rpc/create_session"), "Session creation must go through the create_session RPC.");
assert(capturedRequest.options.headers.Accept === "application/json", "Supabase requests should ask for JSON responses.");
assert(capturedRequest.options.headers["Content-Type"] === "application/json", "RPC requests should send a JSON content-type header.");
assert(capturedRequest.options.headers.Authorization === "Bearer signed-session-token", "The API client did not attach the signed session as a bearer token.");
assert(capturedRequest.options.headers.apikey === "anon-key-for-tests", "The Supabase anon key is missing from the request.");
assert(!capturedRequest.url.includes("signed-session-token"), "The signed session leaked into the request URL.");
assert(capturedRequest.options.body === JSON.stringify({ p_team_id: "team-123", p_name: "Sprint planning" }), "Session creation must send the expected RPC payload.");

await createEstimationTicket({
  sessionId: "session-456",
  projectId: "project-789",
  ticketNumber: "123",
  summary: "Implement RPC flow",
  description: "Replace direct table writes.",
  status: "pending",
  sortOrder: 2,
  createdAt: "2026-07-23T12:00:00.000Z",
});
assert(capturedRequest.url.includes("rest/v1/rpc/create_estimation_ticket"), "Ticket creation must go through the create_estimation_ticket RPC.");
assert(capturedRequest.options.body === JSON.stringify({
  p_session_id: "session-456",
  p_project_id: "project-789",
  p_ticket_number: "123",
  p_summary: "Implement RPC flow",
  p_description: "Replace direct table writes.",
  p_status: "pending",
  p_sort_order: 2,
  p_created_at: "2026-07-23T12:00:00.000Z",
}), "Ticket creation must send the expected RPC payload.");

clearAuthSession();
assert(getAuthToken() === null, "Signing out did not remove the browser session.");
assert(dispatchedEvents.includes("estimation-poker:auth-changed"), "Authentication changes are not announced to the application.");

print("Authentication smoke tests passed");
