import type { z } from "zod";

// Keep capture receipts in this tab. A blocked storage API still permits a
// complete in-memory example until the page is closed or reloaded.
const memory = new Map<string, string>();
export function readExample<T>(
  key: string,
  schema: z.ZodType<T>,
  initial: () => T,
): T {
  let data = memory.get(key);
  try {
    data = sessionStorage.getItem(key) ?? data;
  } catch {
    /* use this page's copy */
  }
  if (!data) return initial();
  try {
    const parsed = schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : initial();
  } catch {
    return initial();
  }
}
export function saveExample(key: string, value: unknown) {
  const json = JSON.stringify(value);
  memory.set(key, json);
  try {
    sessionStorage.setItem(key, json);
  } catch {
    /* keep the in-memory copy */
  }
}
export function exampleReadback() {
  return new Promise<void>((resolve) => setTimeout(resolve, 125));
}
