import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  __providerBrowserReconnectTest,
  cloudflaredQuickTunnelUrl,
} from "./provider-browser-reconnect";

describe("managed provider browser reconnect", () => {
  it("accepts only the temporary HTTPS tunnel URL from bounded output", () => {
    expect(
      cloudflaredQuickTunnelUrl(
        "INF Requesting new quick Tunnel\nhttps://synthetic-quiet-brook.trycloudflare.com ready",
      )?.toString(),
    ).toBe("https://synthetic-quiet-brook.trycloudflare.com/");
    expect(cloudflaredQuickTunnelUrl("http://127.0.0.1:6080")).toBeNull();
    expect(
      cloudflaredQuickTunnelUrl("https://trycloudflare.com.invalid"),
    ).toBeNull();
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
    );
    expect(html).toContain("Reconnect AngelList");
    expect(html).toContain(
      'credentials: { password: "synthetic-random-password" }',
    );
    expect(html).not.toContain("SSH");
    expect(html).not.toContain("Terminal");
  });

  it("waits for the exact public browser page instead of a tunnel URL alone", async () => {
    const liveUrl = new URL(
      "https://synthetic-quiet-brook.trycloudflare.com/random.html",
    );
    const unavailable =
      await __providerBrowserReconnectTest.publicTunnelResponds(liveUrl, () =>
        Promise.resolve(
          new Response("Cloudflare Tunnel error", { status: 530 }),
        ),
      );
    const wrongPage = await __providerBrowserReconnectTest.publicTunnelResponds(
      liveUrl,
      () =>
        Promise.resolve(
          new Response("<!doctype html><title>Not found</title>"),
        ),
    );
    const ready = await __providerBrowserReconnectTest.publicTunnelResponds(
      liveUrl,
      () =>
        Promise.resolve(
          new Response(
            __providerBrowserReconnectTest.remoteBrowserHtml(
              "Tokenfolio",
              "synthetic-random-password",
            ),
          ),
        ),
    );

    expect(unavailable).toBe(false);
    expect(wrongPage).toBe(false);
    expect(ready).toBe(true);
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
