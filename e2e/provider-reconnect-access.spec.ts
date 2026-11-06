import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import type { Socket } from "node:net";

import { expect, test } from "@playwright/test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { __providerBrowserReconnectTest } from "../scripts/provider-browser-reconnect";
import { startReconnectAccessGateway } from "../scripts/provider-reconnect-access";

const openPath =
  "/api/automation/provider-browser/sessions/11111111-1111-4111-8111-111111111111/open";

test(
  "opens the reconnect interstitial through one explicit same-origin POST",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const methods: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === openPath) {
        methods.push(request.method());
        if (request.method() === "POST")
          expect(request.headers()["x-keel-reconnect-open"]).toBe("1");
      }
    });
    await page.goto(openPath);
    await expect(page.getByRole("status")).toHaveText(
      "The secure browser is not ready or was already opened. Return to Keel to check the reconnect.",
    );
    expect(methods).toEqual(["GET", "POST"]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const viewerUrl = `https://keel-tokenfolio-reconnect.example.com/${"c".repeat(43)}.html`;
    await page.route(`**${openPath}`, async (route) => {
      if (route.request().method() === "POST")
        await route.fulfill({ json: { liveUrl: viewerUrl } });
      else await route.continue();
    });
    await page.route(viewerUrl, async (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<p>Synthetic authenticated viewer</p>",
      }),
    );
    await page.reload();
    await expect(page).toHaveURL(viewerUrl);
    await expect(
      page.getByText("Synthetic authenticated viewer"),
    ).toBeVisible();
    expect(methods).toEqual(["GET", "POST", "GET", "POST"]);
  },
);

test(
  "connects and paints the generated viewer through the authenticated gateway",
  { tag: "@mobile-only" },
  async ({ page }) => {
    const sockets = new Set<Socket>();
    const requestedProtocols: Array<string | undefined> = [];
    const html = __providerBrowserReconnectTest
      .remoteBrowserHtml(
        "Tokenfolio",
        "synthetic-viewer-password",
        "c".repeat(43),
        "f".repeat(43),
      )
      // Use an ordinary same-origin loopback server for the synthetic transport.
      .replace('"wss://"', '"ws://"');
    const stream = createServer((request, response) => {
      if (request.url === "/core/rfb.js") {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        // Keep noVNC's default of requesting no subprotocols. The browser itself
        // validates the real WebSocket upgrade against the generated options.
        response.end(`export default class SyntheticRFB extends EventTarget {
        constructor(target, url, options) {
          super();
          const stream = new WebSocket(url, options.wsProtocols || []);
          stream.addEventListener("open", () => {
            target.textContent = "Synthetic authenticated viewer";
            this.dispatchEvent(new Event("connect"));
            // noVNC decodes compressed frames and cursors through data images.
            const frame = new Image();
            frame.addEventListener("load", () => {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              canvas.style.cssText = "width: 100px; height: 100px";
              canvas.setAttribute("role", "img");
              canvas.setAttribute("aria-label", "Synthetic browser frame");
              canvas.getContext("2d").drawImage(frame, 0, 0);
              target.append(canvas);
            });
            frame.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
          });
          stream.addEventListener("close", () => this.dispatchEvent(new Event("disconnect")));
        }
      }`);
      } else {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(html);
      }
    });
    const viewer = createServer();
    for (const server of [stream, viewer])
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
    viewer.on("upgrade", (request, socket) => {
      requestedProtocols.push(request.headers["sec-websocket-protocol"]);
      const accept = createHash("sha1")
        .update(
          String(request.headers["sec-websocket-key"]) +
            "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
        )
        .digest("base64");
      // Match the gateway's binary selection. The browser rejects this response
      // unless the generated viewer explicitly requested the same subprotocol.
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`,
      );
    });
    await new Promise<void>((resolve) =>
      stream.listen(0, "127.0.0.1", resolve),
    );
    await new Promise<void>((resolve) =>
      viewer.listen(0, "127.0.0.1", resolve),
    );
    const address = stream.address();
    const viewerAddress = viewer.address();
    if (
      address === null ||
      typeof address === "string" ||
      viewerAddress === null ||
      typeof viewerAddress === "string"
    )
      throw new Error("Synthetic viewer stream is unavailable.");
    let gateway:
      Awaited<ReturnType<typeof startReconnectAccessGateway>> | undefined;
    try {
      const origin = `http://127.0.0.1:${viewerAddress.port}`;
      const keys = await generateKeyPair("RS256");
      const assertion = await new SignJWT({
        type: "app",
        sub: "synthetic-viewer",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://synthetic.cloudflareaccess.com")
        .setAudience("a".repeat(64))
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(keys.privateKey);
      gateway = await startReconnectAccessGateway({
        config: {
          version: 1,
          provider: "tokenfolio",
          apiOrigin: "https://keel-agents.example.com",
          // Ordinary loopback HTTP is used only for this synthetic transport.
          publicOrigin: origin,
          teamDomain: "synthetic.cloudflareaccess.com",
          audience: "a".repeat(64),
          listenPort: 0,
          tunnelTokenFile: "/synthetic/tunnel-token",
          probeCredentialsFile: "/synthetic/probe.json",
        },
        probeClientId: "e".repeat(32) + ".access",
        probeNonce: "d".repeat(43),
        viewerSubject: "synthetic-viewer",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        accessToken: "c".repeat(43),
        scriptNonce: "f".repeat(43),
        backendPort: address.port,
        keys: createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }),
      });
      viewer.on("request", (incoming, response) => {
        const outgoing = request(
          {
            hostname: "127.0.0.1",
            port: gateway!.port,
            path: incoming.url,
            headers: {
              Host: new URL(origin).host,
              "Cf-Access-Jwt-Assertion": assertion,
            },
          },
          (result) => {
            // Match the viewer's loopback ws transport; retain every other directive
            // from the real authenticated gateway, including its image policy.
            const policy = String(
              result.headers["content-security-policy"],
            ).replace(
              `connect-src 'self' ${origin}`,
              `connect-src 'self' ${origin.replace("http:", "ws:")}`,
            );
            response.writeHead(result.statusCode ?? 502, {
              ...result.headers,
              "content-security-policy": policy,
            });
            result.pipe(response);
          },
        );
        outgoing.once("error", () => response.destroy());
        outgoing.end();
      });
      await page.goto(`${origin}/${"c".repeat(43)}.html`);
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(
        page.getByText("Synthetic authenticated viewer"),
      ).toBeVisible();
      const frame = page.getByRole("img", { name: "Synthetic browser frame" });
      await expect(frame).toBeVisible({ timeout: 5000 });
      expect(
        await frame.evaluate((canvas: HTMLCanvasElement) =>
          Array.from(canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data),
        ),
      ).toEqual([255, 0, 0, 255]);
      expect(requestedProtocols).toEqual(["binary"]);
    } finally {
      await gateway?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        viewer.close((error) => (error ? reject(error) : resolve())),
      );
      await new Promise<void>((resolve, reject) =>
        stream.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

test(
  "a passive reconnect GET does not consume a link when scripts are disabled",
  { tag: "@desktop-only" },
  async ({ browser, baseURL, isMobile }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      ...(baseURL === undefined ? {} : { baseURL }),
      viewport: isMobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const methods: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === openPath)
        methods.push(request.method());
    });
    try {
      await page.goto(openPath);
      await expect(page.getByRole("status")).toHaveText(
        "Opening your secure browser…",
      );
      expect(methods).toEqual(["GET"]);
    } finally {
      await context.close();
    }
  },
);
