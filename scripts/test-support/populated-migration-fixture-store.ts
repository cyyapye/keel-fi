import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { migrationSourceDigest } from "../d1-migration-safety";

export const POPULATED_FIXTURE_BYTE_LIMIT = 32 * 1024 * 1024;
export const PopulatedFixtureFrontierSchema = z.enum([
  "0088",
  "0089",
  "0090",
  "0090-public",
  "0091",
  "0092",
  "0093",
  "0094",
  "0095",
  "0096",
  "0097",
]);
export const EncodedMigrationFixturesSchema = z.record(
  PopulatedFixtureFrontierSchema,
  z.string().min(1),
);
const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const InputSchema = z
  .object({
    sourceDigest: DigestSchema,
    preparer: DigestSchema,
    launcher: DigestSchema,
    runtime: z
      .object({
        node: z.string().min(1),
        sqlite: z.string().min(1),
        platform: z.string().min(1),
        arch: z.string().min(1),
      })
      .strict(),
    attempt: z
      .object({ run: z.string(), number: z.string(), environment: z.string() })
      .strict(),
  })
  .strict();
const FileSchema = z
  .object({
    bytes: z.number().int().positive().max(POPULATED_FIXTURE_BYTE_LIMIT),
    sha256: DigestSchema,
  })
  .strict();
const StoreSchema = z
  .object({
    version: z.literal(1),
    input: InputSchema,
    files: z.tuple([
      FileSchema.extend({ history: z.literal(12), name: z.literal("12.json") }),
      FileSchema.extend({ history: z.literal(24), name: z.literal("24.json") }),
    ]),
  })
  .strict();

function currentInput() {
  return InputSchema.parse({
    sourceDigest: migrationSourceDigest(),
    preparer: sha256(readFileSync("scripts/prepare-d1-cost-seed.ts")),
    launcher: sha256(readFileSync("scripts/pilot_native.py")),
    runtime: {
      node: process.version,
      sqlite: process.versions.sqlite,
      platform: process.platform,
      arch: process.arch,
    },
    attempt: {
      run: process.env.GITHUB_RUN_ID ?? "",
      number: process.env.GITHUB_RUN_ATTEMPT ?? "",
      environment: process.env.TUGLING_VERIFICATION_ENVIRONMENT ?? "",
    },
  });
}

function ownedDirectory(root: string) {
  const info = lstatSync(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700
  )
    throw new Error("Expected fixtures require an owned private directory");
  return info;
}

function readOwnedFile(root: string, name: string, limit: number) {
  const directory = ownedDirectory(root);
  const descriptor = openSync(
    join(root, name),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = fstatSync(descriptor);
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      info.nlink !== 1 ||
      (info.mode & 0o777) !== 0o600 ||
      info.size <= 0 ||
      info.size > limit
    )
      throw new Error("Expected fixture file is unowned or exceeds its bound");
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (read === 0) throw new Error("Expected fixture file was truncated");
      offset += read;
    }
    const current = fstatSync(descriptor);
    const parent = ownedDirectory(root);
    if (
      readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0 ||
      current.size !== info.size ||
      current.mtimeMs !== info.mtimeMs ||
      current.ctimeMs !== info.ctimeMs ||
      parent.dev !== directory.dev ||
      parent.ino !== directory.ino
    )
      throw new Error("Expected fixture file changed during acquisition");
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export async function prepareExpectedFixtureStore(
  root: string,
  generate: (history: 12 | 24) => Promise<string>,
) {
  ownedDirectory(root);
  if (readdirSync(root).length !== 0)
    throw new Error("Expected fixture preparation requires an empty directory");
  const input = currentInput();
  const files = [];
  for (const history of [12, 24] as const) {
    const text = await generate(history);
    if (Buffer.byteLength(text) > POPULATED_FIXTURE_BYTE_LIMIT)
      throw new Error("Expected fixture bundle exceeds its byte bound");
    EncodedMigrationFixturesSchema.parse(JSON.parse(text));
    const name = `${history}.json` as const;
    writeFileSync(join(root, name), text, { mode: 0o600, flag: "wx" });
    const bytes = readOwnedFile(root, name, POPULATED_FIXTURE_BYTE_LIMIT);
    if (
      bytes.byteLength !== Buffer.byteLength(text) ||
      sha256(bytes) !== sha256(text)
    )
      throw new Error("Expected fixture publication read-back failed");
    files.push({
      history,
      name,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  if (
    files.reduce((total, file) => total + file.bytes, 0) >
      2 * POPULATED_FIXTURE_BYTE_LIMIT ||
    JSON.stringify(currentInput()) !== JSON.stringify(input)
  )
    throw new Error("Expected fixture sources changed during preparation");
  const manifest = StoreSchema.parse({ version: 1, input, files });
  const body = JSON.stringify(manifest);
  writeFileSync(join(root, "manifest.json"), body, { mode: 0o600, flag: "wx" });
  if (!readOwnedFile(root, "manifest.json", 8192).equals(Buffer.from(body)))
    throw new Error("Expected fixture manifest read-back failed");
}

export function readExpectedFixtureStore(root: string, history: 12 | 24) {
  ownedDirectory(root);
  if (
    JSON.stringify(readdirSync(root).sort()) !==
    JSON.stringify(["12.json", "24.json", "manifest.json"])
  )
    throw new Error("Expected fixture store is incomplete or unexpected");
  const input = currentInput();
  const manifest = StoreSchema.parse(
    JSON.parse(readOwnedFile(root, "manifest.json", 8192).toString("utf8")),
  );
  if (JSON.stringify(manifest.input) !== JSON.stringify(input))
    throw new Error("Expected fixture input is stale");
  const file = manifest.files[history === 12 ? 0 : 1];
  const bytes = readOwnedFile(root, file.name, POPULATED_FIXTURE_BYTE_LIMIT);
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256)
    throw new Error("Expected fixture bundle changed");
  const bundle = EncodedMigrationFixturesSchema.parse(
    JSON.parse(bytes.toString("utf8")),
  );
  if (JSON.stringify(currentInput()) !== JSON.stringify(input))
    throw new Error("Expected fixture sources changed during acquisition");
  return bundle;
}
