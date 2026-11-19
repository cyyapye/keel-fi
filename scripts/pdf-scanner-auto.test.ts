import { describe, it, expect, vi } from "vitest";
import {
  scannerForLocalOperation,
  localAutoRefreshEnabled,
} from "./pdf-scanner-auto";

function fixture() {
  const config = {
    version: 1 as const,
    socket: "/synthetic/socket",
    image: `sha256:${"a".repeat(64)}`,
  };
  const now = 1800000000000;
  const deps = {
    current: vi.fn().mockResolvedValue(config),
    timestamp: vi.fn().mockResolvedValue(now - 1000),
    lock: async <T>(_socket: string, action: () => Promise<T>) => action(),
    idle: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    scan: vi.fn().mockResolvedValue({ outcome: "clean" }),
    now: () => now,
  };
  return { deps, config, now, scan: scannerForLocalOperation(deps) };
}

describe("local stale-only scanner preparation", () => {
  it("does not enable Linux, CI or service override paths", () => {
    expect(localAutoRefreshEnabled("linux", {})).toBe(false);
    expect(localAutoRefreshEnabled("darwin", { CI: "true" })).toBe(false);
    expect(
      localAutoRefreshEnabled("darwin", {
        KEEL_PDF_SANDBOX_CONFIG: "/service/runtime",
      }),
    ).toBe(false);
    expect(localAutoRefreshEnabled("darwin", {})).toBe(true);
  });
  it("fresh immutable vendor evidence never rebuilds and scan errors never refresh", async () => {
    const f = fixture();
    await f.scan(new Uint8Array());
    f.deps.scan.mockRejectedValueOnce(new Error("unreadable"));
    await expect(f.scan(new Uint8Array())).rejects.toThrow("unreadable");
    expect(f.deps.refresh).not.toHaveBeenCalled();
    expect(f.deps.timestamp).toHaveBeenCalledTimes(2);
  });
  it("confirmed stale is rechecked under lock and refreshes once", async () => {
    const f = fixture();
    f.deps.timestamp.mockResolvedValue(f.now - 73 * 3600000);
    await f.scan(new Uint8Array());
    expect(f.deps.timestamp).toHaveBeenCalledTimes(2);
    expect(f.deps.refresh).toHaveBeenCalledTimes(1);
    await expect(f.scan(new Uint8Array())).rejects.toThrow("already_attempted");
    expect(f.deps.refresh).toHaveBeenCalledTimes(1);
  });
  it("a concurrent successful refresh is respected on locked recheck", async () => {
    const f = fixture();
    f.deps.timestamp
      .mockResolvedValueOnce(f.now - 73 * 3600000)
      .mockResolvedValue(f.now - 1000);
    await f.scan(new Uint8Array());
    expect(f.deps.refresh).not.toHaveBeenCalled();
  });
  it("busy admission never downloads or scans", async () => {
    const f = fixture();
    f.deps.timestamp.mockResolvedValue(f.now - 73 * 3600000);
    f.deps.lock = () => Promise.reject(new Error("busy"));
    await expect(f.scan(new Uint8Array())).rejects.toThrow("busy");
    expect(f.deps.refresh).not.toHaveBeenCalled();
    expect(f.deps.scan).not.toHaveBeenCalled();
  });
  it("dirty ownership or active scanner fails before any build", async () => {
    const f = fixture();
    f.deps.timestamp.mockResolvedValue(f.now - 73 * 3600000);
    f.deps.idle.mockRejectedValue(new Error("owner_recovery_required"));
    await expect(f.scan(new Uint8Array())).rejects.toThrow(
      "owner_recovery_required",
    );
    expect(f.deps.refresh).not.toHaveBeenCalled();
  });
  it("missing invalid and future evidence never refresh", async () => {
    for (const value of [NaN, Infinity, 1800000000001]) {
      const f = fixture();
      f.deps.timestamp.mockResolvedValue(value);
      await expect(f.scan(new Uint8Array())).rejects.toThrow();
      expect(f.deps.refresh).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.deps.current.mockRejectedValue(new Error("missing"));
    await expect(f.scan(new Uint8Array())).rejects.toThrow("missing");
    expect(f.deps.timestamp).not.toHaveBeenCalled();
  });
  it("failure is fail-closed and not automatically retried", async () => {
    const f = fixture();
    f.deps.timestamp.mockResolvedValue(f.now - 73 * 3600000);
    f.deps.refresh.mockRejectedValue(new Error("preflight failed"));
    await expect(f.scan(new Uint8Array())).rejects.toThrow("preflight failed");
    await expect(f.scan(new Uint8Array())).rejects.toThrow("already_attempted");
    expect(f.deps.refresh).toHaveBeenCalledTimes(1);
    expect(f.deps.scan).not.toHaveBeenCalled();
  });
  it("oversized input and changed daemon cannot trigger a build", async () => {
    const f = fixture();
    await expect(f.scan(new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow(
      "invalid_scanner_input",
    );
    expect(f.deps.timestamp).not.toHaveBeenCalled();
    f.deps.timestamp.mockResolvedValue(f.now - 73 * 3600000);
    f.deps.current
      .mockResolvedValueOnce(f.config)
      .mockResolvedValueOnce({ ...f.config, socket: "/other" });
    await expect(f.scan(new Uint8Array())).rejects.toThrow("runtime_changed");
    expect(f.deps.refresh).not.toHaveBeenCalled();
  });
});
