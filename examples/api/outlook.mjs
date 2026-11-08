// Run with Node 22+. A scenario on stdin selects the unsaved preview operation.
import { text } from "node:stream/consumers";
const origin = new URL(process.argv[2]);
if (origin.href !== origin.origin + "/") {
  throw new Error(
    "Supply the Keel origin printed by make dev, without a path.",
  );
}
const local = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
const clientId = process.env.CF_ACCESS_CLIENT_ID;
const secret = process.env.CF_ACCESS_CLIENT_SECRET;
if (
  origin.protocol !== "https:" &&
  !(local && origin.protocol === "http:" && !clientId && !secret)
) {
  throw new Error("Use HTTPS for private Keel deployments.");
}
if (Boolean(clientId) !== Boolean(secret))
  throw new Error("Supply both service credentials.");
const headers = clientId
  ? { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": secret }
  : {};
const preview = process.argv[3] === "--preview";
if (process.argv.length !== (preview ? 4 : 3))
  throw new Error("Use: node examples/api/outlook.mjs ORIGIN [--preview]");
const body = preview ? await text(process.stdin) : undefined;
const response = await fetch(
  new URL(preview ? "/api/v1/outlook/preview" : "/api/v1/outlook", origin),
  {
    method: preview ? "POST" : "GET",
    headers: {
      ...headers,
      ...(preview ? { "Content-Type": "application/json" } : {}),
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  },
);
if (!response.ok) throw new Error("Keel returned HTTP " + response.status);
console.log(JSON.stringify(await response.json(), null, 2));
