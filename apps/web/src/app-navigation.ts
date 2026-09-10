export type Screen =
  | "dashboard"
  | "goals"
  | "holdings"
  | "obligations"
  | "watch"
  | "evidence"
  | "scenarios"
  | "history";

type NavigationItem = {
  id: Screen;
  label: string;
  index: string;
};

export const navigation = [
  { id: "dashboard", label: "Overview", index: "01" },
  { id: "goals", label: "Goals", index: "02" },
  { id: "holdings", label: "Holdings", index: "03" },
  { id: "obligations", label: "Obligations", index: "04" },
  { id: "watch", label: "Portfolio Watch", index: "05" },
  { id: "evidence", label: "Evidence Inbox", index: "06" },
  { id: "scenarios", label: "Scenarios", index: "07" },
  { id: "history", label: "Forecast History", index: "08" },
] as const satisfies readonly NavigationItem[];

export const holdingsNavigation = [
  { id: "overview", label: "Holdings", path: "/holdings" },
  { id: "entities", label: "Legal entities", path: "/holdings/entities" },
  { id: "sources", label: "Sources", path: "/holdings/sources" },
] as const;

export type HoldingsView = (typeof holdingsNavigation)[number]["id"];

export function isHoldingsPath(pathname: string): boolean {
  return /^\/holdings(?:\/|$)/u.test(pathname);
}

export function pageHeading(screen: Screen): string {
  return navigation.find((item) => item.id === screen)?.label ?? "Keel";
}

export function pathForScreen(screen: Screen): string {
  return screen === "dashboard" ? "/" : `/${screen}`;
}
