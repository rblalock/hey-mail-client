import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AccountGate } from "./components/AccountControl";
import { previewApi } from "./preview";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root is missing.");

if (!window.heyAgent && import.meta.env.DEV && new URLSearchParams(window.location.search).has("preview")) {
  window.heyAgent = previewApi();
}

createRoot(root).render(
  <StrictMode>
    {window.heyAgent.profiles.current.active ? <App /> : <AccountGate />}
  </StrictMode>,
);
