import { el, errorMessage } from "../utils.js";

export function renderErrorView({ app, title = "Something went wrong", error, retry = null }) {
  const card = el("section", { className: "error-card" }, [
    el("p", { className: "eyebrow", text: "Unavailable" }),
    el("h1", { text: title }),
    el("p", { text: errorMessage(error) }),
  ]);
  const actions = el("div", { className: "button-row" });
  if (retry) {
    const retryButton = el("button", { className: "button button--primary", type: "button", text: "Try again" });
    retryButton.addEventListener("click", retry);
    actions.append(retryButton);
  }
  actions.append(el("a", { className: "button button--secondary", href: "#/", text: "Go to home page" }));
  card.append(actions);
  app.replaceChildren(card);
  document.title = `${title} · Estimation Poker`;
}
