import { createHash } from "node:crypto";
import { appendFile, lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { privateR2, PrivateR2ConfigSchema } from "./private-document-r2";
import {
  BackupManifestSchema,
  StorageReceiptSchema,
} from "./preview-deployment-evidence";

export const PREVIEW_STORAGE_LIMIT = 300 * 1024 ** 2;
const BACKUP_LIMIT = 16 * 1024 ** 2;
const RELEASE_LIMIT = 256 * 1024;
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const IdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const EnvironmentSchema = z.object({
  CLOUDFLARE_ACCOUNT_ID: PrivateR2ConfigSchema.shape.account,
  CLOUDFLARE_API_TOKEN: z.string().min(20),
  KEEL_PREVIEW_BACKUP_BUCKET: PrivateR2ConfigSchema.shape.bucket,
  KEEL_PREVIEW_R2_BUCKET: PrivateR2ConfigSchema.shape.bucket,
  GITHUB_SHA: ShaSchema,
  GITHUB_RUN_ID: IdSchema,
  GITHUB_RUN_ATTEMPT: IdSchema,
  GITHUB_STEP_SUMMARY: z.string().min(1),
});
const PublicationEnvironmentSchema = EnvironmentSchema.extend({
  KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH: z.string().min(1),
  KEEL_PREVIEW_BACKUP_MANIFEST_PATH: z.string().min(1),
  KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH: z.string().min(1),
  KEEL_PREVIEW_RELEASE_EVIDENCE_PATH: z.string().min(1),
});
type Environment = z.infer<typeof EnvironmentSchema>;
type ObjectRequest = ReturnType<typeof privateR2>;
const AgeSchema = z.object({
  type: z.literal("Age"),
  maxAge: z.number().int(),
});
const LifecycleSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
      conditions: z.object({ prefix: z.string() }),
      deleteObjectsTransition: z.object({ condition: AgeSchema }).optional(),
    }),
  ),
});
const LockSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
      prefix: z.string(),
      condition: z.object({
        type: z.literal("Age"),
        maxAgeSeconds: z.number().int(),
      }),
    }),
  ),
});
const PageSchema = z.object({
  success: z.literal(true),
  result: z
    .array(
      z.object({
        key: z.string().min(1).max(1024),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(1000),
  result_info: z
    .object({
      is_truncated: z.boolean(),
      cursor: z.string().max(4096).optional(),
      delimited: z.array(z.string()).optional(),
    })
    .optional(),
});

type Phase =
  | "configuration"
  | "policy-managed"
  | "policy-custom"
  | "policy-lifecycle"
  | "policy-lock"
  | "inventory"
  | "parent-token"
  | "temporary-credentials"
  | "object-put"
  | "object-readback"
  | "local-validation";

class StorageFailure extends Error {
  constructor(
    readonly phase: Phase,
    readonly status: number | null = null,
    readonly codes: (number | string)[] = [],
    message = "Private deployment storage request failed",
  ) {
    super(message);
  }
}

// The CLI prints only this allowlisted structure, never provider messages,
// response bodies, object contents, credentials, or exception stacks.
export function publicStorageFailure(error: unknown) {
  return {
    error: "private-deployment-storage-failed",
    phase: error instanceof StorageFailure ? error.phase : "local-validation",
    status: error instanceof StorageFailure ? error.status : null,
    codes: error instanceof StorageFailure ? error.codes : [],
    publicationVerified: false,
  };
}

async function atPhase<T>(phase: Phase, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StorageFailure) throw error;
    throw new StorageFailure(
      phase,
      null,
      [],
      error instanceof Error ? error.message : undefined,
    );
  }
}

async function boundedBytes(
  response: Response,
  maximum: number,
  requireSuccess = true,
) {
  if ((requireSuccess && !response.ok) || response.body === null)
    throw new Error("Private storage request failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum)
        throw new Error("Private storage response exceeds its bound");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

async function managementJSON(
  phase: Phase,
  response: Response,
  maximum: number,
) {
  return atPhase(phase, async () => {
    let value: unknown;
    try {
      value = JSON.parse(
        (await boundedBytes(response, maximum, false)).toString("utf8"),
      );
    } catch (error) {
      if (!response.ok) throw new StorageFailure(phase, response.status);
      throw error;
    }
    const envelope = z
      .object({
        success: z.boolean(),
        errors: z
          .array(z.object({ code: z.number().int().nonnegative() }))
          .max(10)
          .optional(),
      })
      .safeParse(value);
    if (!response.ok || (envelope.success && !envelope.data.success))
      throw new StorageFailure(
        phase,
        response.status,
        envelope.success
          ? (envelope.data.errors?.map(({ code }) => code) ?? [])
          : [],
      );
    return value;
  });
}

const S3CodeSchema = z.enum([
  "AccessDenied",
  "SignatureDoesNotMatch",
  "InvalidAccessKeyId",
  "InvalidToken",
  "ExpiredToken",
  "InvalidArgument",
  "PreconditionFailed",
  "ObjectLockedByBucketPolicy",
  "NoSuchBucket",
  "NoSuchKey",
]);
async function objectFailure(phase: Phase, response: Response): Promise<never> {
  let codes: string[] = [];
  try {
    const body = (await boundedBytes(response, 16 * 1024, false)).toString(
      "utf8",
    );
    const code = S3CodeSchema.safeParse(
      /<Code>([^<]+)<\/Code>/u.exec(body)?.[1],
    );
    if (code.success) codes = [code.data];
  } catch {
    // Malformed, absent, or oversized error data never becomes log output.
  }
  throw new StorageFailure(
    phase,
    response.status,
    codes,
    "Private backup upload failed or read-back failed",
  );
}

function configuration(raw: NodeJS.ProcessEnv) {
  const parsed = EnvironmentSchema.safeParse(raw);
  if (!parsed.success) throw new StorageFailure("configuration");
  const config = parsed.data;
  if (config.KEEL_PREVIEW_BACKUP_BUCKET === config.KEEL_PREVIEW_R2_BUCKET)
    throw new Error("Backups require a separate private bucket");
  return config;
}

// Only fixed Cloudflare management endpoints are used. No secret or API error
// body is logged. Configuration reads never change bucket policy or delete data.
async function management(
  config: Environment,
  suffix: string,
  request: typeof fetch,
) {
  const phase: Phase = suffix.startsWith("objects?")
    ? "inventory"
    : suffix === "domains/managed"
      ? "policy-managed"
      : suffix === "domains/custom"
        ? "policy-custom"
        : suffix === "lifecycle"
          ? "policy-lifecycle"
          : "policy-lock";
  return atPhase(phase, async () => {
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${config.KEEL_PREVIEW_BACKUP_BUCKET}/${suffix}`,
      {
        headers: { Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    return managementJSON(phase, response, 2 * 1024 ** 2);
  });
}

export async function admitPreviewStorage(
  raw: NodeJS.ProcessEnv,
  proposedBytes: number,
  request: typeof fetch = fetch,
) {
  const config = configuration(raw);
  z.number().int().positive().max(BACKUP_LIMIT).parse(proposedBytes);
  const resultSchema = <T extends z.ZodType>(schema: T) =>
    z.object({ success: z.literal(true), result: schema });
  const [, , lifecycle, locks] = await Promise.all([
    management(config, "domains/managed", request).then((value) =>
      resultSchema(z.object({ enabled: z.literal(false) })).parse(value),
    ),
    management(config, "domains/custom", request).then((value) =>
      resultSchema(z.object({ domains: z.array(z.unknown()).length(0) })).parse(
        value,
      ),
    ),
    management(config, "lifecycle", request).then(
      (value) => resultSchema(LifecycleSchema).parse(value).result,
    ),
    management(config, "lock", request).then(
      (value) => resultSchema(LockSchema).parse(value).result,
    ),
  ]);
  const expiry = lifecycle.rules.filter(
    (rule) => rule.enabled && rule.deleteObjectsTransition,
  );
  const retention = locks.rules.filter((rule) => rule.enabled);
  if (expiry.length !== 2 || retention.length !== 2)
    throw new Error("Unexpected private backup retention rules");
  for (const [prefix, days] of [
    ["backups/", 14],
    ["releases/", 90],
  ] as const) {
    const seconds = days * 86_400;
    if (
      !expiry.some(
        (rule) =>
          rule.conditions.prefix === prefix &&
          rule.deleteObjectsTransition?.condition.maxAge === seconds,
      ) ||
      !retention.some(
        (rule) =>
          rule.prefix === prefix && rule.condition.maxAgeSeconds === seconds,
      )
    )
      throw new Error("Private backup retention policy is not configured");
  }
  let cursor: string | undefined;
  let after: string | undefined;
  let bytes = 0;
  const seenKeys = new Set<string>();
  const seenCursors = new Set<string>();
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ per_page: "1000" });
    if (cursor) query.set("cursor", cursor);
    if (after) query.set("start_after", after);
    const data = PageSchema.parse(
      await management(config, `objects?${query}`, request),
    );
    if ((data.result_info?.delimited?.length ?? 0) !== 0)
      throw new Error("Incomplete private backup inventory");
    for (const object of data.result) {
      if (seenKeys.has(object.key))
        throw new Error("Duplicate private backup inventory item");
      seenKeys.add(object.key);
      bytes += object.size;
      if (
        !Number.isSafeInteger(bytes) ||
        bytes + proposedBytes > PREVIEW_STORAGE_LIMIT
      )
        throw new Error("Private backup storage budget exceeded");
    }
    if (
      data.result_info?.is_truncated === false ||
      (data.result.length === 0 && data.result_info === undefined)
    )
      return { retainedBytes: bytes, objects: seenKeys.size };
    if (data.result_info === undefined) {
      // Some R2 REST responses omit cursor metadata. A keyset continuation
      // followed by an empty page proves completion; a short page alone does not.
      let previous = after ?? "";
      for (const object of data.result) {
        if (Buffer.compare(Buffer.from(object.key), Buffer.from(previous)) <= 0)
          throw new Error("Unordered private backup inventory");
        previous = object.key;
      }
      after = previous;
      cursor = undefined;
      continue;
    }
    after = undefined;
    cursor = data.result_info.cursor;
    if (!cursor || seenCursors.has(cursor) || data.result.length === 0)
      throw new Error("Incomplete private backup inventory");
    seenCursors.add(cursor);
  }
  throw new Error("Private backup inventory exceeds its page bound");
}

export async function temporaryPreviewCredentials(
  raw: NodeJS.ProcessEnv,
  objects: string[],
  request: typeof fetch = fetch,
) {
  const config = configuration(raw);
  const identity = `${config.GITHUB_SHA}/${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}`;
  const allowed = new Set([
    `backups/${identity}/state.sql.gpg`,
    `backups/${identity}/manifest.json`,
    `releases/${identity}/release.json`,
    `backups/probes/${identity}/synthetic-check.bin`,
  ]);
  if (
    objects.length < 1 ||
    objects.length > 2 ||
    new Set(objects).size !== objects.length ||
    objects.some((key) => !allowed.has(key)) ||
    (objects.some((key) => key.startsWith("releases/")) &&
      objects.length !== 1) ||
    (objects.some((key) => key.startsWith("backups/probes/")) &&
      objects.length !== 1)
  )
    throw new Error(
      "Temporary credentials must be scoped to this deployment attempt",
    );
  const base = "https://api.cloudflare.com/client/v4";
  const init = {
    headers: { Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}` },
    redirect: "error" as const,
    signal: AbortSignal.timeout(30_000),
  };
  const parent = await atPhase("parent-token", async () => {
    let verification = await request(`${base}/user/tokens/verify`, init);
    // Account-owned tokens can reject the user-token endpoint with either
    // authentication status. Try only the fixed configured-account endpoint;
    // both token types must still verify active before any credential is issued.
    if (verification.status === 401 || verification.status === 403) {
      await verification.body?.cancel();
      verification = await request(
        `${base}/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/tokens/verify`,
        { ...init, signal: AbortSignal.timeout(30_000) },
      );
    }
    return z
      .object({
        success: z.literal(true),
        result: z.object({
          id: z.string().regex(/^[a-f0-9]{32}$/u),
          status: z.literal("active"),
        }),
      })
      .parse(await managementJSON("parent-token", verification, RELEASE_LIMIT));
  });
  return atPhase("temporary-credentials", async () => {
    const minted = await request(
      `${base}/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/r2/temp-access-credentials`,
      {
        ...init,
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: { ...init.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          parentAccessKeyId: parent.result.id,
          bucket: config.KEEL_PREVIEW_BACKUP_BUCKET,
          permission: "object-read-write",
          objects,
          ttlSeconds: 900,
        }),
      },
    );
    const credential = z
      .object({
        success: z.literal(true),
        result: z.object({
          accessKeyId: PrivateR2ConfigSchema.shape.accessKeyId,
          secretAccessKey: PrivateR2ConfigSchema.shape.secretAccessKey,
          sessionToken: z.string().min(16).max(16384),
        }),
      })
      .parse(
        await managementJSON("temporary-credentials", minted, RELEASE_LIMIT),
      );
    return PrivateR2ConfigSchema.parse({
      account: config.CLOUDFLARE_ACCOUNT_ID,
      bucket: config.KEEL_PREVIEW_BACKUP_BUCKET,
      ...credential.result,
    });
  });
}

export async function putVerifiedObject(
  key: string,
  bytes: Buffer,
  request: ObjectRequest,
) {
  const digest = sha256(bytes);
  const uploaded = await atPhase("object-put", () =>
    request(key, {
      method: "PUT",
      headers: {
        "If-None-Match": "*",
        "Content-Type": "application/octet-stream",
        "X-Amz-Content-Sha256": digest,
      },
      body: new Blob([new Uint8Array(bytes)]),
      signal: AbortSignal.timeout(120_000),
    }),
  );
  if (!uploaded.ok) await objectFailure("object-put", uploaded);
  await uploaded.body?.cancel();
  const recovered = await atPhase("object-readback", async () => {
    const response = await request(key, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) await objectFailure("object-readback", response);
    return boundedBytes(response, bytes.length);
  });
  if (recovered.length !== bytes.length || sha256(recovered) !== digest)
    throw new StorageFailure(
      "object-readback",
      null,
      [],
      "Private backup read-back mismatch",
    );
  return digest;
}

export async function preflightPreviewStorage(
  raw: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
  createObjects: typeof privateR2 = privateR2,
) {
  const config = configuration(raw);
  const bytes = Buffer.from("Keel synthetic deployment storage check v1\n");
  const key = `backups/probes/${config.GITHUB_SHA}/${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}/synthetic-check.bin`;
  await admitPreviewStorage(raw, bytes.length, request);
  const credentials = await temporaryPreviewCredentials(raw, [key], request);
  await putVerifiedObject(key, bytes, createObjects(credentials));
  await appendFile(
    config.GITHUB_STEP_SUMMARY,
    "\nPrivate deployment storage preflight passed: synthetic object PUT/read-back verified. No D1 export, migration, or Worker deployment was performed.\n",
  );
}

async function fileBytes(path: string, maximum: number) {
  const file = await lstat(path);
  if (!file.isFile() || file.size <= 0 || file.size > maximum)
    throw new Error("Private backup file exceeds its envelope");
  const bytes = await readFile(path);
  if (bytes.length !== file.size)
    throw new Error("Private backup file changed during read");
  return bytes;
}

export async function storePreviewEvidence(
  kind: "backup" | "release",
  raw: NodeJS.ProcessEnv,
  dependencies?: { management: typeof fetch; objects: ObjectRequest },
) {
  configuration(raw);
  const config = PublicationEnvironmentSchema.parse(raw);
  const objectRequest = async (keys: string[]) =>
    dependencies?.objects ??
    privateR2(await temporaryPreviewCredentials(raw, keys));
  const identity = `${config.GITHUB_SHA}/${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}`;
  if (kind === "backup") {
    const [encrypted, manifestBytes] = await Promise.all([
      fileBytes(config.KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH, BACKUP_LIMIT),
      fileBytes(config.KEEL_PREVIEW_BACKUP_MANIFEST_PATH, RELEASE_LIMIT),
    ]);
    const manifest = BackupManifestSchema.parse(
      JSON.parse(manifestBytes.toString("utf8")) as unknown,
    );
    if (
      manifest.gitSha !== config.GITHUB_SHA ||
      manifest.runId !== config.GITHUB_RUN_ID ||
      manifest.runAttempt !== config.GITHUB_RUN_ATTEMPT ||
      manifest.encryptedSha256 !== sha256(encrypted)
    )
      throw new Error("Private backup manifest mismatch");
    const admission = await admitPreviewStorage(
      raw,
      encrypted.length + manifestBytes.length,
      dependencies?.management,
    );
    const backupKey = `backups/${identity}/state.sql.gpg`;
    const manifestKey = `backups/${identity}/manifest.json`;
    const request = await objectRequest([backupKey, manifestKey]);
    // Sequential writes preserve the ciphertext if the manifest PUT/read-back fails.
    // Failure never authorizes a migration, deletion, or an overwrite retry.
    const encryptedSha256 = await putVerifiedObject(
      backupKey,
      encrypted,
      request,
    );
    await putVerifiedObject(manifestKey, manifestBytes, request);
    const receipt = StorageReceiptSchema.parse({
      schemaVersion: 1,
      provider: "r2",
      bucket: config.KEEL_PREVIEW_BACKUP_BUCKET,
      gitSha: config.GITHUB_SHA,
      runId: config.GITHUB_RUN_ID,
      runAttempt: config.GITHUB_RUN_ATTEMPT,
      backupKey,
      manifestKey,
      encryptedSha256,
      verifiedAt: new Date().toISOString(),
    });
    await writeFile(
      config.KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH,
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
    );
    await appendFile(
      config.GITHUB_STEP_SUMMARY,
      `\nEncrypted D1 backup and manifest stored privately and read-back verified. Retained bytes before upload: ${admission.retainedBytes}.\n`,
    );
    return receipt;
  }
  const bytes = await fileBytes(
    config.KEEL_PREVIEW_RELEASE_EVIDENCE_PATH,
    RELEASE_LIMIT,
  );
  const evidence = z
    .object({
      gitSha: ShaSchema,
      d1: z.object({ backupStorage: StorageReceiptSchema }),
    })
    .parse(JSON.parse(bytes.toString("utf8")) as unknown);
  const receipt = StorageReceiptSchema.parse(
    JSON.parse(
      (
        await fileBytes(
          config.KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH,
          RELEASE_LIMIT,
        )
      ).toString("utf8"),
    ) as unknown,
  );
  if (
    evidence.gitSha !== config.GITHUB_SHA ||
    evidence.d1.backupStorage.gitSha !== config.GITHUB_SHA ||
    evidence.d1.backupStorage.runId !== config.GITHUB_RUN_ID ||
    evidence.d1.backupStorage.runAttempt !== config.GITHUB_RUN_ATTEMPT ||
    evidence.d1.backupStorage.bucket !== config.KEEL_PREVIEW_BACKUP_BUCKET ||
    JSON.stringify(evidence.d1.backupStorage) !== JSON.stringify(receipt)
  )
    throw new Error("Release evidence does not match this backup attempt");
  await admitPreviewStorage(raw, bytes.length, dependencies?.management);
  const key = `releases/${identity}/release.json`;
  const request = await objectRequest([key]);
  const digest = await putVerifiedObject(key, bytes, request);
  await appendFile(
    config.GITHUB_STEP_SUMMARY,
    `\nRelease evidence stored privately and read-back verified: \`${key}\` (SHA-256 \`${digest}\`).\n`,
  );
  return { key, sha256: digest };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const kind = process.argv[2];
  const operation =
    kind === "preflight"
      ? preflightPreviewStorage(process.env)
      : kind === "backup" || kind === "release"
        ? storePreviewEvidence(kind, process.env)
        : Promise.reject(new StorageFailure("configuration"));
  operation.catch((error: unknown) => {
    console.error(JSON.stringify(publicStorageFailure(error)));
    process.exitCode = 1;
  });
}
