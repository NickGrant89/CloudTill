import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { persistAuthToken } from "./offline/db";
import { registerTillServiceWorker, requestPersistentStorage } from "./offline/durable";
import { getToken } from "./api";
import "./styles.css";

void requestPersistentStorage();
void registerTillServiceWorker();
void persistAuthToken(getToken());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
