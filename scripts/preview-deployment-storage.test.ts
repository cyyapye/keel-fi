import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateR2 } from "./private-document-r2";
import {
  writeBackupManifest,
  writeReleaseEvidence,
} from "./preview-deployment-evidence";
import {
  admitPreviewStorage,
  preflightPreviewStorage,
  PREVIEW_STORAGE_LIMIT,
  publicStorageFailure,
  putVerifiedObject,
  storePreviewEvidence,
  temporaryPreviewCredentials,
} from "./preview-deployment-storage";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const gitSha = "a".repeat(40);
const policies = () => ({
  managed: { enabled: false },
  custom: { domains: [] as unknown[] },
  lifecycle: {
    rules: [
      ["backups/", 14],
      ["releases/", 90],
    ].map(([prefix, days]) => ({
      id: String(prefix),
      enabled: true,
      conditions: { prefix },
      deleteObjectsTransition: {
        condition: { type: "Age", maxAge: Number(days) * 86400 },
      },
    })),
  },
  locks: {
    rules: [
      ["backups/", 14],
      ["releases/", 90],
    ].map(([prefix, days]) => ({
      id: String(prefix),
      enabled: true,
      prefix,
      condition: { type: "Age", maxAgeSeconds: Number(days) * 86400 },
    })),
  },
});
function management(policy = policies(), pages: unknown[] = [page([])]) {
  const urls: URL[] = [];
  let next = 0;
  const request: typeof fetch = (input, init) => {
    const url = new URL(
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input,
    );
    urls.push(url);
    expect(url.origin).toBe("https://api.cloudflare.com");
    expect(url.pathname).toContain("/r2/buckets/synthetic-backups/");
    expect(init?.redirect).toBe("error");
    if (url.pathname.endsWith("/objects"))
      return Promise.resolve(Response.json(pages[next++]));
    const result = url.pathname.endsWith("/domains/managed")
      ? policy.managed
      : url.pathname.endsWith("/domains/custom")
        ? policy.custom
        : url.pathname.endsWith("/lifecycle")
          ? policy.lifecycle
          : policy.locks;
    return Promise.resolve(Response.json({ success: true, result }));
  };
  return { request, urls };
}
function page(result: { key: string; size: number }[], cursor?: string) {
  return {
    success: true,
    result,
    result_info: {
      is_truncated: cursor !== undefined,
      ...(cursor ? { cursor } : {}),
    },
  };
}
function objectStore() {
  const stored = new Map<string, Buffer>();
  const calls: { key: string; method: string }[] = [];
  const request = async (key: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ key, method });
    if (method === "PUT") {
      expect(new Headers(init.headers).get("If-None-Match")).toBe("*");
      if (stored.has(key)) return new Response(null, { status: 412 });
      const bytes = Buffer.from(await (init.body as Blob).arrayBuffer());
      stored.set(key, bytes);
      return new Response(null);
    }
    return stored.has(key)
      ? new Response(new Uint8Array(stored.get(key)!))
      : new Response(null, { status: 404 });
  };
  return { request, stored, calls };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keel-synthetic-release-storage-"));
  roots.push(root);
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
    CLOUDFLARE_API_TOKEN: "synthetic-management-token-only",
    KEEL_PREVIEW_BACKUP_BUCKET: "synthetic-backups",
    KEEL_PREVIEW_R2_BUCKET: "synthetic-originals",
    GITHUB_SHA: gitSha,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    KEEL_PREVIEW_BACKUP_NAME: "synthetic-backup",
    KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH: join(root, "state.sql"),
    KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH: join(root, "state.sql.gpg"),
    KEEL_PREVIEW_BACKUP_MANIFEST_PATH: join(root, "manifest.json"),
    KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH: join(root, "storage.json"),
    KEEL_PREVIEW_RELEASE_EVIDENCE_PATH: join(root, "release.json"),
    KEEL_D1_MAINTENANCE_RECEIPT_PATH: join(root, "maintenance.json"),
    GITHUB_STEP_SUMMARY: join(root, "summary.md"),
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "synthetic/keel",
    KEEL_API_WRANGLER_OUTPUT_PATH: join(root, "api.jsonl"),
    KEEL_WEB_WRANGLER_OUTPUT_PATH: join(root, "web.jsonl"),
    KEEL_PREVIEW_API_WORKER: "synthetic-api",
    KEEL_PREVIEW_WEB_WORKER: "synthetic-web",
  };
  await writeFile(
    env.KEEL_PREVIEW_BACKUP_PLAINTEXT_PATH,
    "synthetic-only plaintext SQL",
  );
  await writeFile(
    env.KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH,
    "synthetic-only ciphertext bytes",
  );
  await writeBackupManifest(env);
  await writeFile(
    env.KEEL_D1_MAINTENANCE_RECEIPT_PATH,
    JSON.stringify({
      version: 1,
      state: "admitted",
      gitSha,
      runId: "123",
      runAttempt: "1",
      frontier: "0089_manual_holdings.sql",
      pending: [],
      migrationSafetyKind: "baseline",
      migrationCost: null,
      sourceDigest: "c".repeat(64),
      migrationReceiptDigest: "d".repeat(64),
      capacityEvidenceHash: "e".repeat(64),
      chargedEnvelope: { reads: 100_000, writes: 10_000 },
      actualBilledRows: "unavailable",
    }),
  );
  return { root, env };
}

