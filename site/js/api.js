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

function configuredUrl() {
  if (!isApiConfigured()) {
    throw new ApiError(
      "The Google Apps Script API has not been configured yet.",
      "NOT_CONFIGURED",
    );
  }

  try {
    return new URL(CONFIG.apiUrl);
  } catch (error) {
    throw new ApiError("The configured API URL is invalid.", "INVALID_CONFIG", 0, error);
  }
}

function createUrl(params) {
  const url = configuredUrl();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function parseResponse(response) {
  let payload;
  try {
    const text = await response.text();
    if (!text.trim()) {
      throw new ApiError("The server returned an empty response.", "EMPTY_RESPONSE", response.status);
    }
    payload = JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("The server did not return valid JSON.", "INVALID_JSON", response.status, error);
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || payload?.message || `The server responded with status ${response.status}.`,
      payload?.error?.code || "HTTP_ERROR",
      response.status,
      payload?.error?.details || payload,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError("The server response has an unexpected format.", "INVALID_RESPONSE", response.status);
  }
  if (payload.ok === false) {
    const error = new ApiError(
      payload.error?.message || payload.message || "The server rejected the operation.",
      payload.error?.code || payload.code || "API_ERROR",
      payload.error?.status || response.status,
      payload.error?.details || payload.details || null,
    );
    if (error.status === 401 || ["AUTH_REQUIRED", "INVALID_SESSION", "SESSION_EXPIRED"].includes(error.code)) {
      clearAuthSession();
    }
    throw error;
  }
  if (payload.ok !== true || !("data" in payload)) {
    throw new ApiError("The server response is missing required fields.", "INVALID_RESPONSE", response.status, payload);
  }
  return payload.data;
}

async function request({ method = "POST", params = {}, payload = null, authenticated = true }) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const options = { method, signal: controller.signal };
    let url = configuredUrl();
    if (method === "GET") {
      url = createUrl(params);
    } else {
      const body = { ...(payload || {}) };
      if (authenticated) {
        const authToken = getAuthToken();
        if (!authToken) throw new ApiError("Sign in to continue.", "AUTH_REQUIRED", 401);
        body.authToken = authToken;
      }
      options.headers = { "Content-Type": "text/plain;charset=utf-8" };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("API error", error);
      throw error;
    }
    const apiError = error?.name === "AbortError"
      ? new ApiError("The request timed out. Please try again.", "TIMEOUT")
      : new ApiError("Could not connect to the API. Check your network connection and the Apps Script deployment.", "NETWORK_ERROR", 0, error);
    console.error("API error", apiError);
    throw apiError;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getHealth() {
  return request({ method: "GET", params: { action: "health" }, authenticated: false });
}

export function exchangeGoogleCode(code, redirectOrigin) {
  return request({
    payload: { action: "authenticate", code, redirectOrigin },
    authenticated: false,
  });
}

export function getMe() {
  return request({ payload: { action: "me" } });
}

export function getHomeState(teamId = null) {
  return request({ payload: { action: "homeState", teamId } });
}

export function list(entity, filters = {}) {
  return request({ payload: { action: "list", entity, filters } });
}

export function get(entity, id) {
  return request({ payload: { action: "get", entity, id } });
}

export function create(entity, data, { includeSessionState = false } = {}) {
  return request({ method: "POST", payload: { action: "create", entity, data, includeSessionState } });
}

export function update(entity, id, data, { includeSessionState = false } = {}) {
  return request({ method: "POST", payload: { action: "update", entity, id, data, includeSessionState } });
}

export function remove(entity, id, { includeSessionState = false } = {}) {
  return request({ method: "POST", payload: { action: "delete", entity, id, includeSessionState } });
}

export function getSessionState(sessionId) {
  return request({ payload: { action: "sessionState", sessionId } });
}

export function activateTicket(sessionId, ticketId) {
  return request({ method: "POST", payload: { action: "activateTicket", sessionId, ticketId } });
}

export function submitVote(payload) {
  return request({ method: "POST", payload: { action: "submitVote", ...payload } });
}

export function revealTicket(ticketId, roundNumber, { includeSessionState = false } = {}) {
  return request({ method: "POST", payload: { action: "revealTicket", ticketId, roundNumber, includeSessionState } });
}

export function finalizeTicket(ticketId, finalEstimateHours, { includeSessionState = false } = {}) {
  return request({ method: "POST", payload: { action: "finalizeTicket", ticketId, finalEstimateHours, includeSessionState } });
}
