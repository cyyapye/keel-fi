import { requestKeel } from "./api-request";
import { isHoldingsPath } from "./app-navigation";

let alphaPreload: Promise<Response | null> | null = null;
let holdingsPagePreload: Promise<Response | null> | null = null;
let legalEntitiesPreload: Promise<Response | null> | null = null;

export function startInitialDataPreload(): void {
  if (window.location.pathname === "/holdings/entities") {
    legalEntitiesPreload = preload("/api/legal-entities");
    return;
  }
  if (isHoldingsPath(window.location.pathname)) {
    holdingsPagePreload = preload("/api/holdings-page");
    return;
  }
  alphaPreload = preload("/api/alpha");
}

function preload(path: string): Promise<Response | null> {
  return requestKeel(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).catch(() => null);
}

export function takeAlphaPreload(): Promise<Response | null> | null {
  const request = alphaPreload;
  alphaPreload = null;
  return request;
}

export function takeHoldingsPagePreload(): Promise<Response | null> | null {
  const request = holdingsPagePreload;
  holdingsPagePreload = null;
  return request;
}

export function takeLegalEntitiesPreload(): Promise<Response | null> | null {
  const request = legalEntitiesPreload;
  legalEntitiesPreload = null;
  return request;
}
