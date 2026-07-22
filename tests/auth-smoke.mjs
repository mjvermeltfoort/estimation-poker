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
const { list } = await import("../site/js/api.js");

setAuthSession({
  token: "signed-session-token",
  expiresAt: Date.now() + 60_000,
  user: { email: "ada@example.test", memberships: [] },
});
assert(getAuthToken() === "signed-session-token", "The signed session was not stored for this browser tab.");

await list("teams");
const requestBody = JSON.parse(capturedRequest.options.body);
assert(capturedRequest.options.method === "POST", "Protected API reads must use POST.");
assert(capturedRequest.options.headers["Content-Type"] === "text/plain;charset=utf-8", "Protected API calls use a preflight-triggering content type.");
assert(requestBody.authToken === "signed-session-token", "The API client did not attach the signed session.");
assert(requestBody.action === "list" && requestBody.entity === "teams", "The protected list request is malformed.");
assert(!capturedRequest.url.includes("signed-session-token"), "The signed session leaked into the request URL.");

clearAuthSession();
assert(getAuthToken() === null, "Signing out did not remove the browser session.");
assert(dispatchedEvents.includes("estimation-poker:auth-changed"), "Authentication changes are not announced to the application.");

print("Authentication smoke tests passed");
