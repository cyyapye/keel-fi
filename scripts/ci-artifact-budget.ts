import { appendFile, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const MiB = 1024 * 1024;
export const REPOSITORY_LIMIT_BYTES = 300 * MiB;
const statusSchema = z.enum(["success", "failure", "cancelled"]);
export const kindSchema = z.enum([
  "receipt",
  "diagnostics",
  "backup",
  "release",
]);
export function artifactPolicy(
  kind: z.infer<typeof kindSchema>,
  status: z.infer<typeof statusSchema>,
) {
  switch (kind) {
    case "receipt":
      return { bytes: 256 * 1024, days: 7 };
    case "diagnostics":
      return {
        bytes: (status === "success" ? 1 : 12) * MiB,
        days: status === "success" ? 1 : 7,
      };
    case "backup":
      return { bytes: 16 * MiB, days: 14 };
    case "release":
      return { bytes: 256 * 1024, days: 90 };
  }
}

const inventorySchema = z.object({
  total_count: z.number().int().nonnegative(),
  artifacts: z
    .array(
      z.object({
        id: z.number().int().positive(),
        size_in_bytes: z.number().int().nonnegative(),
        expired: z.boolean(),
      }),
    )
    .max(100),
});

export async function retainedBytes(
  repository: string,
  token: string,
  request = fetch,
) {
  z.string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .parse(repository);
  z.string().min(1).parse(token);
  let bytes = 0;
  const seen = new Set<number>();
  for (let page = 1; page <= 100; page++) {
    const response = await request(
      `https://api.github.com/repos/${repository}/actions/artifacts?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error(
        `Artifact inventory unavailable: HTTP ${response.status}`,
      );
    const inventory = inventorySchema.parse(await response.json());
    for (const artifact of inventory.artifacts) {
      if (seen.has(artifact.id))
        throw new Error(
          "Artifact inventory changed during pagination; retry explicitly",
        );
      seen.add(artifact.id);
      if (!artifact.expired) bytes += artifact.size_in_bytes;
    }
    if (seen.size >= inventory.total_count) return bytes;
    if (inventory.artifacts.length !== 100)
      throw new Error("Incomplete artifact inventory");
  }
  throw new Error("Artifact inventory exceeds 100 pages");
}

export async function payloadBytes(paths: string[]) {
  if (paths.length === 0 || paths.length > 4)
    throw new Error("Use one to four explicit artifact files");
  let bytes = 0;
  for (const path of paths) {
    let component = resolve(path);
    const file = await lstat(component);
    if (!file.isFile() || file.nlink !== 1)
      throw new Error("Artifact must be a regular file with one link");
    for (;;) {
      if ((await lstat(component)).isSymbolicLink())
        throw new Error("Artifact must not follow symlinks");
      const parent = dirname(component);
      if (parent === component) break;
      component = parent;
    }
    bytes += file.size;
  }
  // Reserve space for upload-artifact's outer ZIP headers, even for tiny files.
  return bytes + 64 * 1024;
}

export function admitArtifact(
  retained: number,
  payload: number,
  limit: number,
) {
  if (payload > limit)
    throw new Error(`Artifact payload ${payload} exceeds ${limit} bytes`);
  if (retained + payload > REPOSITORY_LIMIT_BYTES) {
    throw new Error(
      `Artifact storage guard: ${retained} retained + ${payload} proposed exceeds 300 MiB. Wait for expiry or review storage; backups and failure evidence are never auto-deleted.`,
    );
  }
}

async function main() {
  const kind = kindSchema.parse(process.env.ARTIFACT_KIND);
  const status = statusSchema.parse(process.env.ARTIFACT_STATUS);
  const paths = z
    .string()
    .min(1)
    .parse(process.env.ARTIFACT_PATHS)
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => resolve(path));
  const policy = artifactPolicy(kind, status);
  const payload = await payloadBytes(paths);
  const retained = await retainedBytes(
    process.env.GITHUB_REPOSITORY ?? "",
    process.env.GITHUB_TOKEN ?? "",
  );
  admitArtifact(retained, payload, policy.bytes + 64 * 1024);
  const summary = `Artifact storage: ${(retained / MiB).toFixed(2)} MiB retained; ${(payload / MiB).toFixed(2)} MiB reserved; ${policy.days} days retention.\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  const output = z.string().min(1).parse(process.env.GITHUB_OUTPUT);
  await appendFile(
    output,
    `retention-days=${policy.days}\npaths<<KEEL_ARTIFACT_PATHS\n${paths.join("\n")}\nKEEL_ARTIFACT_PATHS\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
