import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  appScopeNames,
  AppScopesSchema,
  AppAccessStateSchema,
  AuthorizationContextSchema,
  AuthorizationDecisionSchema,
  AuthorizationRequestSchema,
  KeyInputSchema,
  KeyReceiptSchema,
  ownerOperationScopes,
  permissionScopes,
  scopePermissions,
} from "@keel/domain/app-access";
import type { AppEnvironment } from "../app";
import type { Env } from "../types";
import { openApi } from "../agent-api/spec";
import {
  AppAccessError,
  AppAccessStore,
  deadline,
  digest,
  secret,
  type Principal,
} from "./store";

type C = Context<AppEnvironment>;
const payloadLimit = bodyLimit({
  maxSize: 8192,
  onError: (c) => c.json({ error: "Request exceeds 8 KiB." }, 413),
});
function origins(env: Env, request: string) {
  const local =
    env.ENVIRONMENT === "local" ? new URL(request).origin : undefined;
  const web = env.APP_ACCESS_WEB_ORIGIN ?? local,
    api = env.APP_ACCESS_API_ORIGIN ?? local;
  if (!web || !api)
    throw new AppAccessError(503, "App access is not configured.");
  for (const origin of [web, api]) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      (url.protocol !== "https:" &&
        !(
          env.ENVIRONMENT === "local" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      throw new AppAccessError(503, "Invalid app access origin.");
  }
  return { web, api, resource: api + "/mcp" };
}
export function appAccessOrigins(env: Env, request: string) {
  return origins(env, request);
}
function error(c: C, e: unknown) {
  if (e instanceof AppAccessError)
    return c.json({ error: e.message }, e.status);
  if (e instanceof z.ZodError)
    return c.json({ error: "Invalid request." }, 400);
  if (
    e instanceof Error &&
    /App access limit|registration capacity/.test(e.message)
  )
    return c.json(
      {
        error:
          "Connection capacity reached. Revoke an unused connection or contact the operator.",
      },
      409,
    );
  // Never serialize SQL, credentials, authorization codes or request bodies.
  return c.json({ error: "App access is temporarily unavailable." }, 503);
}
async function limited(c: C) {
  if (!c.env.APP_ACCESS_LIMITER) {
    if (c.env.ENVIRONMENT === "local") return;
    throw new AppAccessError(503, "App access admission is unavailable.");
  }
  const success = await c.env.APP_ACCESS_LIMITER.limit({
    key: "app-access:" + (c.req.header("CF-Connecting-IP") ?? "unknown"),
  });
  if (!success.success)
    throw new AppAccessError(
      503,
      "Too many app access requests. Try again in a minute.",
    );
}
export async function appPrincipal(c: C): Promise<Principal | null> {
  const { api } = origins(c.env, c.req.url);
  if (new URL(c.req.url).origin !== api)
    throw new AppAccessError(403, "Use the configured API origin.");
  const token = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "")?.[1];
  if (!token) return null;
  return new AppAccessStore(c.env.DB).authenticate(token);
}
export async function ownerBearer(c: C, next: () => Promise<void>) {
  try {
    const p = await appPrincipal(c);
    if (!p) {
      c.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${origins(c.env, c.req.url).api}/.well-known/oauth-protected-resource/mcp"`,
      );
      return c.json(
        {
          code: "unauthenticated",
          error: "A valid Keel access token is required.",
        },
        401,
      );
    }
    const needed = ownerOperationScopes(c.req.method, c.req.path);
    if (needed === null || needed.some((s) => !p.scopes.includes(s)))
      return c.json(
        {
          code: "forbidden",
          error: "This connection does not have permission for this operation.",
        },
        403,
      );
    c.set("appAccess", p);
    c.set("identity", { kind: "user", subject: p.subject, email: null });
    c.set("macAgentTarget", null);
    return next();
  } catch (e) {
    return error(c, e);
  }
}
async function browser(c: C) {
  const identity = c.get("identity");
  const { web } = origins(c.env, c.req.url);
  if (
    new URL(c.req.url).origin !== web ||
    identity.kind !== "user" ||
    c.get("macAgentTarget") ||
    c.get("appAccess")
  )
    throw new AppAccessError(403, "Sign in to Keel to manage app access.");
  if (
    c.req.method !== "GET" &&
    (c.req.header("X-Keel-App-Access") !== "1" ||
      (c.req.header("Origin") && c.req.header("Origin") !== web))
  )
    throw new AppAccessError(403, "Use the Keel app access form.");
  return new AppAccessStore(c.env.DB).owner(identity.subject);
}
const registration = z.object({
  redirect_uris: z.array(z.url().max(2048)).min(1).max(8),
  client_name: z.string().max(256).optional(),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .max(2)
    .optional(),
  response_types: z.array(z.literal("code")).max(1).optional(),
  scope: z.string().max(256).optional(),
});
type Client = {
  id: string;
  name: string;
  origin: string;
  redirect_uris_json: string;
};
async function authorization(
  store: AppAccessStore,
  request: z.infer<typeof AuthorizationRequestSchema>,
  resource: string,
) {
  const client = await store.db
    .prepare(
      "SELECT id,name,origin,redirect_uris_json FROM app_access_clients WHERE id=?",
    )
    .bind(request.client_id)
    .first<Client>();
  const scopes = AppScopesSchema.parse(request.scope.split(" "));
  if (
    !client ||
    !z
      .array(z.string())
      .parse(JSON.parse(client.redirect_uris_json))
      .includes(request.redirect_uri) ||
    request.resource !== resource
  )
    throw new AppAccessError(
      400,
      "The app's connection request is invalid or has expired. Start again in the app.",
    );
  return { client, scopes };
}
export function publicOpenApi(api: string) {
  return {
    ...openApi(),
    servers: [{ url: api + "/api/v1" }],
    security: [{ KeelBearer: [] }],
    components: {
      ...openApi().components,
      securitySchemes: {
        KeelBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Create a scoped API key in Keel Settings > App access, or use OAuth.",
        },
      },
    },
  };
}
export function registerAppAccessPublic(parent: Hono<AppEnvironment>) {
  const app = new Hono<AppEnvironment>();
  app.onError((e, c) => error(c, e));
  const publicPaths = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
    "/oauth/register",
    "/oauth/token",
    "/api/v1/openapi.json",
  ];
  for (const path of publicPaths)
    app.use(path, async (c, next) => {
      if (
        path === "/api/v1/openapi.json" &&
        c.env.APP_ACCESS_API_ORIGIN !== new URL(c.req.url).origin
      )
        return next();
      c.header("Cache-Control", "no-store");
      const { api } = origins(c.env, c.req.url);
      if (new URL(c.req.url).origin !== api)
        return c.json({ error: "Not found." }, 404);
      c.header("Access-Control-Allow-Origin", "*");
      c.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, MCP-Protocol-Version, If-Match, Idempotency-Key",
      );
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      c.header("Access-Control-Expose-Headers", "WWW-Authenticate, ETag");
      if (c.req.method === "OPTIONS") return c.body(null, 204);
      return next();
    });
  for (const path of publicPaths) app.options(path, (c) => c.body(null, 204));
  // Mount only explicit public paths: never capture unrelated application routes.
  const resourceMetadata = (c: C) => {
    const { api, resource } = origins(c.env, c.req.url);
    return c.json({
      resource,
      authorization_servers: [api],
      scopes_supported: appScopeNames,
      bearer_methods_supported: ["header"],
      resource_name: "Keel",
    });
  };
  app.get("/.well-known/oauth-protected-resource", resourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", resourceMetadata);
  app.get("/.well-known/oauth-authorization-server", (c) => {
    const { api, web } = origins(c.env, c.req.url);
    return c.json({
      issuer: api,
      authorization_endpoint: web + "/oauth/authorize",
      token_endpoint: api + "/oauth/token",
      registration_endpoint: api + "/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: appScopeNames,
      authorization_response_iss_parameter_supported: true,
    });
  });
  app.get("/api/v1/openapi.json", (c, next) =>
    c.env.APP_ACCESS_API_ORIGIN === new URL(c.req.url).origin
      ? c.json(publicOpenApi(origins(c.env, c.req.url).api))
      : next(),
  );
  app.post("/oauth/register", payloadLimit, async (c) => {
    await limited(c);
    const input = registration.parse(await c.req.json().catch(() => null));
    const urls = input.redirect_uris.map((value) => new URL(value));
    if (
      urls.some(
        (url) =>
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.hash ||
          url.origin !== urls[0]!.origin,
      )
    )
      throw new AppAccessError(
        400,
        "Supply HTTPS callback URLs from one app origin.",
      );
    const origin = urls[0]!.origin,
      host = urls[0]!.hostname;
    // Display a verified redirect host, never a caller-supplied brand name.
    const name =
      host === "chatgpt.com"
        ? "ChatGPT"
        : host === "claude.ai"
          ? "Claude"
          : host;
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO app_access_clients(id,name,origin,redirect_uris_json,created_at) VALUES(?,?,?,?,?)",
    )
      .bind(
        id,
        name,
        origin,
        JSON.stringify(input.redirect_uris),
        new Date().toISOString(),
      )
      .run();
    return c.json(
      {
        client_id: id,
        client_name: name,
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  });
  app.post("/oauth/token", payloadLimit, async (c) => {
    await limited(c);
    const body = await c.req.text();
    const form = new URLSearchParams(body);
    if (new Set(form.keys()).size !== form.size)
      return c.json({ error: "invalid_request" }, 400);
    const input = z
      .object({
        grant_type: z.enum(["authorization_code", "refresh_token"]),
        client_id: z.string().min(1).max(256),
        resource: z.url(),
        code: z.string().max(256).optional(),
        redirect_uri: z.url().optional(),
        code_verifier: z
          .string()
          .regex(/^[A-Za-z0-9._~-]{43,128}$/)
          .optional(),
        refresh_token: z.string().max(256).optional(),
      })
      .safeParse(Object.fromEntries(form));
    if (
      !input.success ||
      input.data.resource !== origins(c.env, c.req.url).resource
    )
      return c.json({ error: "invalid_request" }, 400);
    const store = new AppAccessStore(c.env.DB),
      v = input.data;
    let grant: GrantRowWithScope | null = null;
    let claim: D1PreparedStatement;
    const pair = crypto.randomUUID(),
      access = secret("keel_access_"),
      refresh = secret("keel_refresh_"),
      accessId = crypto.randomUUID(),
      refreshId = crypto.randomUUID();
    if (v.grant_type === "authorization_code") {
      if (!v.code || !v.code_verifier || !v.redirect_uri)
        return c.json({ error: "invalid_request" }, 400);
      const hash = await digest(v.code),
        challenge = btoa(
          String.fromCharCode(
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(v.code_verifier),
              ),
            ),
          ),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "");
      grant = await c.env.DB.prepare(
        `SELECT g.id,g.expires_at,g.scopes_json FROM app_access_codes c JOIN app_access_grants g ON g.id=c.grant_id WHERE c.code_hash=? AND c.client_id=? AND c.redirect_uri=? AND c.resource=? AND c.challenge=? AND c.consumed_pair IS NULL AND c.expires_at>? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)`,
      )
        .bind(
          hash,
          v.client_id,
          v.redirect_uri,
          v.resource,
          challenge,
          store.now,
          store.now,
        )
        .first<GrantRowWithScope>();
      claim = c.env.DB.prepare(
        `UPDATE app_access_codes SET consumed_pair=? WHERE code_hash=? AND consumed_pair IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM app_access_grants g WHERE g.id=app_access_codes.grant_id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?))`,
      ).bind(pair, hash, store.now, store.now);
    } else {
      if (
        !v.refresh_token ||
        !/^keel_refresh_[A-Za-z0-9_-]{43}$/.test(v.refresh_token)
      )
        return c.json({ error: "invalid_grant" }, 400);
      const hash = await digest(v.refresh_token);
      const old = await c.env.DB.prepare(
        `SELECT c.replaced_by,g.id,g.expires_at,g.scopes_json FROM app_access_credentials c JOIN app_access_grants g ON g.id=c.grant_id WHERE c.token_hash=? AND c.kind='refresh' AND g.client_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?) AND c.revoked_at IS NULL`,
      )
        .bind(hash, v.client_id, store.now)
        .first<GrantRowWithScope & { replaced_by: string | null }>();
      if (old?.replaced_by) {
        await c.env.DB.prepare(
          "UPDATE app_access_grants SET revoked_at=? WHERE id=?",
        )
          .bind(store.now, old.id)
          .run();
        return c.json(
          {
            error: "invalid_grant",
            error_description:
              "Refresh token reuse detected. Reconnect in Keel.",
          },
          400,
        );
      }
      grant = old;
      claim = c.env.DB.prepare(
        `UPDATE app_access_credentials SET replaced_by=? WHERE token_hash=? AND kind='refresh' AND replaced_by IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND EXISTS(SELECT 1 FROM app_access_grants g WHERE g.id=app_access_credentials.grant_id AND g.client_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?))`,
      ).bind(pair, hash, store.now, v.client_id, store.now);
    }
    if (!grant) return c.json({ error: "invalid_grant" }, 400);
    const accessExpires = deadline(store.now, 900, grant.expires_at);
    const insert = (
      id: string,
      kind: string,
      hash: string,
      expires: string | null,
    ) =>
      (v.grant_type === "authorization_code"
        ? c.env.DB.prepare(
            `INSERT INTO app_access_credentials(id,grant_id,kind,token_hash,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_access_codes WHERE grant_id=? AND consumed_pair=?)`,
          )
        : c.env.DB.prepare(
            `INSERT INTO app_access_credentials(id,grant_id,kind,token_hash,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_access_credentials WHERE grant_id=? AND replaced_by=?)`,
          )
      ).bind(id, grant.id, kind, hash, store.now, expires, grant.id, pair);
    const results = await c.env.DB.batch([
      claim,
      insert(accessId, "access", await digest(access), accessExpires),
      insert(refreshId, "refresh", await digest(refresh), grant.expires_at),
    ]);
    if (results[0]!.meta.changes !== 1)
      return c.json({ error: "invalid_grant" }, 400);
    return c.json({
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.max(
        0,
        Math.floor((Date.parse(accessExpires) - Date.parse(store.now)) / 1000),
      ),
      refresh_token: refresh,
      scope: AppScopesSchema.parse(JSON.parse(grant.scopes_json)).join(" "),
    });
  });
  parent.route("/", app);
}
type GrantRowWithScope = {
  id: string;
  expires_at: string | null;
  scopes_json: string;
};
export function registerAppAccessManagement(parent: Hono<AppEnvironment>) {
  const app = new Hono<AppEnvironment>();
  app.onError((e, c) => error(c, e));
  app.post("/api/v1/key/rotate", payloadLimit, async (c) => {
    const p = c.get("appAccess");
    if (!p || p.kind !== "key" || !p.agentRotation)
      throw new AppAccessError(403, "This key cannot rotate itself.");
    await limited(c);
    return c.json(
      KeyReceiptSchema.parse(
        await new AppAccessStore(c.env.DB).rotate(
          p.householdId,
          p.grantId,
          p.credentialId,
        ),
      ),
      200,
      { "Cache-Control": "no-store" },
    );
  });
  app.use("/api/app-access/*", payloadLimit);
  app.use("/api/app-access", payloadLimit);
  app.get("/api/app-access", async (c) => {
    const owner = await browser(c),
      store = new AppAccessStore(c.env.DB);
    const query = z
      .strictObject({
        kind: z.enum(["key", "oauth"]).default("key"),
        after: z
          .string()
          .regex(/^[1-9][0-9]{0,14}$/)
          .optional(),
      })
      .parse(Object.fromEntries(new URL(c.req.url).searchParams));
    const { api, resource } = origins(c.env, c.req.url);
    return c.json(
      AppAccessStateSchema.parse({
        apiOrigin: api,
        mcpUrl: resource,
        openApiUrl: api + "/api/v1/openapi.json",
        evaluatedAt: store.now,
        ...(await store.list(
          owner.household_id,
          Number(query.after ?? Number.MAX_SAFE_INTEGER),
          query.kind,
        )),
      }),
      200,
      { "Cache-Control": "no-store" },
    );
  });
  app.patch("/api/app-access/:id", async (c) => {
    const owner = await browser(c),
      id = z.uuid().parse(c.req.param("id")),
      input = z
        .strictObject({ name: z.string().trim().min(1).max(64) })
        .parse(await c.req.json().catch(() => null));
    const grant = await new AppAccessStore(c.env.DB).get(
      owner.household_id,
      id,
    );
    if (grant.kind !== "key")
      throw new AppAccessError(
        400,
        "App names are supplied by their verified callback origin.",
      );
    await c.env.DB.prepare(
      "UPDATE app_access_grants SET name=? WHERE id=? AND household_id=?",
    )
      .bind(input.name, id, owner.household_id)
      .run();
    return c.json({ renamed: true });
  });
  app.post("/api/app-access/keys", async (c) => {
    const owner = await browser(c);
    await limited(c);
    const input = KeyInputSchema.parse(await c.req.json().catch(() => null));
    const result = await new AppAccessStore(c.env.DB).createKey(
      owner,
      input.name,
      permissionScopes(input.permissions),
      input.durationDays,
      input.rotation === "agent",
    );
    return c.json(KeyReceiptSchema.parse(result), 201, {
      "Cache-Control": "no-store",
    });
  });
  app.post("/api/app-access/:id/revoke", async (c) => {
    const owner = await browser(c),
      id = z.uuid().parse(c.req.param("id")),
      store = new AppAccessStore(c.env.DB);
    await store.get(owner.household_id, id);
    await store.revoke(owner.household_id, id);
    return c.json({ revoked: true }, 200, { "Cache-Control": "no-store" });
  });
  app.post("/api/app-access/:id/rotate", async (c) => {
    const owner = await browser(c);
    await limited(c);
    return c.json(
      KeyReceiptSchema.parse(
        await new AppAccessStore(c.env.DB).rotate(
          owner.household_id,
          z.uuid().parse(c.req.param("id")),
        ),
      ),
      200,
      { "Cache-Control": "no-store" },
    );
  });
  app.post("/api/app-access/authorization-context", async (c) => {
    await browser(c);
    const request = AuthorizationRequestSchema.parse(
        await c.req.json().catch(() => null),
      ),
      store = new AppAccessStore(c.env.DB);
    const { client, scopes } = await authorization(
      store,
      request,
      origins(c.env, c.req.url).resource,
    );
    return c.json(
      AuthorizationContextSchema.parse({
        name: client.name,
        clientOrigin: client.origin,
        permissions: scopePermissions(
          scopes.filter((scope) => scope !== "goals:write"),
        ),
        requestedPermissions: scopePermissions(scopes),
        request,
      }),
      200,
      { "Cache-Control": "no-store" },
    );
  });
  app.post("/api/app-access/authorize", async (c) => {
    const owner = await browser(c);
    await limited(c);
    const input = AuthorizationDecisionSchema.parse(
        await c.req.json().catch(() => null),
      ),
      store = new AppAccessStore(c.env.DB),
      { api, resource } = origins(c.env, c.req.url);
    const { client, scopes: requested } = await authorization(
      store,
      input.request,
      resource,
    );
    const scopes = permissionScopes(input.permissions);
    if (scopes.some((s) => !requested.includes(s)))
      throw new AppAccessError(
        400,
        "The selected permissions exceed the app's request.",
      );
    const id = crypto.randomUUID(),
      code = secret("keel_code_"),
      expires =
        input.durationDays === null
          ? null
          : deadline(store.now, input.durationDays * 86400);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO app_access_grants(id,household_id,user_id,kind,name,client_id,scopes_json,created_at,expires_at,agent_rotation) VALUES(?,?,?,'oauth',?,?,?,?,?,0)`,
      ).bind(
        id,
        owner.household_id,
        owner.user_id,
        client.name,
        client.id,
        JSON.stringify(scopes),
        store.now,
        expires,
      ),
      c.env.DB.prepare(
        `INSERT INTO app_access_codes(code_hash,grant_id,client_id,redirect_uri,resource,challenge,expires_at) VALUES(?,?,?,?,?,?,?)`,
      ).bind(
        await digest(code),
        id,
        client.id,
        input.request.redirect_uri,
        resource,
        input.request.code_challenge,
        deadline(store.now, 300),
      ),
    ]);
    const url = new URL(input.request.redirect_uri);
    url.searchParams.set("code", code);
    if (input.request.state !== undefined)
      url.searchParams.set("state", input.request.state);
    url.searchParams.set("iss", api);
    return c.json({ redirectUrl: url.href }, 200, {
      "Cache-Control": "no-store",
    });
  });
  parent.route("/", app);
}
