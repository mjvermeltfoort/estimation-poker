import { el, errorMessage } from "../utils.js";

export function renderErrorView({ app, title = "Er ging iets mis", error, retry = null }) {
  const card = el("section", { className: "error-card" }, [
    el("p", { className: "eyebrow", text: "Niet beschikbaar" }),
    el("h1", { text: title }),
    el("p", { text: errorMessage(error) }),
  ]);
  const actions = el("div", { className: "button-row" });
  if (retry) {
    const retryButton = el("button", { className: "button button--primary", type: "button", text: "Opnieuw proberen" });
    retryButton.addEventListener("click", retry);
    actions.append(retryButton);
  }
  actions.append(el("a", { className: "button button--secondary", href: "#/", text: "Naar startpagina" }));
  card.append(actions);
  app.replaceChildren(card);
  document.title = `${title} · Estimation Poker`;
}
