import {
  mkdtemp,
  readFile,
  rm,
  stat,
  chmod,
  writeFile,
  symlink,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  readProviderGoogleAccount,
  storeProviderGoogleAccount,
} from "./provider-google-account";

it("keeps verified Google identity scoped to a private provider profile and rejects unsafe records", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "keel-synthetic-google-"),
  );
  const other = await mkdtemp(path.join(os.tmpdir(), "keel-synthetic-other-"));
  const file = path.join(directory, "provider-google-account.json");
  try {
    expect(await readProviderGoogleAccount(directory, "tokenfolio")).toBeNull();
    await storeProviderGoogleAccount(directory, "tokenfolio", "a".repeat(64));
    expect(await readProviderGoogleAccount(directory, "tokenfolio")).toBe(
      "a".repeat(64),
    );
    expect(await readProviderGoogleAccount(other, "tokenfolio")).toBeNull();
    await expect(
      readProviderGoogleAccount(directory, "sydecar"),
    ).rejects.toThrow("Invalid private provider account binding.");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1,
      provider: "tokenfolio",
      accountHash: "a".repeat(64),
    });
    expect(await readdir(directory)).toEqual(["provider-google-account.json"]);
    await rm(file, { force: true });
    await writeFile(file, "x".repeat(257), { mode: 0o600 });
    await expect(
      readProviderGoogleAccount(directory, "tokenfolio"),
    ).rejects.toThrow("Invalid private provider account binding.");
    await storeProviderGoogleAccount(directory, "tokenfolio", "a".repeat(64));
    await chmod(file, 0o644);
    await expect(
      readProviderGoogleAccount(directory, "tokenfolio"),
    ).rejects.toThrow("Invalid private provider account binding.");
    await rm(file, { force: true });
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        provider: "tokenfolio",
        accountHash: "a".repeat(64),
        email: "synthetic@example.invalid",
      }),
      { mode: 0o600 },
    );
    const error = await readProviderGoogleAccount(
      directory,
      "tokenfolio",
    ).catch((value: unknown) => value);
    expect(String(error)).not.toContain("synthetic@example.invalid");
    expect(error).toBeInstanceOf(Error);
    await rm(file, { force: true });
    await symlink(path.join(other, "missing"), file);
    await expect(
      readProviderGoogleAccount(directory, "tokenfolio"),
    ).rejects.toThrow("Invalid private provider account binding.");
    await rm(file, { force: true });
    await storeProviderGoogleAccount(directory, "tokenfolio", "b".repeat(64));
    expect(await readProviderGoogleAccount(directory, "tokenfolio")).toBe(
      "b".repeat(64),
    );
    await rm(file, { force: true });
    expect(await readProviderGoogleAccount(directory, "tokenfolio")).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});
