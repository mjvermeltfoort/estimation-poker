import { exchangeSupabaseAuthCode, getMe, getSupabaseGoogleAuthorizeUrl } from "./api.js";
import { clearAuthSession, getAuthSession, getCurrentUser, setAuthSession } from "./authSession.js";
import { isGoogleAuthConfigured } from "./config.js";
import { el, errorMessage, setBusy } from "./utils.js";

const POST_AUTH_HASH_KEY = "estimationPoker.postAuthHash";
const PKCE_VERIFIER_KEY = "estimationPoker.pkceVerifier";

function parseHashParams(hash) {
  const source = String(hash || "").startsWith("#") ? String(hash).slice(1) : String(hash || "");
  const params = new URLSearchParams(source);
  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    expiresIn: Number(params.get("expires_in")),
    tokenType: params.get("token_type"),
    type: params.get("type"),
    error: params.get("error"),
    errorDescription: params.get("error_description"),
  };
}

function parseSearchParams(search) {
  const source = String(search || "").startsWith("?") ? String(search).slice(1) : String(search || "");
  const params = new URLSearchParams(source);
  return {
    code: params.get("code"),
    error: params.get("error"),
    errorDescription: params.get("error_description"),
  };
}

function buildSessionFromTokens(accessToken, refreshToken, expiresIn) {
  const expiresAt = Number.isFinite(Number(expiresIn)) && Number(expiresIn) > 0
    ? Date.now() + (Number(expiresIn) * 1000)
    : Date.now() + (2 * 60 * 60 * 1000);

  return {
    token: accessToken,
    refreshToken: refreshToken || null,
    expiresAt,
    user: null,
  };
}

function clearOauthTracking() {
  window.sessionStorage.removeItem(POST_AUTH_HASH_KEY);
  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
}

function restoreSavedHash() {
  const savedHash = window.sessionStorage.getItem(POST_AUTH_HASH_KEY) || "#/";
  window.history.replaceState({}, document.title, `${window.location.pathname}${savedHash}`);
  clearOauthTracking();
}

function base64UrlEncode(bytes) {
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createPkceChallenge() {
  const verifierBytes = new Uint8Array(32);
  window.crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes);

  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

async function consumeOauthCallback() {
  const hashParams = parseHashParams(window.location.hash);
  const searchParams = parseSearchParams(window.location.search);
  const callbackError = hashParams.error || searchParams.error;
  if (callbackError) throw new Error(hashParams.errorDescription || searchParams.errorDescription || callbackError);

  if (hashParams.accessToken && hashParams.tokenType?.toLowerCase() === "bearer") {
    const session = buildSessionFromTokens(hashParams.accessToken, hashParams.refreshToken, hashParams.expiresIn);
    restoreSavedHash();
    return session;
  }

  if (!searchParams.code) return null;
  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!verifier) {
    throw new Error("OAuth code verifier is missing. Please try signing in again.");
  }

  const exchanged = await exchangeSupabaseAuthCode(searchParams.code, verifier);
  if (!exchanged?.access_token || String(exchanged.token_type || "").toLowerCase() !== "bearer") {
    throw new Error("Supabase did not return a valid OAuth session.");
  }

  const session = buildSessionFromTokens(exchanged.access_token, exchanged.refresh_token, exchanged.expires_in);
  restoreSavedHash();
  return session;
}

export async function signInWithGoogle() {
  if (!isGoogleAuthConfigured()) throw new Error("Supabase has not been configured.");
  const { verifier, challenge } = await createPkceChallenge();
  window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(POST_AUTH_HASH_KEY, window.location.hash || "#/");
  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.assign(getSupabaseGoogleAuthorizeUrl(redirectTo, { codeChallenge: challenge }));
}

export async function restoreAuthenticatedUser() {
  try {
    const oauthSession = await consumeOauthCallback();
    if (oauthSession) setAuthSession(oauthSession);
  } catch (error) {
    clearAuthSession();
    clearOauthTracking();
    window.location.hash = "#/";
    return null;
  }

  if (!getAuthSession()) return null;
  try {
    const user = await getMe();
    const session = getAuthSession();
    if (!session) return null;
    setAuthSession({ ...session, user });
    return user;
  } catch (error) {
    clearAuthSession();
    return null;
  }
}

export function signOut() {
  clearAuthSession();
}

export function renderAccountControl(container) {
  const user = getCurrentUser();
  if (!user) {
    container.replaceChildren();
    return;
  }
  const button = el("button", { className: "account-control__signout", type: "button", text: "Sign out" });
  button.addEventListener("click", signOut);
  container.replaceChildren(
    el("span", { className: "account-control__identity" }, [
      el("strong", { text: user.displayName || user.email }),
      el("span", { text: user.email }),
    ]),
    button,
  );
}

export function renderSignInView(app) {
  document.title = "Sign in · Estimation Poker";
  const error = el("p", { className: "field-error", role: "alert" });
  const button = el("button", {
    className: "button button--primary google-signin",
    type: "button",
    text: "Continue with Google",
    disabled: !isGoogleAuthConfigured(),
  });
  button.addEventListener("click", async () => {
    error.textContent = "";
    setBusy(button, true, "Signing in…");
    try {
      await signInWithGoogle();
    } catch (signInError) {
      error.textContent = errorMessage(signInError);
      setBusy(button, false);
    }
  });

  const configurationMessage = !isGoogleAuthConfigured()
    ? el("p", { className: "inline-warning", text: "Set supabaseUrl and supabaseAnonKey in site/js/config.js before signing in." })
    : null;
  app.replaceChildren(el("section", { className: "signin-card panel" }, [
    el("p", { className: "eyebrow", text: "Secure team access" }),
    el("h1", { text: "Sign in to Estimation Poker" }),
    el("p", { className: "lead", text: "Use the Google account invited through your team-member email address." }),
    button,
    error,
    configurationMessage,
  ]));
}
