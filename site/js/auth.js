import { getMe, getSupabaseGoogleAuthorizeUrl } from "./api.js";
import { clearAuthSession, getAuthSession, getCurrentUser, setAuthSession } from "./authSession.js";
import { isGoogleAuthConfigured } from "./config.js";
import { el, errorMessage, setBusy } from "./utils.js";

const POST_AUTH_HASH_KEY = "estimationPoker.postAuthHash";

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

function consumeOauthHash() {
  const parsed = parseHashParams(window.location.hash);
  if (parsed.error) throw new Error(parsed.errorDescription || parsed.error);
  if (!parsed.accessToken || parsed.tokenType?.toLowerCase() !== "bearer") return null;

  const expiresAt = Number.isFinite(parsed.expiresIn) && parsed.expiresIn > 0
    ? Date.now() + (parsed.expiresIn * 1000)
    : Date.now() + (2 * 60 * 60 * 1000);

  const savedHash = window.sessionStorage.getItem(POST_AUTH_HASH_KEY) || "#/";
  window.sessionStorage.removeItem(POST_AUTH_HASH_KEY);
  window.location.hash = savedHash;

  return {
    token: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt,
    user: null,
  };
}

export async function signInWithGoogle() {
  if (!isGoogleAuthConfigured()) throw new Error("Supabase has not been configured.");
  window.sessionStorage.setItem(POST_AUTH_HASH_KEY, window.location.hash || "#/");
  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.location.assign(getSupabaseGoogleAuthorizeUrl(redirectTo));
}

export async function restoreAuthenticatedUser() {
  try {
    const oauthSession = consumeOauthHash();
    if (oauthSession) setAuthSession(oauthSession);
  } catch (error) {
    clearAuthSession();
    window.sessionStorage.removeItem(POST_AUTH_HASH_KEY);
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
