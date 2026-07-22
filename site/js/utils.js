export const VOTE_VALUES = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40];

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && key !== "role") node[key] = value;
    else node.setAttribute(key, String(value));
  });
  const values = Array.isArray(children) ? children : [children];
  values.filter((child) => child !== null && child !== undefined).forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const formatted = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(number);
  return `${formatted} ${number === 1 ? "hour" : "hours"}`;
}

export function statusLabel(status) {
  return ({
    draft: "Draft", active: "Active", completed: "Completed", cancelled: "Cancelled",
    pending: "Open", voting: "Voting", revealed: "Revealed", estimated: "Estimated", skipped: "Skipped",
  })[status] || status || "Unknown";
}

export function statusBadge(status) {
  return el("span", { className: `badge badge--${status || "unknown"}`, text: statusLabel(status) });
}

export function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

export function sortTickets(tickets = []) {
  return [...tickets].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
    return orderA - orderB || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

export function calculateStatistics(votes = []) {
  const values = votes.map((vote) => Number(vote.estimateHours)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return { count: 0, min: null, max: null, average: null, median: null };
  const middle = Math.floor(values.length / 2);
  return {
    count: values.length,
    min: values[0],
    max: values[values.length - 1],
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
  };
}

export function safeJiraUrl(baseUrl, issueKey) {
  if (!baseUrl || !issueKey) return null;
  try {
    const base = new URL(baseUrl);
    if (!/^https?:$/.test(base.protocol)) return null;
    const normalized = base.toString().replace(/\/$/, "");
    return new URL(`${normalized}/browse/${encodeURIComponent(issueKey)}`);
  } catch {
    return null;
  }
}

export function setBusy(buttons, busy, busyLabel = "Working…") {
  const values = Array.isArray(buttons) ? buttons : [buttons];
  values.forEach((button) => {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = busyLabel;
    } else if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
    button.disabled = busy;
  });
}

export function errorMessage(error) {
  return error?.message || "An unexpected error occurred.";
}
