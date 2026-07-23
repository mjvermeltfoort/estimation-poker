const ROUTES = [
  { name: "home", pattern: /^\/$/ },
  { name: "create-session", pattern: /^\/sessions\/new$/ },
  { name: "admin", pattern: /^\/admin$/ },
  { name: "admin-settings", pattern: /^\/admin\/settings$/ },
  { name: "session", pattern: /^\/session\/([^/]+)$/ , params: ["sessionId"] },
  { name: "facilitate", pattern: /^\/facilitate\/([^/]+)$/ , params: ["sessionId"] },
];

export function getHashQueryParams(hash = window.location.hash) {
  const query = hash.replace(/^#/, "").split("?")[1] || "";
  return new URLSearchParams(query);
}

export function parseHashRoute(hash = window.location.hash) {
  const raw = hash.replace(/^#/, "") || "/";
  const [rawPath] = raw.split("?");
  let path;
  try {
    path = decodeURI(rawPath || "/").replace(/\/+$/, "") || "/";
  } catch (error) {
    console.warn("Invalid route encoding.", error);
    return { name: "not-found", path: rawPath, params: {}, query: new URLSearchParams() };
  }

  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;
    const params = {};
    (route.params || []).forEach((name, index) => {
      try {
        params[name] = decodeURIComponent(match[index + 1]);
      } catch {
        params[name] = match[index + 1];
      }
    });
    return { ...route, path, params, query: getHashQueryParams(hash) };
  }
  return { name: "not-found", path, params: {}, query: getHashQueryParams(hash) };
}

export function navigateTo(path) {
  const target = path.startsWith("#") ? path : `#${path.startsWith("/") ? path : `/${path}`}`;
  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}

export function startRouter(onRoute) {
  const handleRoute = () => onRoute(parseHashRoute());
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
  return () => window.removeEventListener("hashchange", handleRoute);
}
