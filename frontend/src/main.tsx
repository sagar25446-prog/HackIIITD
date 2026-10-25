import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import Helper from "./workspace/Helper";
import App from "./App";
import "./index.css";
import { Provider } from "./state";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname.startsWith("/helper/") ? (
      <Helper />
    ) : (
      <Provider>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </Provider>
    )}
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => null),
  );
}
