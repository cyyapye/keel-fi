import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  __providerBrowserReconnectTest,
  type ProviderBrowserRuntimeOptions,
} from "./provider-browser-reconnect";

function reconnectOptions(
  verifySavedSession: () => Promise<void>,
): ProviderBrowserRuntimeOptions {
  return {
    appDirectory: "/srv/keel/synthetic",
    profileDirectory: "/srv/keel/synthetic/Chrome",
    chromePath: "/usr/bin/chromium",
    startUrl: "https://app.tokenfolio.co/portfolio?tab=active",
    label: "Tokenfolio",
    provider: "tokenfolio",
    isProviderReady: () => Promise.resolve(true),
    verifySavedSession,
    authorization: {
      version: 1,
      target: "tokenfolio",
      apiOrigin: "https://keel.example.com",
      token: "a".repeat(43),
    },
    lease: {
      id: "11111111-1111-4111-8111-111111111111",
      leaseToken: "b".repeat(43),
      viewerSubject: "synthetic-access-subject",
      expiresAt: "2026-09-04T12:15:00.000Z",
    },
  };
}

describe("managed provider browser reconnect", () => {
  it("bounds network status checks for a full fifteen-minute active session", async () => {
    let now = Date.parse("2026-09-01T00:00:00Z");
    const expires = now + 15 * 60_000;
    const readStatus = vi.fn(() => Promise.resolve("ready" as const));
    const complete = vi.fn();
    await expect(
      __providerBrowserReconnectTest.pollActiveBrowserSession({
        expiresAt: new Date(expires).toISOString(),
        isAlive: () => true,
        readStatus,
        onOpened: () => Promise.resolve(false),
        complete,
        now: () => now,
        sleep: (milliseconds) => {
          now += milliseconds;
          return Promise.resolve();
        },
      }),
    ).resolves.toBe("terminated");
    expect(readStatus.mock.calls.length).toBeLessThanOrEqual(180);
    expect(now).toBe(expires);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "expired", "failed", "connected"] as const)(
    "stops active polling within five seconds of %s",
    async (terminal) => {
      let now = Date.parse("2026-09-01T00:00:00Z");
      const start = now;
      const complete = vi.fn();
      await expect(
        __providerBrowserReconnectTest.pollActiveBrowserSession({
          expiresAt: new Date(now + 15 * 60_000).toISOString(),
          isAlive: () => true,
          readStatus: () => Promise.resolve(now === start ? "ready" : terminal),
          onOpened: () => Promise.resolve(false),
          complete,
          now: () => now,
          sleep: (milliseconds) => {
            now += milliseconds;
            return Promise.resolve();
          },
        }),
      ).resolves.toBe("terminated");
      expect(now - start).toBeLessThanOrEqual(5_000);
      expect(complete).not.toHaveBeenCalled();
    },
  );

  it("does not complete when a delayed status response arrives after lease expiry", async () => {
    let now = Date.parse("2026-09-01T00:00:00Z");
    const expiresAt = new Date(now + 15 * 60_000).toISOString();
    const complete = vi.fn();
    const onOpened = vi.fn();
    const sleep = vi.fn();
    await expect(
      __providerBrowserReconnectTest.pollActiveBrowserSession({
        expiresAt,
        isAlive: () => true,
        readStatus: () => {
          now += 16 * 60_000;
          return Promise.resolve("opened");
        },
        onOpened,
        complete,
        now: () => now,
        sleep,
      }),
    ).resolves.toBe("terminated");
    expect(onOpened).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports connected only after closing and verifying the saved profile", async () => {
    const order: string[] = [];
    let finishVerification: () => void = () => undefined;
    const verified = new Promise<void>((resolve) => {
      finishVerification = resolve;
    });
    const complete = vi.fn(() => {
      order.push("complete");
      return Promise.resolve("connected" as const);
    });
    const pending = __providerBrowserReconnectTest.completeBrowserSession(
      reconnectOptions(async () => {
        order.push("verify");
        await verified;
      }),
      () => {
        order.push("close");
        return Promise.resolve();
      },
      complete,
    );
    await vi.waitFor(() => expect(order).toEqual(["close", "verify"]));
    expect(complete).not.toHaveBeenCalled();
    finishVerification();
    await expect(pending).resolves.toBe("connected");
    expect(order).toEqual(["close", "verify", "complete"]);
  });

  it.each(["close", "verify"])(
    "never reports success when %s fails",
    async (step) => {
      const complete = vi.fn();
      const verify = vi.fn(() => {
        if (step === "verify")
          return Promise.reject(new Error("synthetic session was not saved"));
        return Promise.resolve();
      });
      await expect(
        __providerBrowserReconnectTest.completeBrowserSession(
          reconnectOptions(verify),
          () => {
            if (step === "close")
              return Promise.reject(new Error("synthetic close failed"));
            return Promise.resolve();
          },
          complete,
        ),
      ).rejects.toThrow("synthetic");
      expect(complete).not.toHaveBeenCalled();
      expect(verify).toHaveBeenCalledTimes(step === "close" ? 0 : 1);
    },
  );

  it.each(["cancelled", "expired", "failed"] as const)(
    "honors a server %s outcome after verification",
    async (status) => {
      await expect(
        __providerBrowserReconnectTest.completeBrowserSession(
          reconnectOptions(() => Promise.resolve()),
          () => Promise.resolve(),
          () => Promise.resolve(status),
        ),
      ).resolves.toBe("terminated");
    },
  );

  it("does not re-complete a rejected or expired server lease", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("lease expired"));
    await expect(
      __providerBrowserReconnectTest.completeBrowserSession(
        reconnectOptions(() => Promise.resolve()),
        () => Promise.resolve(),
        complete,
      ),
    ).rejects.toThrow("lease expired");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("opens only the selected provider profile in visible loopback Chrome", () => {
    const arguments_ = __providerBrowserReconnectTest.remoteChromeArguments(
      "/srv/keel/profiles/angellist",
      41_337,
      "https://venture.angellist.com",
    );
    expect(arguments_).toContain(
      "--user-data-dir=/srv/keel/profiles/angellist",
    );
    expect(arguments_).toContain("--remote-debugging-address=127.0.0.1");
    expect(arguments_).toContain("--remote-debugging-port=41337");
    expect(arguments_).toContain("--window-size=1440,1000");
    expect(arguments_).toContain("https://venture.angellist.com");
    expect(arguments_).not.toContain("--headless=new");
    expect(arguments_.join(" ")).not.toContain("keel-preview");
  });

  it("keeps VNC loopback-only and injects its random credential", () => {
    const arguments_ = __providerBrowserReconnectTest.x11VncArguments(
      127,
      "/srv/keel/private/Xauthority",
      "/srv/keel/private/vnc-password",
      59_127,
    );
    expect(arguments_).toContain("-localhost");
    expect(arguments_).toContain("-passwdfile");
    expect(arguments_).toContain("/srv/keel/private/vnc-password");
    expect(arguments_).not.toContain("-nopw");

    const html = __providerBrowserReconnectTest.remoteBrowserHtml(
      "AngelList",
      "synthetic-random-password",
      "c".repeat(43),
      "f".repeat(43),
    );
    expect(html).toContain("Reconnect AngelList");
    expect(html).toContain(
      'credentials: { password: "synthetic-random-password" }',
    );
    expect(html).not.toContain("SSH");
    expect(html).not.toContain("Terminal");
  });

  it("probes only the lease nonce with service credentials and rejects redirects", async () => {
    const probe = {
      clientId: "a".repeat(32) + ".access",
      clientSecret: "synthetic-secret-".repeat(4),
      nonce: "c".repeat(43),
    };
    const url = new URL(
      `https://keel-tokenfolio-reconnect.example.com/_keel/ready/${probe.nonce}`,
    );
    const request = vi.fn(() => Promise.resolve(new Response(probe.nonce)));
    expect(
      await __providerBrowserReconnectTest.publicTunnelResponds(
        url,
        probe,
        request,
      ),
    ).toBe(true);
    expect(request).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          "CF-Access-Client-Id": probe.clientId,
          "CF-Access-Client-Secret": probe.clientSecret,
        }),
      }),
    );
    for (const response of [
      new Response("wrong lease"),
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.example.com" },
      }),
      new Response("unavailable", { status: 530 }),
    ]) {
      expect(
        await __providerBrowserReconnectTest.publicTunnelResponds(
          url,
          probe,
          () => Promise.resolve(response),
        ),
      ).toBe(false);
    }
  });

  it("records a viewer only after its loopback VNC connection succeeds", async () => {
    const viewerListeners: Array<(socket: Socket) => void> = [];
    const server = Object.assign(new EventEmitter(), {
      listening: false,
      unref() {
        return server;
      },
      listen(_port: number, _host: string, callback: () => void) {
        server.listening = true;
        callback();
        return server;
      },
      address() {
        return { address: "127.0.0.1", family: "IPv4", port: 41_337 };
      },
      close(callback?: () => void) {
        server.listening = false;
        callback?.();
        return server;
      },
    });
    const vnc = new PassThrough() as unknown as Socket;
    const viewer = new PassThrough() as unknown as Socket;
    const createConnection = vi.fn(() => vnc);
    const proxy = await __providerBrowserReconnectTest.startViewerProxy(
      59_123,
      {
        createConnection,
        createServer: (listener: (socket: Socket) => void) => {
          viewerListeners.push(listener);
          return server as unknown as Server;
        },
      },
    );
    try {
      expect(proxy.port).toBe(41_337);
      expect(proxy.connected()).toBe(false);
      const acceptViewer = viewerListeners[0];
      if (acceptViewer === undefined) {
        throw new Error("The viewer proxy did not register its listener.");
      }
      acceptViewer(viewer);
      expect(createConnection).toHaveBeenCalledWith({
        host: "127.0.0.1",
        port: 59_123,
      });
      expect(proxy.connected()).toBe(false);
      vnc.emit("connect");
      expect(proxy.connected()).toBe(true);
    } finally {
      await proxy.close();
    }
  });

  it("cannot hang teardown when a child exits during forced shutdown", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        kill: (signal: NodeJS.Signals) => boolean;
      };
      child.exitCode = null;
      child.kill = vi.fn((signal: NodeJS.Signals) => {
        if (signal === "SIGKILL") {
          child.emit("exit", null, signal);
        }
        return true;
      });

      const stopped = __providerBrowserReconnectTest.stopChild(
        child as unknown as ChildProcess,
      );
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(stopped).resolves.toBeUndefined();
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
