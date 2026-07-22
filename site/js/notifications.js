let toastRegion;
let fatalRegion;
const MAX_TOASTS = 4;

export function initNotifications() {
  toastRegion = document.querySelector("#toast-region");
  fatalRegion = document.querySelector("#fatal-region");
}

export function showToast(message, type = "info") {
  if (!toastRegion) return;
  while (toastRegion.children.length >= MAX_TOASTS) {
    toastRegion.firstElementChild?.remove();
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const text = document.createElement("span");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast__close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "×";
  close.addEventListener("click", () => toast.remove());
  toast.append(text, close);
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 5000);
}

export function showFatalError(message, details = "") {
  if (!fatalRegion) return;
  fatalRegion.replaceChildren();
  const card = document.createElement("section");
  card.className = "fatal-error";
  card.setAttribute("role", "alert");
  const title = document.createElement("strong");
  title.textContent = message;
  card.append(title);
  if (details) {
    const detail = document.createElement("p");
    detail.textContent = details;
    card.append(detail);
  }
  fatalRegion.append(card);
}

export function clearFatalError() {
  fatalRegion?.replaceChildren();
}
