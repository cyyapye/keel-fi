import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ownerOperationScopes } from "@keel/domain/app-access";
import type { AppEnvironment } from "../app";
import { openApi } from "../agent-api/spec";
import { appAccessOrigins, appPrincipal } from "./routes";
import { AppAccessError, type Principal } from "./store";

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema: unknown;
  description?: string;
};
type Operation = {
  operationId: string;
  summary: string;
  parameters?: Parameter[];
  requestBody?: { content: { "application/json": { schema: unknown } } };
};
function operations() {
  const result: { method: string; path: string; operation: Operation }[] = [];
  for (const [path, methods] of Object.entries(openApi().paths))
    for (const [method, value] of Object.entries(methods)) {
      if (
        value &&
        typeof value === "object" &&
        "operationId" in value &&
        value.operationId !== "describeApi"
      )
        result.push({
          method: method.toUpperCase(),
          path: "/api/v1" + path,
          operation: value as Operation,
        });
    }
  return result;
}
const entries = operations();
const argumentName = (p: Parameter) =>
  p.name === "Idempotency-Key"
    ? "idempotencyKey"
    : p.name === "If-Match"
      ? "ifMatch"
      : p.name;
function schemaRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(schemaRefs);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "$ref" && typeof v === "string"
          ? v.replace("#/components/schemas/", "#/$defs/")
          : schemaRefs(v),
      ]),
    );
  return value;
}
function inputDefinitions(input: unknown) {
  const definitions: Record<string, unknown> = {},
    pending: string[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (
          key === "$ref" &&
          typeof child === "string" &&
          child.startsWith("#/components/schemas/")
        )
          pending.push(child.slice("#/components/schemas/".length));
        else collect(child);
      }
  };
  collect(input);
  while (pending.length) {
    const name = pending.pop()!;
    if (name in definitions) continue;
    const schema = openApi().components.schemas[name];
    if (!schema) throw new Error("Missing tool input schema.");
    definitions[name] = schema;
    collect(schema);
  }
  return Object.keys(definitions).length ? { $defs: definitions } : {};
}
function permitted(p: Principal, entry: (typeof entries)[number]) {
  const needed = ownerOperationScopes(
    entry.method,
    entry.path.replaceAll(/\{[^}]+\}/g, "id"),
  );
  return needed !== null && needed.every((s) => p.scopes.includes(s));
}
function tool(entry: (typeof entries)[number]) {
  const op = entry.operation,
    properties: Record<string, unknown> = {},
    required: string[] = [];
  for (const p of op.parameters ?? []) {
    properties[argumentName(p)] = {
      ...(p.schema as object),
      ...(p.description ? { description: p.description } : {}),
    };
    if (p.required) required.push(argumentName(p));
  }
  if (op.requestBody) {
    properties.body = op.requestBody.content["application/json"].schema;
    required.push("body");
  }
  const readOnly =
    entry.method === "GET" || entry.path === "/api/v1/outlook/preview";
  return {
    name: op.operationId,
    description: op.summary,
    inputSchema: schemaRefs({
      type: "object",
      properties,
      required,
      additionalProperties: false,
      ...inputDefinitions(properties),
    }),
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}
const rpc = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(256), z.number().finite()]).optional(),
  method: z.string().max(128),
  params: z.record(z.string(), z.unknown()).optional(),
});
export function registerMcp(app: Hono<AppEnvironment>) {
  app.options("/mcp", (c) =>
    c.body(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    }),
  );
  app.get("/mcp", (c) =>
    c.json({ error: "Use Streamable HTTP POST." }, 405, {
      Allow: "POST, OPTIONS",
      "Cache-Control": "no-store",
    }),
  );
  app.post(
    "/mcp",
    bodyLimit({
      maxSize: 16384,
      onError: (c) => c.json({ error: "Request exceeds 16 KiB." }, 413),
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Expose-Headers", "WWW-Authenticate");
      let principal: Principal | null;
      try {
        principal = await appPrincipal(c);
      } catch (e) {
        return c.json(
          {
            error:
              e instanceof AppAccessError
                ? e.message
                : "App access unavailable.",
          },
          e instanceof AppAccessError ? e.status : 503,
        );
      }
      if (!principal) {
        c.header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${appAccessOrigins(c.env, c.req.url).api}/.well-known/oauth-protected-resource/mcp"`,
        );
        return c.json({ error: "A valid Keel access token is required." }, 401);
      }
      const input = rpc.safeParse(await c.req.json().catch(() => null));
      if (!input.success)
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid request." },
          },
          400,
        );
      const v = input.data,
        id = v.id ?? null;
      const failure = (code: number, message: string) =>
        c.json({ jsonrpc: "2.0", id, error: { code, message } });
      if (v.method === "notifications/initialized" && v.id === undefined)
        return c.body(null, 202);
      if (v.id === undefined)
        return failure(-32600, "A request ID is required.");
      if (v.method === "initialize")
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: [
              "2025-03-26",
              "2025-06-18",
              "2025-11-25",
            ].includes(String(v.params?.protocolVersion))
              ? v.params!.protocolVersion
              : "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "Keel", version: "1.0.0" },
            instructions:
              "Use only granted areas. Report coverage and freshness limits. Goal writes require an explicit user instruction, a stable idempotencyKey and the latest ifMatch revision. Outlook previews are unsaved.",
          },
        });
      if (v.method === "ping")
        return c.json({ jsonrpc: "2.0", id, result: {} });
      if (v.method === "tools/list")
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: entries.filter((e) => permitted(principal, e)).map(tool),
          },
        });
      if (v.method !== "tools/call")
        return failure(-32601, "Method not found.");
      const args = z
        .strictObject({
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()).default({}),
        })
        .safeParse(v.params);
      if (!args.success)
        return failure(-32602, "Supply a tool name and arguments.");
      const entry = entries.find(
        (e) => e.operation.operationId === args.data.name,
      );
      if (!entry || !permitted(principal, entry))
        return failure(-32602, "Tool is unavailable for this connection.");
      const values = args.data.arguments,
        allowed = new Set((entry.operation.parameters ?? []).map(argumentName));
      if (entry.operation.requestBody) allowed.add("body");
      if (Object.keys(values).some((k) => !allowed.has(k)))
        return failure(-32602, "Unsupported tool argument.");
      let path = entry.path;
      const query = new URLSearchParams(),
        headers = new Headers({
          Authorization: c.req.header("Authorization")!,
          "Content-Type": "application/json",
        });
      for (const p of entry.operation.parameters ?? []) {
        const value = values[argumentName(p)];
        if (value === undefined) {
          if (p.required) return failure(-32602, "Missing " + argumentName(p));
          continue;
        }
        if (typeof value !== "string" && typeof value !== "number")
          return failure(-32602, "Expected a string or integer argument.");
        if (p.in === "path")
          path = path.replace(
            "{" + p.name + "}",
            encodeURIComponent(String(value)),
          );
        else if (p.in === "header") headers.set(p.name, String(value));
        else query.set(p.name, String(value));
      }
      if (entry.operation.requestBody && !values.body)
        return failure(-32602, "Missing body.");
      const url =
        appAccessOrigins(c.env, c.req.url).api +
        path +
        (query.size ? "?" + query.toString() : "");
      // Internal dispatch reuses the exact API validators, household isolation, concurrency receipts and authorization.
      const response = await app.request(
        url,
        {
          method: entry.method,
          headers,
          ...(entry.operation.requestBody
            ? { body: JSON.stringify(values.body) }
            : {}),
        },
        c.env,
      );
      const data: unknown = await response
        .json()
        .catch(() => ({ error: "Keel returned an unreadable response." }));
      const etag = response.headers.get("ETag");
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          isError: !response.ok,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: response.status,
                ...(etag ? { etag } : {}),
                data,
              }),
            },
          ],
        },
      });
    },
  );
}
