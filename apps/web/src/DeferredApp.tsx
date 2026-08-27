import { lazy } from "react";

export const DeferredApp = lazy(async () => {
  const module = await import("./App");
  return { default: module.App };
});
