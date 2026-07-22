export const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbwRtFawUhC6m-fFOWMv5XWd2Nsz3u898oMVIjqAOhgrJQOZiYNgrDNEDHpji24d8As0/exec",
  googleClientId: "848494307751-1nik59q3dh1n6f13f6utejime4b2k5fv.apps.googleusercontent.com",
  pollingIntervalMs: 3000,
  hiddenPollingIntervalMs: 15000,
  requestTimeoutMs: 15000,
};

export function isApiConfigured() {
  return Boolean(
    CONFIG.apiUrl
      && !CONFIG.apiUrl.includes("PASTE_HERE")
      && /^https:\/\//i.test(CONFIG.apiUrl),
  );
}

export function isGoogleAuthConfigured() {
  return Boolean(
    CONFIG.googleClientId
      && !CONFIG.googleClientId.includes("PASTE_HERE")
      && CONFIG.googleClientId.endsWith(".apps.googleusercontent.com"),
  );
}
