import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "./styles.css";
import "./styles-app.css";
import "./styles-ops.css";
import "./styles-roles.css";
import "./styles-ui.css";
import "./styles-2026.css";
import { RouterProvider } from "./lib/router.jsx";
import { StoreProvider } from "./lib/store.jsx";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <RouterProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </RouterProvider>
  </ErrorBoundary>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      // Una pestaña abierta todo el día no vuelve a chequear si hay versión nueva: se chequea al
      // volver a la pestaña y cada 15 minutos; al instalarse, controllerchange recarga una vez.
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      window.addEventListener("focus", check);
      setInterval(check, 15 * 60000);
    })
    .catch(() => {});
  // Cuando se instala una versión nueva, se recarga una vez para no mezclar código viejo y nuevo.
  // Solo si ya había una versión controlando la página (en la primera instalación no hay que recargar).
  //
  // Pero NO se recarga mientras la persona está en el medio de algo: escribiendo un peso, con una
  // ventana abierta o con pesadas sin enviar. En ese caso se espera y se recarga cuando queda
  // libre, o en la próxima vez que abra la app (PC-019).
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  const ocupado = () => {
    const foco = document.activeElement;
    const escribiendo =
      foco &&
      (foco.tagName === "INPUT" ||
        foco.tagName === "TEXTAREA" ||
        foco.tagName === "SELECT" ||
        foco.isContentEditable);
    const ventanaAbierta = !!document.querySelector("dialog[open]");
    let colaPendiente = false;
    try {
      colaPendiente =
        JSON.parse(localStorage.getItem("pc-outbox") || "[]").length > 0;
    } catch {
      colaPendiente = false;
    }
    return escribiendo || ventanaAbierta || colaPendiente;
  };
  const recargarCuandoSeaSeguro = () => {
    if (refreshing) return;
    if (ocupado()) {
      setTimeout(recargarCuandoSeaSeguro, 5000);
      return;
    }
    refreshing = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    recargarCuandoSeaSeguro();
  });
}
