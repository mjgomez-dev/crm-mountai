// El tema del panel antes de pintar (sin destello blanco en el modo oscuro). Mismos valores que lib/tema.ts.
(function () {
  try {
    if (location.pathname.indexOf("/panel") !== 0) return;
    var p = localStorage.getItem("crm-tema") || "sistema";
    var oscuro = p === "oscuro" || (p === "sistema" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.tema = oscuro ? "oscuro" : "claro";
  } catch (e) {}
})();
