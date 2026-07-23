export const CONFIG = {
  supabaseUrl: "https://lwnhdeeupytcppdzyqlx.supabase.co",
  supabaseAnonKey: "sb_publishable_cihDHvRQCIvDh2oYrv5jlA_RG992svg",
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
