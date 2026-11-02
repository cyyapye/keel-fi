import {
  CAPACITY_MAX_BYTES,
  type CapacityLedger,
  type CapacityStore,
} from "../packages/database/src/d1-capacity";
import { CapacityKeyPattern } from "../packages/database/src/d1-capacity-r2";

export function nodeCapacityStore(
  request: (key: string, init?: RequestInit) => Promise<Response>,
  key: string,
): CapacityStore {
  if (!CapacityKeyPattern.test(key))
    throw new Error("Invalid capacity owner key");
  return {
    async read() {
      const response = await request(key, { method: "GET" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Capacity owner is unavailable");
      const version = response.headers.get("ETag");
      const declared = response.headers.get("Content-Length");
      if (
        declared !== null &&
        (!/^\d+$/u.test(declared) || Number(declared) > CAPACITY_MAX_BYTES)
      )
        throw new Error("Capacity owner is too large");
      if (version === null || !/^"[!#-~]{1,252}"$/u.test(version))
        throw new Error("Capacity owner has no version");
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error("Capacity owner is empty");
      const decoder = new TextDecoder();
      let body = "";
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > CAPACITY_MAX_BYTES)
            throw new Error("Capacity owner is too large");
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      return { version, value: JSON.parse(body) as unknown };
    },
    async compareAndWrite(expected: string | null, value: CapacityLedger) {
      const body = JSON.stringify(value);
      if (new TextEncoder().encode(body).length > CAPACITY_MAX_BYTES)
        throw new Error("Capacity owner is too large");
      try {
        const response = await request(key, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(expected === null
              ? { "If-None-Match": "*" }
              : { "If-Match": expected }),
          },
          body,
        });
        if (response.status === 412) return "conflict";
        return response.ok ? "committed" : "unknown";
      } catch {
        return "unknown";
      }
    },
  };
}
