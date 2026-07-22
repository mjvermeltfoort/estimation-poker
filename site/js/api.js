import { CONFIG, isApiConfigured } from "./config.js";

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
      "De Google Apps Script API is nog niet geconfigureerd.",
      "NOT_CONFIGURED",
    );
  }

  try {
    return new URL(CONFIG.apiUrl);
  } catch (error) {
    throw new ApiError("De geconfigureerde API-URL is ongeldig.", "INVALID_CONFIG", 0, error);
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
      throw new ApiError("De server stuurde een lege response.", "EMPTY_RESPONSE", response.status);
    }
    payload = JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("De server stuurde geen geldige JSON.", "INVALID_JSON", response.status, error);
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || payload?.message || `De server antwoordde met status ${response.status}.`,
      payload?.error?.code || "HTTP_ERROR",
      response.status,
      payload?.error?.details || payload,
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError("De serverresponse heeft een onverwacht formaat.", "INVALID_RESPONSE", response.status);
  }
  if (payload.ok === false) {
    throw new ApiError(
      payload.error?.message || payload.message || "De bewerking is door de server geweigerd.",
      payload.error?.code || payload.code || "API_ERROR",
      response.status,
      payload.error?.details || payload.details || null,
    );
  }
  if (payload.ok !== true || !("data" in payload)) {
    throw new ApiError("De serverresponse mist verplichte velden.", "INVALID_RESPONSE", response.status, payload);
  }
  return payload.data;
}

async function request({ method = "GET", params = {}, payload = null }) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const options = { method, signal: controller.signal };
    let url = configuredUrl();
    if (method === "GET") {
      url = createUrl(params);
    } else {
      options.headers = { "Content-Type": "text/plain;charset=utf-8" };
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(url, options);
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("API-fout", error);
      throw error;
    }
    const apiError = error?.name === "AbortError"
      ? new ApiError("De aanvraag duurde te lang. Probeer het opnieuw.", "TIMEOUT")
      : new ApiError("Geen verbinding met de API. Controleer uw netwerk en de Apps Script-publicatie.", "NETWORK_ERROR", 0, error);
    console.error("API-fout", apiError);
    throw apiError;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getHealth() {
  return request({ params: { action: "health" } });
}

export function list(entity, filters = {}) {
  return request({ params: { action: "list", entity, ...filters } });
}

export function get(entity, id) {
  return request({ params: { action: "get", entity, id } });
}

export function create(entity, data) {
  return request({ method: "POST", payload: { action: "create", entity, data } });
}

export function update(entity, id, data) {
  return request({ method: "POST", payload: { action: "update", entity, id, data } });
}

export function remove(entity, id) {
  return request({ method: "POST", payload: { action: "delete", entity, id } });
}

export function getSessionState(sessionId) {
  return request({ params: { action: "sessionState", sessionId } });
}

export function submitVote(payload) {
  return request({ method: "POST", payload: { action: "submitVote", ...payload } });
}

export function revealTicket(ticketId, roundNumber) {
  return request({ method: "POST", payload: { action: "revealTicket", ticketId, roundNumber } });
}

export function finalizeTicket(ticketId, finalEstimateHours) {
  return request({ method: "POST", payload: { action: "finalizeTicket", ticketId, finalEstimateHours } });
}
