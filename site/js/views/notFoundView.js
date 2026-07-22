import { el } from "../utils.js";

export function renderNotFoundView({ app }) {
  app.replaceChildren(
    el("section", { className: "empty-state" }, [
      el("p", { className: "eyebrow", text: "404" }),
      el("h1", { text: "Deze pagina bestaat niet" }),
      el("p", { text: "Controleer de link of ga terug naar het sessieoverzicht." }),
      el("a", { className: "button button--primary", href: "#/", text: "Naar startpagina" }),
    ]),
  );
  document.title = "Pagina niet gevonden · Estimation Poker";
}
