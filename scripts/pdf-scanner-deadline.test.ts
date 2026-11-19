import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  kill: vi.fn(),
  scan: vi.fn(),
  receipt: vi.fn(),
  finish: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  lstat: () =>
    Promise.resolve({
      isDirectory: () => true,
      isFile: () => true,
      uid: process.getuid!(),
      mode: 0o700,
      size: 2,
      dev: 1,
      ino: 1,
    }),
  readFile: () => Promise.resolve("{}"),
  mkdtemp: () => Promise.resolve("/synthetic/candidate"),
  writeFile: async () => {},
  rename: mocks.rename,
  rm: mocks.rm,
}));
vi.mock("./pdf-sandbox", () => ({
  loadSandboxConfig: () =>
    Promise.resolve({
      socket: "/synthetic/socket",
      image: "synthetic",
    }),
  scanDocumentInSandbox: mocks.scan,
}));
vi.mock("./pdf-scanner-receipt", () => ({ readScannerReceipt: mocks.receipt }));
vi.mock("./pdf-sandbox-publication", () => ({
  withPdfPublicationLock: async (
    _socket: string,
    action: () => Promise<unknown>,
  ) => action(),
  publicationChildOptions: () => ({
    env: {},
    stdio: ["ignore", "pipe", "ignore", 3, 4],
  }),
}));
vi.mock("./pdf-sandbox-setup", () => ({
  checkPdfSandbox: () =>
    Promise.resolve({
      scanner: { socket: "/synthetic/socket", image: "synthetic" },
    }),
  sharedPdfSandboxPath: () => "/synthetic/registry",
  registerPdfSandbox: async () => {},
}));
vi.mock("./pdf-scanner-maintenance", () => ({
  beginScannerMaintenance: () => Promise.resolve({ id: "synthetic" }),
  finishScannerMaintenance: mocks.finish,
}));
import { scannerForLocalOperation } from "./pdf-scanner-auto";

class Child extends EventEmitter {
  pid = 123456;
  stdout = new EventEmitter();
}
let children: Child[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  children = [];
  mocks.spawn.mockImplementation(() => {
    const child = new Child();
    children.push(child);
    return child;
  });
  mocks.kill.mockReturnValue(true);
  vi.spyOn(process, "kill").mockImplementation(mocks.kill);
  mocks.receipt.mockResolvedValue({
    scan: {
      databaseUpdatedAt: new Date(Date.now() - 73 * 3600000).toISOString(),
    },
  });
  mocks.finish.mockResolvedValue(false);
  mocks.scan.mockResolvedValue({ outcome: "clean" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

it("fresh local scan starts no maintenance subprocess or deadline", async () => {
  mocks.receipt.mockResolvedValue({
    scan: { databaseUpdatedAt: new Date().toISOString() },
  });
  await scannerForLocalOperation()(new Uint8Array());
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(mocks.scan).toHaveBeenCalledOnce();
});

it("idle probe kills once at 15 seconds and never builds or retries", async () => {
  const scan = scannerForLocalOperation();
  const result = scan(new Uint8Array()).catch((error: Error) => error);
  await flush();
  expect(children).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(14999);
  expect(mocks.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.kill).toHaveBeenCalledExactlyOnceWith(-123456, "SIGKILL");
  children[0]!.emit("close", null);
  expect(await result).toBeInstanceOf(Error);
  await expect(scan(new Uint8Array())).rejects.toThrow("already_attempted");
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("builder gets 420 seconds after successful idle check and retains uncertain proof", async () => {
  const result = scannerForLocalOperation()(new Uint8Array()).catch(
    (error: Error) => error,
  );
  await flush();
  children[0]!.emit("close", 0);
  await flush();
  expect(children).toHaveLength(2);
  expect(mocks.spawn.mock.calls[1]![1]).toContain(
    "scripts/pdf-sandbox-build.ts",
  );
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(419999);
  expect(mocks.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.kill).toHaveBeenCalledExactlyOnceWith(-123456, "SIGKILL");
  children[1]!.emit("close", null);
  expect(await result).toBeInstanceOf(Error);
  expect(mocks.finish).toHaveBeenCalledOnce();
  expect(mocks.rm).not.toHaveBeenCalled();
  expect(mocks.rename).not.toHaveBeenCalled();
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("successful child exits cancel deadlines before adopting and scanning", async () => {
  mocks.finish.mockResolvedValue(true);
  const result = scannerForLocalOperation()(new Uint8Array());
  await flush();
  children[0]!.emit("close", 0);
  await flush();
  children[1]!.emit("close", 0);
  await result;
  await vi.advanceTimersByTimeAsync(500000);
  expect(mocks.kill).not.toHaveBeenCalled();
  expect(mocks.scan).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("spawn error clears the deadline without retry or build", async () => {
  const result = scannerForLocalOperation()(new Uint8Array()).catch(
    (error: Error) => error,
  );
  await flush();
  children[0]!.emit("error", new Error("synthetic spawn failure"));
  expect(await result).toBeInstanceOf(Error);
  await vi.advanceTimersByTimeAsync(500000);
  expect(mocks.kill).not.toHaveBeenCalled();
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("oversized child output stops the group and cannot be accepted as success", async () => {
  const result = scannerForLocalOperation()(new Uint8Array()).catch(
    (error: Error) => error,
  );
  await flush();
  children[0]!.stdout.emit("data", Buffer.alloc(16385));
  expect(mocks.kill).toHaveBeenCalledExactlyOnceWith(-123456, "SIGKILL");
  children[0]!.emit("close", 0);
  expect(await result).toBeInstanceOf(Error);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
