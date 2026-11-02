import {
  CAPACITY_MAX_BYTES,
  type CapacityLedger,
  type CapacityStore,
} from "./d1-capacity";

export const CapacityKeyPattern =
  /^operations\/d1-capacity\/[a-z0-9-]{1,64}\.json$/u;

export function workerCapacityStore(
  bucket: R2Bucket,
  key: string,
): CapacityStore {
  if (!CapacityKeyPattern.test(key))
    throw new Error("Invalid capacity owner key");
  return {
    async read() {
      const object = await bucket.get(key);
      if (object === null) return null;
      if (object.size > CAPACITY_MAX_BYTES)
        throw new Error("Capacity owner is too large");
      return { version: object.etag, value: await object.json() };
    },
    async compareAndWrite(expected: string | null, value: CapacityLedger) {
      const body = JSON.stringify(value);
      if (new TextEncoder().encode(body).length > CAPACITY_MAX_BYTES)
        throw new Error("Capacity owner is too large");
      try {
        const object = await bucket.put(key, body, {
          onlyIf:
            expected === null
              ? { etagDoesNotMatch: "*" }
              : { etagMatches: expected },
          httpMetadata: { contentType: "application/json" },
        });
        return object === null ? "conflict" : "committed";
      } catch {
        return "unknown";
      }
    },
  };
}
