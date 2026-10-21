import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";

import { expect, test } from "@playwright/test";

import { __providerBrowserReconnectTest } from "../scripts/provider-browser-reconnect";

const openPath =
  "/api/automation/provider-browser/sessions/11111111-1111-4111-8111-111111111111/open";

test("opens the reconnect interstitial through one explicit same-origin POST", async ({
  page,
}) => {
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
  await expect(page.getByText("Synthetic authenticated viewer")).toBeVisible();
  expect(methods).toEqual(["GET", "POST", "GET", "POST"]);
});

test("connects the generated viewer with the gateway binary WebSocket protocol", async ({
  page,
}) => {
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
          });
          stream.addEventListener("close", () => this.dispatchEvent(new Event("disconnect")));
        }
      }`);
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(html);
    }
  });
  stream.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  stream.on("upgrade", (request, socket) => {
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
  await new Promise<void>((resolve) => stream.listen(0, "127.0.0.1", resolve));
  const address = stream.address();
  if (address === null || typeof address === "string")
    throw new Error("Synthetic viewer stream is unavailable.");
  try {
    await page.goto(`http://127.0.0.1:${address.port}/${"c".repeat(43)}.html`);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(
      page.getByText("Synthetic authenticated viewer"),
    ).toBeVisible();
    expect(requestedProtocols).toEqual(["binary"]);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      stream.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("a passive reconnect GET does not consume a link when scripts are disabled", async ({
  browser,
  baseURL,
  isMobile,
}) => {
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
});
