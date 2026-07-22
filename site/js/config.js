export const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbyTJTFiuct48J2vCf5tVCkx5J7MmXcUYOgzpcQoiVW4M1CX9Pc8y7Y2Xg2OHls2Pikr/exec",
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
