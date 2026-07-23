export const CONFIG = {
  supabaseUrl: "PASTE_HERE_THE_SUPABASE_URL",
  supabaseAnonKey: "PASTE_HERE_THE_SUPABASE_ANON_KEY",
  pollingIntervalMs: 3000,
  hiddenPollingIntervalMs: 15000,
  requestTimeoutMs: 15000,
};

export function isApiConfigured() {
  return Boolean(
    CONFIG.supabaseUrl
      && !CONFIG.supabaseUrl.includes("PASTE_HERE")
      && /^https:\/\//i.test(CONFIG.supabaseUrl)
      && CONFIG.supabaseAnonKey
      && !CONFIG.supabaseAnonKey.includes("PASTE_HERE"),
  );
}

export function isGoogleAuthConfigured() {
  return isApiConfigured();
}
