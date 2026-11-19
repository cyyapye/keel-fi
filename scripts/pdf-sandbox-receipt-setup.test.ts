import type * as FsPromises from "node:fs/promises";
import type { dockerCommand } from "./pdf-sandbox";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./pdf-sandbox-publication", () => ({
  withPdfPublicationLock: async (
    _socket: string,
    action: () => Promise<unknown>,
  ) => action(),
}));
vi.mock("./pdf-scanner-receipt", () => ({
  readScannerReceipt: vi.fn(),
  writeScannerReceipt: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof FsPromises>()),
  stat: () => Promise.resolve({ isSocket: () => true }),
}));
vi.mock("./pdf-sandbox", async () => {
  const { z } = await import("zod");
  return {
    PdfSandboxConfigSchema: z.object({
      version: z.literal(1),
      socket: z.string(),
      image: z.string(),
    }),
    assertSandboxEngine: () => {},
    sandboxConfigPath: () => {
      throw Error("explicit fixture required");
    },
    dockerCommand: () => {
      throw Error("no real daemon allowed");
    },
  };
});
import { readScannerReceipt, writeScannerReceipt } from "./pdf-scanner-receipt";
import { registerPdfSandbox, bootstrapPdfSandbox } from "./pdf-sandbox-setup";

let root: string;
const receipt = {
  image: "sha256:" + "2".repeat(64),
  factoryDigest: "synthetic",
  proof: "clean",
} as unknown as Awaited<ReturnType<typeof readScannerReceipt>>;
let options: {
  configPath: string;
  sharedPath: string;
  transport: typeof dockerCommand;
};
const bindings = {
  version: 1,
  reader: {
    version: 1,
    socket: "/synthetic.sock",
    image: "sha256:" + "1".repeat(64),
  },
  scanner: {
    version: 1,
    socket: "/synthetic.sock",
    image: "sha256:" + "2".repeat(64),
  },
  probe: {
    version: 1,
    socket: "/synthetic.sock",
    image: "sha256:" + "3".repeat(64),
  },
};
beforeEach(async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.stubEnv("CI", "");
  root = await mkdtemp(join(tmpdir(), "receipt-setup-synthetic-"));
  options = {
    configPath: join(root, "local/runtime.json"),
    sharedPath: join(root, "shared/runtime.json"),
    transport: () => (args: string[]) =>
      Promise.resolve({
        code: 0,
        ready: true,
        output: JSON.stringify(
          args[0] === "info"
            ? {}
            : Object.values(bindings)
                .filter((v) => typeof v === "object")
                .map((v) => ({ Id: v.image })),
        ),
      }),
  };
  await mkdir(dirname(options.configPath), { mode: 0o700 });
  for (const name of ["reader", "probe", "scanner"] as const)
    await writeFile(
      options.configPath + (name === "reader" ? "" : "." + name),
      JSON.stringify(bindings[name]),
      { mode: 0o600 },
    );
  vi.mocked(readScannerReceipt).mockReset().mockResolvedValue(receipt);
  vi.mocked(writeScannerReceipt)
    .mockReset()
    .mockImplementation(async (path) => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
    });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("copies valid receipt before registration, so failed copy cannot publish a new pointer", async () => {
  vi.mocked(writeScannerReceipt).mockRejectedValueOnce(
    Error("simulated crash"),
  );
  await expect(registerPdfSandbox(options)).rejects.toThrow("simulated crash");
  await expect(readFile(options.sharedPath)).rejects.toThrow();
  await registerPdfSandbox(options);
  expect(readScannerReceipt).toHaveBeenCalledWith(
    bindings.scanner,
    options.configPath + ".scanner.receipt",
  );
  expect(writeScannerReceipt).toHaveBeenCalledWith(
    options.sharedPath + ".scanner.receipt",
    receipt,
  );
});
it("missing or invalid source receipt does not mint eligibility or block registration", async () => {
  vi.mocked(readScannerReceipt).mockRejectedValue(
    Error("private detail must not leak"),
  );
  await registerPdfSandbox(options);
  expect(writeScannerReceipt).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith("PDF_SCANNER_RECEIPT_UNAVAILABLE");
  expect(JSON.parse(await readFile(options.sharedPath, "utf8"))).toEqual(
    bindings,
  );
});
it("fresh bootstrap imports matching receipt but preserves conflicting local sidecar", async () => {
  await registerPdfSandbox(options);
  const fresh = join(root, "fresh/runtime.json");
  await bootstrapPdfSandbox({ ...options, configPath: fresh });
  expect(writeScannerReceipt).toHaveBeenLastCalledWith(
    fresh + ".scanner.receipt",
    receipt,
  );
  const other = join(root, "other/runtime.json");
  await mkdir(dirname(other));
  await writeFile(other + ".scanner.receipt", "manual");
  vi.mocked(readScannerReceipt).mockImplementation((_config, path) =>
    Promise.resolve(
      path === other + ".scanner.receipt"
        ? ({ manual: true } as unknown as typeof receipt)
        : receipt,
    ),
  );
  await bootstrapPdfSandbox({ ...options, configPath: other });
  expect(await readFile(other + ".scanner.receipt", "utf8")).toBe("manual");
  expect(console.warn).toHaveBeenCalledWith(
    "PDF_SCANNER_RECEIPT_CONFLICT_PRESERVED",
  );
});
it("complete local bindings never import receipt from a different registry", async () => {
  await mkdir(dirname(options.sharedPath), { mode: 0o700 });
  await writeFile(options.sharedPath, JSON.stringify(bindings), {
    mode: 0o600,
  });
  await bootstrapPdfSandbox(options);
  expect(readScannerReceipt).not.toHaveBeenCalled();
  expect(writeScannerReceipt).not.toHaveBeenCalled();
});
it.each(["linux", "CI"])(
  "leaves %s setup receipt behavior unchanged",
  async (mode) => {
    if (mode === "CI") vi.stubEnv("CI", "true");
    else vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    await registerPdfSandbox(options);
    await bootstrapPdfSandbox({
      ...options,
      configPath: join(root, "fresh/runtime.json"),
    });
    expect(readScannerReceipt).not.toHaveBeenCalled();
    expect(writeScannerReceipt).not.toHaveBeenCalled();
  },
);

it("bootstrap seeds an absent registry with matching local receipt before config", async () => {
  await bootstrapPdfSandbox(options);
  expect(readScannerReceipt).toHaveBeenCalledWith(
    bindings.scanner,
    options.configPath + ".scanner.receipt",
  );
  expect(writeScannerReceipt).toHaveBeenCalledWith(
    options.sharedPath + ".scanner.receipt",
    receipt,
  );
});
