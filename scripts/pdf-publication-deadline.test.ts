import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), close: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  realpath: (path: string) => Promise.resolve(path),
  mkdir: async () => {},
  lstat: () =>
    Promise.resolve({
      isDirectory: () => true,
      uid: process.getuid!(),
      mode: 0o700,
    }),
  open: () => Promise.resolve({ fd: 9, close: mocks.close }),
}));
import { withPdfPublicationLock } from "./pdf-sandbox-publication";
class Child extends EventEmitter {
  kill = vi.fn();
}
let child: Child;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.stubEnv("CI", "");
  vi.stubEnv("KEEL_PDF_PUBLICATION_FDS", undefined);
  child = new Child();
  mocks.spawn.mockReturnValue(child);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
it.each([null, 0])(
  "publication validator rejects exit %s after its deadline fires",
  async (exitCode) => {
    const action = vi.fn();
    const result = withPdfPublicationLock("/synthetic/socket", action).catch(
      (error: Error) => error,
    );
    await flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    child.emit("close", exitCode);
    expect(await result).toBeInstanceOf(Error);
    expect(action).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(2);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it.each(["success", "error"])(
  "%s clears publication deadline and closes owned handles",
  async (outcome) => {
    const action = vi.fn().mockResolvedValue("published");
    const result = withPdfPublicationLock("/synthetic/socket", action).catch(
      (error: Error) => error,
    );
    await flush();
    if (outcome === "success") child.emit("close", 0);
    else child.emit("error", new Error("synthetic spawn failure"));
    const value = await result;
    if (outcome === "success") expect(value).toBe("published");
    else {
      expect(value).toBeInstanceOf(Error);
      expect(action).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  },
);
