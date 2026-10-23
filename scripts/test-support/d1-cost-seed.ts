import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const sealSchema = z
  .object({
    version: z.literal(1),
    input: z.string().regex(/^[a-f0-9]{64}$/u),
    files: z
      .array(
        z
          .object({
            path: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function costSeedInput(body: string) {
  return digest(body + readFileSync("pnpm-lock.yaml", "utf8"));
}

function seedFiles(root: string) {
  const files: { path: string; bytes: Buffer; sha256: string }[] = [];
  let size = 0;
  function visit(relative: string) {
    const path = join(root, relative);
    const info = lstatSync(path);
    if (info.isSymbolicLink())
      throw new Error("D1 seed must not contain symlinks");
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort())
        visit(relative ? `${relative}/${name}` : name);
    } else if (info.isFile()) {
      size += info.size;
      if (size > 64 * 1024 * 1024 || files.length >= 32)
        throw new Error("D1 seed exceeds its fixture bound");
      const bytes = readFileSync(path);
      files.push({ path: relative, bytes, sha256: digest(bytes) });
    } else throw new Error("D1 seed contains an unsupported entry");
  }
  visit("");
  return files;
}

export function sealCostSeed(root: string, input: string) {
  const files = seedFiles(join(root, "d1")).map(({ path, sha256 }) => ({
    path,
    sha256,
  }));
  const seal = sealSchema.parse({ version: 1, input, files });
  writeFileSync(join(root, "seal.json"), JSON.stringify(seal), {
    mode: 0o600,
    flag: "wx",
  });
}

export function copyCostSeed(root: string, destination: string, input: string) {
  if (
    !lstatSync(root).isDirectory() ||
    lstatSync(root).isSymbolicLink() ||
    lstatSync(join(root, "seal.json")).isSymbolicLink()
  )
    throw new Error("D1 seed ownership is invalid");
  const seal = sealSchema.parse(
    JSON.parse(readFileSync(join(root, "seal.json"), "utf8")),
  );
  const files = seedFiles(join(root, "d1"));
  if (
    seal.input !== input ||
    JSON.stringify(seal.files) !==
      JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 })))
  )
    throw new Error("D1 seed is stale or modified");
  // Copy the exact verified bytes, without following a source after validation.
  for (const file of files) {
    const path = join(destination, file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.bytes, { mode: 0o600, flag: "wx" });
  }
}
