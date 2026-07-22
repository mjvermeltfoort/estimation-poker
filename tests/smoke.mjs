// GJS is a JavaScript engine without browser URLSearchParams. This tiny test-only
// polyfill covers the hash-query behavior exercised below; the browser uses its
// native implementation in production.
globalThis.URLSearchParams = class URLSearchParams {
  constructor(query = "") {
    this.values = new Map();
    String(query).split("&").filter(Boolean).forEach((part) => {
      const [key, value = ""] = part.split("=");
      this.values.set(decodeURIComponent(key), decodeURIComponent(value));
    });
  }

  get(key) {
    return this.values.get(key) ?? null;
  }
};

const { CONFIG, isApiConfigured } = await import("../site/js/config.js");
const { parseHashRoute } = await import("../site/js/router.js");
const { calculateStatistics, sortTickets, statusLabel } = await import("../site/js/utils.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const participantRoute = parseHashRoute("#/session/session-demo?member=member-demo");
assert(participantRoute.name === "session", "Participant route is not recognized.");
assert(participantRoute.params.sessionId === "session-demo", "Session parameter is incorrect.");
assert(participantRoute.query.get("member") === "member-demo", "Hash query parameter is incorrect.");

const createRoute = parseHashRoute("#/sessions/new");
assert(createRoute.name === "create-session", "New-session route is not recognized.");
assert(parseHashRoute("#/unknown").name === "not-found", "Unknown route does not return a 404.");

const statistics = calculateStatistics([
  { estimateHours: 3 },
  { estimateHours: 6 },
  { estimateHours: 8 },
  { estimateHours: 4 },
]);
assert(statistics.count === 4, "Vote count is incorrect.");
assert(statistics.min === 3 && statistics.max === 8, "Minimum or maximum is incorrect.");
assert(statistics.average === 5.25 && statistics.median === 5, "Average or median is incorrect.");

const sorted = sortTickets([{ id: "late", sortOrder: 2 }, { id: "first", sortOrder: 1 }]);
assert(sorted[0].id === "first", "Tickets are not sorted by sortOrder.");
assert(statusLabel("voting") === "Voting", "Status label is incorrect.");
const expectedConfiguredState = Boolean(
  CONFIG.apiUrl
    && !CONFIG.apiUrl.includes("PASTE_HERE")
    && /^https:\/\//i.test(CONFIG.apiUrl),
);
assert(isApiConfigured() === expectedConfiguredState, "API configuration status is incorrect.");

print("Smoke tests passed");