describe("private preview deployment storage", () => {
  it("reports only safe phases, statuses and allowlisted codes after provider failures", async () => {
    const { env } = await fixture();
    const secret = "synthetic-confidential-response-must-not-be-logged";
    const key = `releases/${gitSha}/123-1/release.json`;
    for (const [phase, status, body, expectedCodes] of [
      [
        "parent-token",
        401,
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: secret }],
        }),
        [9109],
      ],
      ["parent-token", 401, secret, []],
      [
        "parent-token",
        200,
        JSON.stringify({ success: true, result: { id: secret } }),
        [],
      ],
      [
        "temporary-credentials",
        403,
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: secret }],
        }),
        [10000],
      ],
    ] as const) {
      let calls = 0;
      const request: typeof fetch = () => {
        calls += 1;
        return Promise.resolve(
          phase === "temporary-credentials" && calls === 1
            ? Response.json({
                success: true,
                result: { id: "c".repeat(32), status: "active" },
              })
            : new Response(body, { status }),
        );
      };
      const error = await temporaryPreviewCredentials(
        env,
        [key],
        request,
      ).catch((caught: unknown) => caught);
      const report = publicStorageFailure(error);
      expect(report).toMatchObject({
        phase,
        codes: expectedCodes,
        publicationVerified: false,
      });
      expect(report.status).toBe(status === 200 ? null : status);
      expect(JSON.stringify(report)).not.toContain(secret);
      expect(calls).toBe(
        phase === "temporary-credentials" || status === 401 ? 2 : 1,
      );
    }
    for (const code of ["AccessDenied", secret]) {
      const error = await putVerifiedObject(key, Buffer.from("synthetic"), () =>
        Promise.resolve(
          new Response(
            `<Error><Code>${code}</Code><Message>${secret}</Message><Resource>${secret}</Resource></Error>`,
            { status: 403 },
          ),
        ),
      ).catch((caught: unknown) => caught);
      const report = publicStorageFailure(error);
      expect(report).toMatchObject({
        phase: "object-put",
        status: 403,
        codes: code === "AccessDenied" ? [code] : [],
      });
      expect(JSON.stringify(report)).not.toContain(secret);
    }
    const error = await admitPreviewStorage(env, 1, () =>
      Promise.resolve(
        Response.json(
          { success: false, errors: [{ code: 9109, message: secret }] },
          { status: 403 },
        ),
      ),
    ).catch((caught: unknown) => caught);
    expect(publicStorageFailure(error)).toMatchObject({
      status: 403,
      codes: [9109],
    });
    expect(
      JSON.stringify(publicStorageFailure(new Error(secret))),
    ).not.toContain(secret);
  });

  it("preflights the protected credential with one synthetic object and no recovery receipt", async () => {
    const { env } = await fixture();
    const core = Object.fromEntries(
      Object.entries(env).filter(([key]) => !key.endsWith("_PATH")),
    );
    const key = `backups/probes/${gitSha}/123-1/synthetic-check.bin`;
    const api = management();
    const scopes: unknown[] = [];
    const credentials = {
      accessKeyId: "synthetic-session-id",
      secretAccessKey: "synthetic-session-secret-".repeat(2),
      sessionToken: "synthetic-session-token-only",
    };
    const request: typeof fetch = (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      if (url.endsWith("/verify"))
        return Promise.resolve(
          Response.json({
            success: true,
            result: { id: "c".repeat(32), status: "active" },
          }),
        );
      if (url.endsWith("/temp-access-credentials")) {
        scopes.push(JSON.parse(init!.body as string));
        return Promise.resolve(
          Response.json({ success: true, result: credentials }),
        );
      }
      return api.request(input, init);
    };
    const store = objectStore();
    const factory = vi.fn(() => store.request);
    await preflightPreviewStorage(core, request, factory);
    expect(api.urls).toHaveLength(5);
    expect(scopes).toEqual([
      {
        parentAccessKeyId: "c".repeat(32),
        bucket: "synthetic-backups",
        permission: "object-read-write",
        objects: [key],
        ttlSeconds: 900,
      },
    ]);
    expect(factory).toHaveBeenCalledWith({
      account: env.CLOUDFLARE_ACCOUNT_ID,
      bucket: "synthetic-backups",
      ...credentials,
    });
    expect(store.calls).toEqual([
      { key, method: "PUT" },
      { key, method: "GET" },
    ]);
    expect(store.stored.get(key)!.toString()).toBe(
      "Keel synthetic deployment storage check v1\n",
    );
    await expect(
      readFile(env.KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      temporaryPreviewCredentials(
        core,
        [key, `backups/${gitSha}/123-1/manifest.json`],
        request,
      ),
    ).rejects.toThrow("scoped");
    // An ambiguous/refused write fails without read-back or a success summary.
    await rm(env.GITHUB_STEP_SUMMARY);
    await expect(
      preflightPreviewStorage(
        { ...core, GITHUB_RUN_ATTEMPT: "2" },
        request,
        () => () => Promise.resolve(new Response(null, { status: 403 })),
      ),
    ).rejects.toThrow();
    await expect(readFile(env.GITHUB_STEP_SUMMARY)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("mints short-lived credentials for exact attempt objects and signs requests with the session token", async () => {
    const { env } = await fixture();
    const key = `releases/${gitSha}/123-1/release.json`;
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const credentials = {
      accessKeyId: "synthetic-session-id",
      secretAccessKey: "synthetic-session-secret-".repeat(2),
      sessionToken: "synthetic-session-token-only",
    };
    const request: typeof fetch = (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      calls.push({ url, init });
      expect(new URL(url).origin).toBe("https://api.cloudflare.com");
      return Promise.resolve(
        Response.json({
          success: true,
          result: url.endsWith("/verify")
            ? { id: "c".repeat(32), status: "active" }
            : credentials,
        }),
      );
    };
    const config = await temporaryPreviewCredentials(env, [key], request);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({
      parentAccessKeyId: "c".repeat(32),
      bucket: "synthetic-backups",
      permission: "object-read-write",
      objects: [key],
      ttlSeconds: 900,
    });
    let signed = 0;
    vi.stubGlobal("fetch", (input: Request) => {
      signed += 1;
      expect(input.headers.get("x-amz-security-token")).toBe(
        credentials.sessionToken,
      );
      expect(input.headers.get("authorization")).toContain(
        credentials.accessKeyId,
      );
      expect(new URL(input.url).hostname).toBe(
        `${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      );
      return Promise.resolve(new Response("synthetic"));
    });
    await privateR2(config)(key);
    expect(signed).toBe(1);
    for (const status of [401, 403]) {
      let accountCalls = 0;
      const accountRequest: typeof fetch = (input, init) => {
        accountCalls += 1;
        if (accountCalls === 2)
          expect(input).toBe(
            `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/tokens/verify`,
          );
        return accountCalls === 1
          ? Promise.resolve(new Response(null, { status }))
          : request(input, init);
      };
      await temporaryPreviewCredentials(env, [key], accountRequest);
      expect(accountCalls).toBe(3);
    }
    for (const status of [401, 403, 429, 500]) {
      let denied = 0;
      const unavailable: typeof fetch = () => {
        denied += 1;
        return Promise.resolve(new Response(null, { status }));
      };
      await expect(
        temporaryPreviewCredentials(env, [key], unavailable),
      ).rejects.toThrow();
      expect(denied).toBe(status === 401 || status === 403 ? 2 : 1);
    }
    await expect(
      temporaryPreviewCredentials(
        env,
        ["backups/another-attempt/state.sql.gpg"],
        request,
      ),
    ).rejects.toThrow("scoped");
  });

  it("counts all 120 retained objects across bounded pages, including foreign keys", async () => {
    const { env } = await fixture();
    const objects = Array.from({ length: 120 }, (_, i) => ({
      key: `foreign-${i}`,
      size: 100,
    }));
    const api = management(policies(), [
      page(objects.slice(0, 100), "next"),
      page(objects.slice(100)),
    ]);
    await expect(admitPreviewStorage(env, 1000, api.request)).resolves.toEqual({
      retainedBytes: 12000,
      objects: 120,
    });
    expect(api.urls).toHaveLength(6);
    expect(api.urls.at(-1)!.searchParams.get("cursor")).toBe("next");
    const empty = management();
    await expect(
      admitPreviewStorage(env, 1000, empty.request),
    ).resolves.toEqual({ retainedBytes: 0, objects: 0 });
    expect(empty.urls).toHaveLength(5);
    const ordered = objects.map((item, index) => ({
      ...item,
      key: `foreign-${String(index).padStart(3, "0")}`,
    }));
    const keyset = management(policies(), [
      { success: true, result: ordered.slice(0, 100) },
      { success: true, result: ordered.slice(100) },
      { success: true, result: [] },
    ]);
    await expect(
      admitPreviewStorage(env, 1000, keyset.request),
    ).resolves.toEqual({ retainedBytes: 12000, objects: 120 });
    expect(keyset.urls).toHaveLength(7);
    expect(keyset.urls.at(-1)!.searchParams.get("start_after")).toBe(
      "foreign-119",
    );
  });

  it("rejects public buckets, missing retention, shared originals and invalid credentials before writes", async () => {
    const { env } = await fixture();
    const variants = [
      () => {
        const p = policies();
        p.managed.enabled = true;
        return p;
      },
      () => {
        const p = policies();
        p.custom.domains = [{ domain: "synthetic.example" }];
        return p;
      },
      () => {
        const p = policies();
        p.lifecycle.rules[0]!.deleteObjectsTransition.condition.maxAge = 86400;
        return p;
      },
      () => {
        const p = policies();
        p.locks.rules = [];
        return p;
      },
    ];
    for (const variant of variants) {
      const api = management(variant()),
        store = objectStore();
      await expect(
        storePreviewEvidence("backup", env, {
          management: api.request,
          objects: store.request,
        }),
      ).rejects.toThrow();
      expect(store.calls).toEqual([]);
    }
    for (const patch of [
      { KEEL_PREVIEW_BACKUP_BUCKET: env.KEEL_PREVIEW_R2_BUCKET },
      { CLOUDFLARE_API_TOKEN: "" },
    ]) {
      const api = management();
      await expect(
        admitPreviewStorage({ ...env, ...patch }, 1, api.request),
      ).rejects.toThrow();
      expect(api.urls).toEqual([]);
    }
  });

  it("fails closed on malformed, inaccessible, repeated, incomplete and over-budget inventories", async () => {
    const { env } = await fixture();
    const cases = [
      [page([{ key: "large-foreign-object", size: PREVIEW_STORAGE_LIMIT }])],
      [{ success: true, result: [], result_info: { is_truncated: true } }],
      [
        page([{ key: "repeat", size: 1 }], "next"),
        page([{ key: "repeat", size: 1 }]),
      ],
      [
        page([{ key: "one", size: 1 }], "same"),
        page([{ key: "two", size: 1 }], "same"),
      ],
      [
        {
          success: true,
          result: [{ key: "bad", size: "unknown" }],
          result_info: { is_truncated: false },
        },
      ],
    ];
    for (const pages of cases) {
      const api = management(policies(), pages);
      await expect(admitPreviewStorage(env, 1, api.request)).rejects.toThrow();
      expect(api.urls.length).toBeLessThanOrEqual(6);
    }
    let requests = 0;
    const refused: typeof fetch = () => {
      requests += 1;
      return Promise.resolve(new Response(null, { status: 403 }));
    };
    await expect(admitPreviewStorage(env, 1, refused)).rejects.toThrow();
    expect(requests).toBe(4);
    const bounded = management(
      policies(),
      Array.from({ length: 5 }, (_, index) => ({
        success: true,
        result: [{ key: `key-${index}`, size: 1 }],
      })),
    );
    await expect(admitPreviewStorage(env, 1, bounded.request)).rejects.toThrow(
      "page bound",
    );
    expect(bounded.urls).toHaveLength(9);
    await expect(
      admitPreviewStorage(env, 16 * 1024 ** 2 + 1, management().request),
    ).rejects.toThrow();
  });

  it("stores only ciphertext and manifest, verifies both read-backs, and binds the success receipt to this attempt", async () => {
    const { env } = await fixture(),
      api = management(),
      store = objectStore();
    const receipt = await storePreviewEvidence("backup", env, {
      management: api.request,
      objects: store.request,
    });
    expect(receipt).toMatchObject({
      gitSha,
      runId: "123",
      runAttempt: "1",
      bucket: "synthetic-backups",
    });
    expect(store.calls.map((call) => call.method)).toEqual([
      "PUT",
      "GET",
      "PUT",
      "GET",
    ]);
    expect([...store.stored.keys()]).toEqual([
      `backups/${gitSha}/123-1/state.sql.gpg`,
      `backups/${gitSha}/123-1/manifest.json`,
    ]);
    expect(
      JSON.parse(
        await readFile(env.KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH, "utf8"),
      ),
    ).toEqual(receipt);
    expect(await readFile(env.GITHUB_STEP_SUMMARY, "utf8")).not.toContain(
      "synthetic-only plaintext SQL",
    );
    await expect(
      storePreviewEvidence("backup", env, {
        management: management().request,
        objects: store.request,
      }),
    ).rejects.toThrow("upload failed");
    expect(store.calls.at(-1)?.method).toBe("PUT");
    await expect(
      storePreviewEvidence(
        "backup",
        { ...env, GITHUB_RUN_ATTEMPT: "2" },
        { management: api.request, objects: store.request },
      ),
    ).rejects.toThrow("manifest mismatch");
  });

  it("never records backup success after failed or ambiguous writes, damaged reads, or manifest substitution", async () => {
    for (const outcome of [
      "refused",
      "ambiguous",
      "corrupt",
      "truncated",
      "oversized",
      "missing-manifest",
    ] as const) {
      const { env } = await fixture();
      const api = management();
      let calls = 0;
      const request = async (key: string, init: RequestInit = {}) => {
        calls += 1;
        if (init.method === "PUT") {
          if (outcome === "ambiguous") throw new Error("synthetic disconnect");
          return new Response(null, {
            status:
              outcome === "refused" ||
              (outcome === "missing-manifest" && key.endsWith("manifest.json"))
                ? 403
                : 200,
          });
        }
        const bytes = await readFile(
          key.endsWith(".gpg")
            ? env.KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH
            : env.KEEL_PREVIEW_BACKUP_MANIFEST_PATH,
        );
        return new Response(
          new Uint8Array(
            outcome === "corrupt"
              ? Buffer.alloc(bytes.length)
              : outcome === "truncated"
                ? bytes.subarray(1)
                : outcome === "oversized"
                  ? Buffer.concat([bytes, Buffer.from("extra")])
                  : bytes,
          ),
        );
      };
      await expect(
        storePreviewEvidence("backup", env, {
          management: api.request,
          objects: request,
        }),
      ).rejects.toThrow();
      await expect(
        readFile(env.KEEL_PREVIEW_BACKUP_STORAGE_RECEIPT_PATH),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(calls).toBeLessThanOrEqual(3);
    }
    const { env } = await fixture();
    await writeFile(
      env.KEEL_PREVIEW_BACKUP_ENCRYPTED_PATH,
      "substituted ciphertext",
    );
    const api = management(),
      store = objectStore();
    await expect(
      storePreviewEvidence("backup", env, {
        management: api.request,
        objects: store.request,
      }),
    ).rejects.toThrow("manifest mismatch");
    expect(api.urls).toEqual([]);
    expect(store.calls).toEqual([]);
    let writes = 0;
    await expect(
      putVerifiedObject("synthetic", Buffer.from("synthetic"), () => {
        writes += 1;
        return Promise.resolve(new Response(null, { status: 412 }));
      }),
    ).rejects.toThrow();
    expect(writes).toBe(1);
  });

  it("publishes exact release evidence only with this verified backup and refuses cross-attempt receipts", async () => {
    const { root, env } = await fixture(),
      api = management(),
      store = objectStore();
    await storePreviewEvidence("backup", env, {
      management: api.request,
      objects: store.request,
    });
    await mkdir(join(root, "packages/database/migrations"), {
      recursive: true,
    });
    await writeFile(
      join(root, "packages/database/migrations/0001_synthetic.sql"),
      "SELECT 1;",
    );
    for (const [path, worker, version] of [
      [env.KEEL_API_WRANGLER_OUTPUT_PATH, "synthetic-api", "api-1"],
      [env.KEEL_WEB_WRANGLER_OUTPUT_PATH, "synthetic-web", "web-1"],
    ]) {
      await writeFile(
        path!,
        JSON.stringify({
          type: "deploy",
          worker_name: worker,
          version_id: version,
        }),
      );
    }
    await expect(
      writeReleaseEvidence({ ...env, GITHUB_RUN_ATTEMPT: "2" }, root),
    ).rejects.toThrow("different deployment attempt");
    await writeReleaseEvidence(env, root);
    const evidence = JSON.parse(
      await readFile(env.KEEL_PREVIEW_RELEASE_EVIDENCE_PATH, "utf8"),
    );
    expect(evidence.d1.backupStorage).toMatchObject({
      provider: "r2",
      runId: "123",
      runAttempt: "1",
    });
    expect(evidence.workers).toEqual({
      apiVersionId: "api-1",
      webVersionId: "web-1",
    });
    await storePreviewEvidence("release", env, {
      management: management().request,
      objects: store.request,
    });
    expect(store.stored.has(`releases/${gitSha}/123-1/release.json`)).toBe(
      true,
    );
    const before = store.calls.length;
    await expect(
      storePreviewEvidence(
        "release",
        { ...env, GITHUB_RUN_ATTEMPT: "2" },
        { management: management().request, objects: store.request },
      ),
    ).rejects.toThrow("does not match");
    expect(store.calls).toHaveLength(before);
  });
});
