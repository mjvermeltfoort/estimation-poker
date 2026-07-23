const AUTH_SESSION_KEY = "estimationPoker.authSession";

let memorySession = null;

function readStoredSession() {
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.token || !Number.isFinite(Number(value.expiresAt))) return null;
    if (Number(value.expiresAt) <= Date.now()) return null;
    return value;
  } catch (error) {
    console.warn("The saved sign-in session could not be read.", error);
    return null;
  }
}

export function getAuthSession() {
  if (!memorySession) memorySession = readStoredSession();
  if (memorySession && Number(memorySession.expiresAt) <= Date.now()) {
    clearAuthSession();
  }
  return memorySession;
}

export function getAuthToken() {
  return getAuthSession()?.token || null;
}

export function getCurrentUser() {
  return getAuthSession()?.user || null;
}

export function setAuthSession(session) {
  const normalized = {
    token: String(session.token),
    expiresAt: Number(session.expiresAt),
    refreshToken: session.refreshToken ? String(session.refreshToken) : null,
    user: session.user || null,
  };
  memorySession = normalized;
  window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("estimation-poker:auth-changed"));
  return normalized;
}

export function clearAuthSession() {
  const hadSession = Boolean(memorySession || readStoredSession());
  memorySession = null;
  try {
    window.sessionStorage.removeItem(AUTH_SESSION_KEY);
  } catch (error) {
    console.warn("The sign-in session could not be removed.", error);
  }
  if (hadSession) window.dispatchEvent(new CustomEvent("estimation-poker:auth-changed"));
}
