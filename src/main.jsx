import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./styles.css";
import "./styles-app.css";
import "./styles-ops.css";
import "./styles-roles.css";
import { RouterProvider } from "./lib/router.jsx";
import { StoreProvider } from "./lib/store.jsx";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <RouterProvider>
    <StoreProvider>
      <App />
    </StoreProvider>
  </RouterProvider>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
