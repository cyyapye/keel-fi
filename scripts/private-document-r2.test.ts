import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { privateR2 } from "./private-document-r2";
import {
  publishEncryptedBackup,
  runPrivateDocumentBackupJob,
} from "./private-document-backup-job";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("restricted backup object boundary", () => {
  it("uses header signatures on a fixed HTTPS S3 origin, never public links or redirects", async () => {
    const fetcher = vi.fn<(input: Request) => Promise<Response>>(() =>
      Promise.resolve(new Response("synthetic")),
    );
    vi.stubGlobal("fetch", fetcher);
    const request = privateR2({
      account: "a".repeat(32),
      bucket: "synthetic-backups",
      accessKeyId: "synthetic-key-id-01",
      secretAccessKey: "synthetic-secret-only".repeat(3),
    });
    await request("daily/synthetic copy.gpg");
    const signed = fetcher.mock.calls[0]?.[0] as Request;
    expect(signed.url).toBe(
      `https://${"a".repeat(32)}.r2.cloudflarestorage.com/synthetic-backups/daily/synthetic%20copy.gpg`,
    );
    expect(signed.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
    expect(signed.url).not.toContain("synthetic-key-id");
    expect(signed.redirect).toBe("error");
    await expect(request("../another-bucket/private")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires explicit activation before using any credentials", async () => {
    vi.stubEnv("KEEL_PRIVATE_DOCUMENT_BACKUPS_ENABLED", "false");
    await expect(runPrivateDocumentBackupJob()).rejects.toThrow("activation");
  });
  it("requires complete encrypted read-back and uses a fresh conditional key on each attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keel-backup-publish-test-"));
    const archive = join(dir, "synthetic.gpg");
    try {
      await writeFile(archive, "synthetic encrypted bytes", { mode: 0o600 });
      const keys: string[] = [];
      const request = vi.fn(async (key: string, init?: RequestInit) => {
        keys.push(key);
        if (init?.method === "PUT") {
          expect(new Headers(init.headers).get("If-None-Match")).toBe("*");
          expect(await (init.body as Blob).text()).toBe(
            "synthetic encrypted bytes",
          );
          return new Response(null, { status: 200 });
        }
        return new Response("synthetic encrypted bytes");
      });
      await expect(publishEncryptedBackup(archive, request)).resolves.toMatch(
        /^[a-f0-9]{64}$/u,
      );
      await publishEncryptedBackup(archive, request);
      expect(keys[0]).toBe(keys[1]);
      expect(keys[0]).not.toBe(keys[2]);
      const corrupt = (_key: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === "PUT" ? new Response(null) : new Response("corrupt"),
        );
      await expect(publishEncryptedBackup(archive, corrupt)).rejects.toThrow(
        "mismatch",
      );
      await expect(
        publishEncryptedBackup(archive, () =>
          Promise.resolve(new Response(null, { status: 403 })),
        ),
      ).rejects.toThrow("upload failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
