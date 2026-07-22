import { isApiConfigured, isGoogleAuthConfigured } from "./config.js";
import { getCurrentUser } from "./authSession.js";
import { renderAccountControl, renderSignInView, restoreAuthenticatedUser } from "./auth.js";
import { clearFatalError, initNotifications } from "./notifications.js";
import { startPolling, stopPolling } from "./polling.js";
import { startRouter } from "./router.js";
import { resetSessionState, setState } from "./state.js";
import { renderCreateSessionView } from "./views/createSessionView.js";
import { renderFacilitatorView } from "./views/facilitatorView.js";
import { renderHomeView } from "./views/homeView.js";
import { renderNotFoundView } from "./views/notFoundView.js";
import { renderSessionView } from "./views/sessionView.js";

const app = document.querySelector("#app");
const configBanner = document.querySelector("#config-banner");
const accountRegion = document.querySelector("#account-region");
let routeGeneration = 0;
let activeRoute = null;

function updateNavigation(route) {
  const canCreate = Boolean(getCurrentUser()?.memberships?.some((membership) => membership.role === "facilitator"));
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === "create") link.hidden = !canCreate;
    const active = link.dataset.nav === (route.name === "home" ? "home" : route.name === "create-session" ? "create" : "session");
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function updateConfigBanner() {
  if (isApiConfigured() && isGoogleAuthConfigured()) {
    configBanner.hidden = true;
    configBanner.replaceChildren();
    return;
  }
  configBanner.hidden = false;
  const strong = document.createElement("strong");
  strong.textContent = "API configuration is missing. ";
  const text = document.createElement("span");
  text.textContent = !isApiConfigured()
    ? "Set the Google Apps Script /exec URL as apiUrl in site/js/config.js. No network requests will be made until then."
    : "Set the Google OAuth web client ID as googleClientId in site/js/config.js.";
  configBanner.replaceChildren(strong, text);
}

async function routeToView(route, generation, { background = false, force = false } = {}) {
  if (generation !== routeGeneration) return;
  const activeElement = document.activeElement;
  if (background && !force && activeElement?.matches("input, textarea, select")) return;
  const refreshStatus = document.querySelector("#refresh-status");
  if (background && refreshStatus) refreshStatus.textContent = "Refreshing…";

  const isCurrent = () => generation === routeGeneration;
  const refresh = (forceRefresh = false) => routeToView(route, generation, { background: true, force: forceRefresh });
  const context = { app, route, isCurrent, refresh };
  try {
    switch (route.name) {
      case "home": await renderHomeView(context); break;
      case "create-session": await renderCreateSessionView(context); break;
      case "session": await renderSessionView(context); break;
      case "facilitate": await renderFacilitatorView(context); break;
      default: renderNotFoundView(context);
    }
  } finally {
    const currentStatus = document.querySelector("#refresh-status");
    if (currentStatus) currentStatus.textContent = "";
  }
}

async function handleRoute(route) {
  routeGeneration += 1;
  const generation = routeGeneration;
  activeRoute = route;
  stopPolling();
  clearFatalError();
  resetSessionState();
  setState({ route });
  app.replaceChildren();
  updateNavigation(route);
  window.scrollTo({ top: 0, behavior: "auto" });
  renderAccountControl(accountRegion);
  if (isApiConfigured() && !getCurrentUser()) {
    renderSignInView(app);
    return;
  }
  await routeToView(route, generation);
  if (generation !== routeGeneration) return;
  if (["session", "facilitate"].includes(route.name) && isApiConfigured()) {
    startPolling(() => routeToView(activeRoute, generation, { background: true }));
  }
}

initNotifications();
updateConfigBanner();
window.addEventListener("estimation-poker:auth-changed", () => {
  renderAccountControl(accountRegion);
  if (activeRoute) handleRoute(activeRoute);
});

await restoreAuthenticatedUser();
startRouter(handleRoute);
