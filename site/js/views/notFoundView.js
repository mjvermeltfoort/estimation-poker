import { el } from "../utils.js";

export function renderNotFoundView({ app }) {
  app.replaceChildren(
    el("section", { className: "empty-state" }, [
      el("p", { className: "eyebrow", text: "404" }),
      el("h1", { text: "This page does not exist" }),
      el("p", { text: "Check the link or return to the session overview." }),
      el("a", { className: "button button--primary", href: "#/", text: "Go to home page" }),
    ]),
  );
  document.title = "Page not found · Estimation Poker";
}
