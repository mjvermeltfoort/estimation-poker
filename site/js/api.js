import { CONFIG, isApiConfigured } from "./config.js";
import { clearAuthSession, getAuthToken } from "./authSession.js";

export class ApiError extends Error {
  constructor(message, code = "UNKNOWN_ERROR", status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function toSnakeKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function toCamelKey(key) {
  return String(key).replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function mapObjectKeys(value, mapper) {
  if (Array.isArray(value)) return value.map((item) => mapObjectKeys(item, mapper));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [mapper(key), mapObjectKeys(inner, mapper)]));
}

function toDatabase(value) {
  return mapObjectKeys(value, toSnakeKey);
}

function toClient(value) {
  return mapObjectKeys(value, toCamelKey);
}

function configuredUrl() {
  if (!isApiConfigured()) {
    throw new ApiError(
      "Supabase has not been configured yet.",
      "NOT_CONFIGURED",
    );
  }

  try {
    return new URL(CONFIG.supabaseUrl);
  } catch (error) {
    throw new ApiError("The configured Supabase URL is invalid.", "INVALID_CONFIG", 0, error);
  }
}

function headers({ authenticated = true, contentType = "application/json" } = {}) {
  const base = {
    apikey: CONFIG.supabaseAnonKey,
  };
  if (contentType) base["Content-Type"] = contentType;

  if (!authenticated) return base;

  const authToken = getAuthToken();
  if (!authToken) throw new ApiError("Sign in to continue.", "AUTH_REQUIRED", 401);
  base.Authorization = `Bearer ${authToken}`;
  return base;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSupabaseError(status, payload) {
  const code = payload?.code || payload?.error_code || "HTTP_ERROR";
  const message = payload?.message || payload?.error_description || `The server responded with status ${status}.`;
  return new ApiError(message, code, status, payload);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let payload = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new ApiError("The server did not return valid JSON.", "INVALID_JSON", response.status, error);
    }
  }

  if (!response.ok) {
    throw normalizeSupabaseError(response.status, payload);
  }

  return payload;
}

async function request(path, {
  method = "GET",
  authenticated = true,
  body = null,
  query = {},
  accept = "application/json",
  contentType = "application/json",
} = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const baseUrl = configuredUrl();
    const url = new URL(path, `${baseUrl.toString().replace(/\/$/, "")}/`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const requestHeaders = {
      ...headers({ authenticated, contentType }),
      Accept: accept,
      Prefer: "return=representation",
    };

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body === null ? null : JSON.stringify(body),
      signal: controller.signal,
    });

    return await parseJsonResponse(response);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || ["invalid_token", "JWT_INVALID"].includes(error.code)) {
        clearAuthSession();
      }
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new ApiError("The request timed out. Please try again.", "TIMEOUT");
    }

    throw new ApiError("Could not connect to Supabase. Check your network connection and configuration.", "NETWORK_ERROR", 0, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function getUserIdentity(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name || user.user_metadata?.full_name || user.email,
    memberships: normalizeList(user.memberships),
  };
}

async function rpc(functionName, params = {}, { authenticated = true } = {}) {
  const payload = await request(`rest/v1/rpc/${functionName}`, {
    method: "POST",
    authenticated,
    body: params,
  });
  return payload;
}

export function getHealth() {
  return request("rest/v1/", { method: "GET", authenticated: false }).then(() => ({ apiVersion: "supabase", timestamp: new Date().toISOString() }));
}

export function exchangeGoogleCode() {
  throw new ApiError("Code-exchange sign-in is no longer used. Use Supabase redirect sign-in.", "UNSUPPORTED_FLOW", 400);
}

export async function getMe() {
  const payload = await rpc("me", {}, { authenticated: true });
  if (!payload || !isObject(payload)) {
    throw new ApiError("The user profile response has an unexpected format.", "INVALID_RESPONSE", 500, payload);
  }
  return getUserIdentity(payload);
}

export function getHomeState(teamId = null) {
  return rpc("home_state", { p_team_id: teamId || null }).then(toClient);
}

export function getAdminState(teamId = null) {
  return rpc("admin_state", { p_team_id: teamId || null }).then(toClient);
}

export function getAdminTeamSettings(teamId) {
  return rpc("admin_get_team_settings", { p_team_id: teamId }).then(toClient);
}

