import { describe, expect, it } from "vitest";
import { createConnection, createServer } from "node:net";

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

  it("records a real viewer connection while keeping VNC behind loopback", async () => {
    const vnc = createServer((socket) => {
      socket.pipe(socket);
    });
    await new Promise<void>((resolve) =>
      vnc.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = vnc.address();
    if (address === null || typeof address === "string") {
      throw new Error("Synthetic VNC server did not start.");
    }
    const proxy = await __providerBrowserReconnectTest.startViewerProxy(
      address.port,
    );
    const viewer = createConnection({ host: "127.0.0.1", port: proxy.port });
    try {
      await new Promise<void>((resolve, reject) => {
        viewer.once("connect", resolve);
        viewer.once("error", reject);
      });
      await expect.poll(() => proxy.connected()).toBe(true);
      viewer.write("synthetic-viewer-handshake");
      const echoed = await new Promise<string>((resolve, reject) => {
        viewer.once("data", (chunk) => resolve(chunk.toString()));
        viewer.once("error", reject);
      });
      expect(echoed).toBe("synthetic-viewer-handshake");
    } finally {
      viewer.destroy();
      await proxy.close();
      await new Promise<void>((resolve) => vnc.close(() => resolve()));
    }
  });
});
