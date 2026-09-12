import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import "@keel/ui/styles.css";
import { AppRecovery, ErrorBoundary } from "./AppRecovery";
import { DeferredApp } from "./DeferredApp";
import { InitialShell } from "./InitialShell";
import { startInitialDataPreload } from "./initial-data";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (root === null) {
  throw new Error("Keel root element is missing.");
}

startInitialDataPreload();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<AppRecovery />}>
      <Suspense fallback={<InitialShell />}>
        <DeferredApp />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