export function updateAdminTeamSettings({ teamId, jiraBaseUrl }) {
  return rpc("admin_update_team_settings", {
    p_team_id: teamId,
    p_jira_base_url: jiraBaseUrl,
  }).then(toClient);
}

export function getProjectsState(teamId, includeArchived = false) {
  return rpc("projects_state", {
    p_team_id: teamId,
    p_include_archived: Boolean(includeArchived),
  }).then(toClient);
}

export function upsertProject({ teamId, name, jiraProjectKey, projectId = null, isArchived = false }) {
  return rpc("upsert_project", {
    p_team_id: teamId,
    p_name: name,
    p_jira_project_key: jiraProjectKey,
    p_project_id: projectId,
    p_is_archived: Boolean(isArchived),
  }).then(toClient);
}

export function adminUpsertTeamMember({ teamId, email, displayName, role, active = true }) {
  return rpc("admin_upsert_team_member", {
    p_team_id: teamId,
    p_email: email,
    p_display_name: displayName || null,
    p_role: role,
    p_active: Boolean(active),
  }).then(toClient);
}

export function adminUpdateTeamMember({ teamMemberId, role = null, active = null, displayName = null }) {
  return rpc("admin_update_team_member", {
    p_team_member_id: teamMemberId,
    p_role: role,
    p_active: active,
    p_display_name: displayName,
  }).then(toClient);
}

export function getSessionState(sessionId) {
  return rpc("session_state", { p_session_id: sessionId }).then(toClient);
}

export function createSession({ teamId, name }) {
  return rpc("create_session", {
    p_team_id: teamId,
    p_name: name,
  }).then(toClient);
}

export function createEstimationTicket({ sessionId, projectId, ticketNumber, summary, description = "", status = "pending", sortOrder = 1, createdAt = null }) {
  return rpc("create_estimation_ticket", {
    p_session_id: sessionId,
    p_project_id: projectId,
    p_ticket_number: ticketNumber,
    p_summary: summary,
    p_description: description,
    p_status: status,
    p_sort_order: sortOrder,
    p_created_at: createdAt,
  }).then(toClient);
}

export function activateTicket(sessionId, ticketId) {
  return rpc("activate_ticket", { p_session_id: sessionId, p_ticket_id: ticketId }).then(toClient);
}

export function restartTicketVoting(ticketId) {
  return rpc("restart_ticket_voting", { p_ticket_id: ticketId }).then(toClient);
}

export function submitVote(payload) {
  return rpc("submit_vote", {
    p_session_id: payload.sessionId,
    p_ticket_id: payload.ticketId,
    p_round_number: payload.roundNumber,
    p_estimate_hours: payload.estimateHours,
  }).then(toClient);
}

export function revealTicket(ticketId, roundNumber) {
  return rpc("reveal_ticket", { p_ticket_id: ticketId, p_round_number: roundNumber }).then(toClient);
}

export function finalizeTicket(ticketId, finalEstimateHours) {
  return rpc("finalize_ticket", { p_ticket_id: ticketId, p_final_estimate_hours: finalEstimateHours }).then(toClient);
}

export function completeSession(sessionId) {
  return rpc("complete_session", { p_session_id: sessionId }).then(toClient);
}

export function getSupabaseGoogleAuthorizeUrl(redirectTo, { codeChallenge = null } = {}) {
  const baseUrl = configuredUrl();
  const url = new URL("auth/v1/authorize", `${baseUrl.toString().replace(/\/$/, "")}/`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectTo);
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export async function exchangeSupabaseAuthCode(authCode, codeVerifier) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const baseUrl = configuredUrl();
    const url = new URL("auth/v1/token", `${baseUrl.toString().replace(/\/$/, "")}/`);
    url.searchParams.set("grant_type", "pkce");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers({ authenticated: false }),
        Accept: "application/json",
      },
      body: JSON.stringify({
        auth_code: authCode,
        code_verifier: codeVerifier,
      }),
      signal: controller.signal,
    });

    return await parseJsonResponse(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") {
      throw new ApiError("The request timed out. Please try again.", "TIMEOUT");
    }
    throw new ApiError("Could not connect to Supabase. Check your network connection and configuration.", "NETWORK_ERROR", 0, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}
