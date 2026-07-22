import { exchangeGoogleCode, getMe } from "./api.js";
import { clearAuthSession, getAuthSession, getCurrentUser, setAuthSession } from "./authSession.js";
import { CONFIG, isGoogleAuthConfigured } from "./config.js";
import { el, errorMessage, setBusy } from "./utils.js";

let googleLibraryPromise = null;

function loadGoogleLibrary() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleLibraryPromise) return googleLibraryPromise;

  googleLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Google Sign-In could not be loaded.")), { once: true });
    document.head.append(script);
  });
  return googleLibraryPromise;
}

export async function signInWithGoogle() {
  if (!isGoogleAuthConfigured()) throw new Error("The Google OAuth client ID has not been configured.");
  await loadGoogleLibrary();

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: CONFIG.googleClientId,
      scope: "openid email profile",
      ux_mode: "popup",
      prompt: "select_account",
      callback: async (response) => {
        if (response.error || !response.code) {
          reject(new Error(response.error_description || response.error || "Google Sign-In was cancelled."));
          return;
        }
        try {
          const session = await exchangeGoogleCode(response.code, window.location.origin);
          setAuthSession(session);
          resolve(session.user);
        } catch (error) {
          reject(error);
        }
      },
      error_callback: (error) => {
        reject(new Error(error?.type === "popup_closed"
          ? "The Google Sign-In window was closed."
          : "Google Sign-In could not be opened."));
      },
    });
    client.requestCode();
  });
}

export async function restoreAuthenticatedUser() {
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
    ? el("p", { className: "inline-warning", text: "Set googleClientId in site/js/config.js before signing in." })
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
