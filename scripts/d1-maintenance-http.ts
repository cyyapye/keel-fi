export const D1_MAINTENANCE_METADATA_MAX_BYTES = 64 * 1024;

export async function readMaintenanceJson(
  response: Response,
): Promise<unknown> {
  const declared = response.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declared) ||
      !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > D1_MAINTENANCE_METADATA_MAX_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("D1 maintenance response exceeded its envelope.");
  }
  if (response.body === null)
    throw new Error("D1 maintenance response is unavailable.");
  const reader = response.body.getReader();
  const buffer = new Uint8Array(D1_MAINTENANCE_METADATA_MAX_BYTES);
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read().catch(() => {
        throw new Error("D1 maintenance response is unavailable.");
      });
      if (part.done) break;
      if (part.value.byteLength > buffer.byteLength - bytes)
        throw new Error("D1 maintenance response exceeded its envelope.");
      buffer.set(part.value, bytes);
      bytes += part.value.byteLength;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, bytes),
        ),
      ) as unknown;
    } catch {
      throw new Error("D1 maintenance response is invalid.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
