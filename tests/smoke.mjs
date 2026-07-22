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

const { isApiConfigured } = await import("../site/js/config.js");
const { parseHashRoute } = await import("../site/js/router.js");
const { calculateStatistics, sortTickets, statusLabel } = await import("../site/js/utils.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const participantRoute = parseHashRoute("#/session/session-demo?member=member-demo");
assert(participantRoute.name === "session", "Deelnemersroute wordt niet herkend.");
assert(participantRoute.params.sessionId === "session-demo", "Sessieparameter is onjuist.");
assert(participantRoute.query.get("member") === "member-demo", "Hash-queryparameter is onjuist.");

const createRoute = parseHashRoute("#/sessions/new");
assert(createRoute.name === "create-session", "Nieuwe-sessieroute wordt niet herkend.");
assert(parseHashRoute("#/onbekend").name === "not-found", "Onbekende route geeft geen 404.");

const statistics = calculateStatistics([
  { estimateHours: 3 },
  { estimateHours: 6 },
  { estimateHours: 8 },
  { estimateHours: 4 },
]);
assert(statistics.count === 4, "Aantal stemmen is onjuist.");
assert(statistics.min === 3 && statistics.max === 8, "Minimum of maximum is onjuist.");
assert(statistics.average === 5.25 && statistics.median === 5, "Gemiddelde of mediaan is onjuist.");

const sorted = sortTickets([{ id: "late", sortOrder: 2 }, { id: "first", sortOrder: 1 }]);
assert(sorted[0].id === "first", "Tickets worden niet op sortOrder gesorteerd.");
assert(statusLabel("voting") === "Stemmen", "Statuslabel is onjuist.");
assert(isApiConfigured() === false, "De placeholder-URL mag niet als geconfigureerd gelden.");

print("Smoke tests geslaagd");
