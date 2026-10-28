import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "@fontsource-variable/jetbrains-mono";
import "./app/styles.css";
import { router } from "./app/router.tsx";
import { applyStoredTheme } from "./app/theme.ts";

applyStoredTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline caching is optional; the app remains usable without registration.
    });
  });
}
