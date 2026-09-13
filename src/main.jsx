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
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  // Cuando se instala una versión nueva, se recarga una vez para no mezclar código viejo y nuevo.
  // Solo si ya había una versión controlando la página (en la primera instalación no hay que recargar).
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    location.reload();
  });
}
