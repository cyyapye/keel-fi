import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { z } from "zod";

export const maxImageBytes = 16 * 1024 * 1024;
export const maxPackedBytes = 256 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const snapshotSchema = z
  .object({
    keys: z.tuple([digestSchema, digestSchema]).readonly(),
    bytes: z.number().int().positive().max(maxImageBytes),
    sha256: digestSchema,
    packed: z
      .base64()
      .min(4)
      .max(4 * Math.ceil(maxPackedBytes / 3))
      .refine(
        (encoded) => Buffer.byteLength(encoded, "base64") <= maxPackedBytes,
      ),
  })
  .strict()
  .readonly();

export type SqliteFixtureSnapshot = z.infer<typeof snapshotSchema>;

declare global {
  // Supplied only by the native Vitest phase in this worker's isolated context.
  var keelSqliteFixtureSnapshot: SqliteFixtureSnapshot | null | undefined;
}

export const fixtureDigest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export function fixtureSourceKey(
  files: readonly string[],
  sources: readonly Buffer[],
) {
  const hash = createHash("sha256").update(JSON.stringify(files));
  for (const bytes of sources) hash.update(`${bytes.length}:`).update(bytes);
  return hash.digest("hex");
}

export function providedFixtureBytes(key: string): Buffer | undefined {
  const snapshot = globalThis.keelSqliteFixtureSnapshot;
  if (!snapshot?.keys.includes(key)) return undefined;
  const proof = snapshotSchema.parse(snapshot);
  const packed = Buffer.from(proof.packed, "base64");
  if (
    packed.length > maxPackedBytes ||
    packed.toString("base64") !== proof.packed
  ) {
    throw new Error("Invalid compressed SQLite fixture");
  }
  const image = inflateSync(packed, { maxOutputLength: proof.bytes });
  if (image.length !== proof.bytes || fixtureDigest(image) !== proof.sha256) {
    throw new Error("SQLite fixture image does not match its source receipt");
  }
  return image;
}
