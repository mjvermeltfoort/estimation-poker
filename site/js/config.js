export const CONFIG = {
  apiUrl: "PLAATS_HIER_DE_GOOGLE_APPS_SCRIPT_EXEC_URL",
  pollingIntervalMs: 3000,
  hiddenPollingIntervalMs: 15000,
  requestTimeoutMs: 15000,
};

export function isApiConfigured() {
  return Boolean(
    CONFIG.apiUrl
      && !CONFIG.apiUrl.includes("PLAATS_HIER")
      && /^https:\/\//i.test(CONFIG.apiUrl),
  );
}
