import { isHoldingsPath } from "./app-navigation";
import { HoldingsInitialShell, LoadingShell } from "./RouteShells";

export function InitialShell() {
  if (isHoldingsPath(window.location.pathname)) {
    return <HoldingsInitialShell />;
  }
  return <LoadingShell />;
}
