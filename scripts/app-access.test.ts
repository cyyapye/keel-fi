import { z } from "zod";
import { expect, it } from "vitest";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import {
  AppAccessStore,
  deadline,
  digest,
} from "../apps/api/src/app-access/store";
import {
  AppAccessStateSchema,
  KeyReceiptSchema,
} from "../packages/domain/src/app-access";
import { COST_SUBJECT } from "./test-support/cost-fixtures";
import { createMcpMetadataDatabase } from "./test-support/mcp-metadata-database";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { goalReceipt } from "../apps/api/src/agent-api/goals";
import {
  positionDetail,
  positionPage,
} from "../apps/api/src/agent-api/resources";

it("accepts MCP request metadata without widening tool arguments or connection scopes", async () => {
  const fixture = await createMcpMetadataDatabase();
  try {
    const meter = measureD1(fixture.database),
      store = new AppAccessStore(meter.database),
      owner = await store.owner(COST_SUBJECT),
      key = await store.createKey(
        owner,
        "Synthetic MCP reader",
        ["holdings:read"],
        30,
        false,
      );
    const app = createApp(),
      origin = "https://api.keel.invalid",
      env = {
        ENVIRONMENT: "preview",
        DB: meter.database,
        APP_ACCESS_API_ORIGIN: origin,
        APP_ACCESS_WEB_ORIGIN: "https://keel.invalid",
      } as unknown as Env;
    const call = async (params: unknown) => {
      const response = await app.request(
        origin + "/mcp",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key.key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params,
          }),
        },
        env,
      );
      expect(response.status).toBe(200);
      return z
        .object({
          result: z
            .object({
              isError: z.boolean(),
              content: z.array(
                z.object({ type: z.literal("text"), text: z.string() }),
              ),
            })
            .optional(),
          error: z
            .object({
              code: z.number(),
              message: z.string(),
              data: z.unknown().optional(),
            })
            .optional(),
        })
        .parse(await response.json());
    };
    const meta = {
      progressToken: "synthetic-progress",
      "synthetic.example/request": { correlationId: "synthetic-correlation" },
      householdId: "synthetic-ungranted-household",
      scopes: ["goals:read", "goals:write", "cash:read"],
    };
    meter.reset();
    // Optional arguments and protocol metadata must reach the same real read path.
    const listing = await call({ name: "listPositions", _meta: meta });
    expect(listing.error).toBeUndefined();
    expect(listing.result?.isError).toBe(false);
    const page = z
      .object({ status: z.literal(200), data: positionPage })
      .parse(JSON.parse(listing.result!.content[0]!.text));
    expect(page.data.items.length).toBeGreaterThan(0);
    const id = page.data.items[0]!.id;
    const detail = await call({
      name: "getPosition",
      arguments: { positionId: id },
      _meta: { ...meta, progressToken: 7 },
    });
    expect(detail.error).toBeUndefined();
    expect(detail.result?.isError).toBe(false);
    expect(
      z
        .object({ status: z.literal(200), data: positionDetail })
        .parse(JSON.parse(detail.result!.content[0]!.text)).data.id,
    ).toBe(id);
    expect(
      (await call({ name: "createGoal", arguments: {}, _meta: meta })).error,
    ).toMatchObject({
      code: -32602,
      message: "Tool is unavailable for this connection.",
    });
    expect(
      (
        await call({
          name: "listPositions",
          arguments: { householdId: "synthetic-ungranted-household" },
          _meta: meta,
        })
      ).error,
    ).toMatchObject({ code: -32602, message: "Unsupported tool argument." });
    for (const params of [
      { name: "listPositions", _meta: "synthetic-do-not-echo" },
      { name: "listPositions", _meta: { progressToken: {} } },
      { name: "listPositions", arguments: "synthetic-do-not-echo" },
      { name: "listPositions", task: { ttl: 60_000 } },
    ]) {
      const malformed = await call(params);
      expect(malformed.error).toMatchObject({
        code: -32602,
        data: { issues: expect.any(Array) },
      });
      expect(JSON.stringify(malformed.error)).not.toContain(
        "synthetic-do-not-echo",
      );
    }
    expect(meter.cost.rowsWritten).toBe(0);
  } finally {
    await fixture.close();
  }
}, 15_000);

it("keeps owner keys scoped, isolated, expiring and revocable through the actual middleware and D1", async () => {
  const fixture = await createCostDatabase();
  try {
    const meter = measureD1(fixture.database),
      db = meter.database;
    const web = "https://keel.invalid",
      machine = "https://api.keel.invalid";
    const app = createApp({
      verifyAccess: (token) => {
        if (token !== "human") throw Error();
        return Promise.resolve({
          kind: "user",
          subject: COST_SUBJECT,
          email: null,
        });
      },
    });
    const env = {
      ENVIRONMENT: "preview",
      DB: db,
      APP_ACCESS_WEB_ORIGIN: web,
      APP_ACCESS_API_ORIGIN: machine,
      APP_ACCESS_LIMITER: { limit: () => Promise.resolve({ success: true }) },
    } as unknown as Env;
    const human = {
      "Cf-Access-Jwt-Assertion": "human",
      "X-Keel-App-Access": "1",
      "Content-Type": "application/json",
      Origin: web,
    };
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = human,
    ) =>
      app.request(
        web + path,
        {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
      );
    const create = await request("/api/app-access/keys", "POST", {
      name: "Synthetic agent",
      durationDays: 90,
      rotation: "agent",
      permissions: {
        goals: "read",
        holdings: "none",
        cash: "none",
        evidence: "none",
      },
    });
    expect(create.status, await create.clone().text()).toBe(201);
    const receipt = KeyReceiptSchema.parse(await create.json()),
      auth = { Authorization: "Bearer " + receipt.key };
    const get = (path: string, method = "GET") =>
      app.request(machine + path, { method, headers: auth }, env);
    meter.reset();
    expect((await get("/api/v1/goals")).status).toBe(200);
    expect(meter.cost.rowsWritten).toBe(0);
    expect(meter.cost.roundTrips).toBeLessThanOrEqual(3);
    for (const path of [
      "/api/v1/positions",
      "/api/v1/accounts",
      "/api/v1/outlook",
      "/api/v1/marks?baselineId=synthetic",
      "/api/app-access",
      "/api/alpha",
    ])
      expect((await get(path)).status, path).toBe(403);
    expect((await get("/api/v1/goals", "POST")).status).toBe(403);
    expect(
      (await request("/api/v1/goals", "GET", undefined, auth)).status,
    ).toBe(403);
    expect((await get("/api/v1/goals?householdId=other")).status).toBe(400);
    expect(
      (
        await request(
          "/api/app-access/keys",
          "POST",
          {},
          {
            "Cf-Access-Jwt-Assertion": "human",
            "Content-Type": "application/json",
          },
        )
      ).status,
    ).toBe(403);
    const credential = await db
      .prepare("SELECT token_hash FROM app_access_credentials WHERE grant_id=?")
      .bind(receipt.grant.id)
      .first<{ token_hash: string }>();
    expect(credential?.token_hash).toBe(await digest(receipt.key));
    expect(
      JSON.stringify(
        await db.prepare("SELECT * FROM app_access_credentials").all(),
      ),
    ).not.toContain(receipt.key);
    const at = new Date().toISOString();
    expect(
      await new AppAccessStore(db, receipt.grant.expiresAt!).authenticate(
        receipt.key,
      ),
    ).toBeNull();
    const rotations = await Promise.all([
      get("/api/v1/key/rotate", "POST"),
      get("/api/v1/key/rotate", "POST"),
    ]);
    expect(rotations.map((r) => r.status).sort()).toEqual([200, 409]);
    const rotation = rotations.find((r) => r.status === 200)!;
    expect(rotation.status, await rotation.clone().text()).toBe(200);
    const replacement = KeyReceiptSchema.parse(await rotation.json());
    expect(replacement.grant.permissions).toEqual(receipt.grant.permissions);
    expect(replacement.grant.expiresAt).toBe(receipt.grant.expiresAt);
    expect(
      await new AppAccessStore(db, at).authenticate(receipt.key),
    ).not.toBeNull();
    expect(
      await new AppAccessStore(
        db,
        replacement.grant.previousKeyExpiresAt!,
      ).authenticate(receipt.key),
    ).toBeNull();
    expect(
      await new AppAccessStore(
        db,
        replacement.grant.previousKeyExpiresAt!,
      ).authenticate(replacement.key),
    ).not.toBeNull();
    expect((await get("/api/v1/key/rotate", "POST")).status).toBe(409);
    expect(
      (
        await app.request(
          machine + "/api/v1/key/rotate",
          {
            method: "POST",
            headers: { Authorization: "Bearer " + replacement.key },
          },
          env,
        )
      ).status,
    ).toBe(409);
    const rpc = async (method: string, params?: object) => {
      const response = await app.request(
        machine + "/mcp",
        {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        },
        env,
      );
      return z
        .object({
          result: z
            .object({
              tools: z.array(z.object({ name: z.string() })).optional(),
            })
            .optional(),
          error: z.unknown().optional(),
        })
        .parse(await response.json());
    };
    expect(
      (await rpc("tools/list")).result?.tools?.map((t) => t.name),
    ).toContain("listGoals");
    expect(
      (await rpc("tools/list")).result?.tools?.map((t) => t.name),
    ).not.toContain("getOutlook");
    expect(
      (await rpc("tools/call", { name: "getOutlook", arguments: {} })).error,
    ).toBeTruthy();
    const revoked = await request(
      "/api/app-access/" + receipt.grant.id + "/revoke",
      "POST",
      {},
    );
    expect(revoked.status).toBe(200);
    expect((await get("/api/v1/goals")).status).toBe(401);
    expect(
      await new AppAccessStore(db).authenticate(replacement.key),
    ).toBeNull();

    // The documented 120 active-grant envelope; history and unrelated rows do not enlarge a page or auth read.
    const owner = await new AppAccessStore(db).owner(COST_SUBJECT);
    const offsets = JSON.stringify(Array.from({ length: 119 }, (_, i) => i));
    await db
      .prepare(
        `INSERT INTO app_access_grants(id,household_id,user_id,kind,name,scopes_json,created_at,expires_at,agent_rotation) SELECT printf('10000000-0000-4000-8000-%012d',value),?,?,'key','Synthetic scale key','["goals:read"]',?,?,0 FROM json_each(?)`,
      )
      .bind(owner.household_id, owner.user_id, at, deadline(at, 86400), offsets)
      .run();
    const racing = await Promise.all(
      [0, 1].map(
        async (i) =>
          await request("/api/app-access/keys", "POST", {
            name: "Synthetic racing key " + i,
            durationDays: 30,
            rotation: "manual",
            permissions: {
              goals: "read",
              holdings: "none",
              cash: "none",
              evidence: "none",
            },
          }),
      ),
    );
    expect(racing.map((r) => r.status).sort()).toEqual([201, 409]);
    const page = async (after?: string) => {
      meter.reset();
      const r = await request(
        "/api/app-access?kind=key" + (after ? "&after=" + after : ""),
      );
      expect(r.status).toBe(200);
      const value = AppAccessStateSchema.parse(await r.json());
      expect(meter.cost).toMatchObject({ roundTrips: 2, rowsWritten: 0 });
      expect(meter.cost.rowsRead).toBeLessThan(180);
      return { value, cost: meter.cost.rowsRead };
    };
    const first = await page();
    expect(first.value.grants).toHaveLength(50);
    const second = await page(first.value.nextAfter!);
    expect(second.value.grants).toHaveLength(50);
    const last = await page(second.value.nextAfter!);
    expect(last.value.grants).toHaveLength(21);
    expect(last.value.nextAfter).toBeNull();
    expect(
      (
        await request("/api/app-access/keys", "POST", {
          name: "Too many",
          durationDays: 30,
          rotation: "manual",
          permissions: {
            goals: "read",
            holdings: "none",
            cash: "none",
            evidence: "none",
          },
        })
      ).status,
    ).toBe(409);
    await db
      .prepare(
        `INSERT INTO app_access_credentials(id,grant_id,kind,token_hash,created_at,expires_at) SELECT 'historical-'||g.id||'-'||x.value,g.id,'access','historical-hash-'||g.id||'-'||x.value,?,? FROM app_access_grants g CROSS JOIN json_each(?) x`,
      )
      .bind(at, at, JSON.stringify(Array.from({ length: 24 }, (_, i) => i)))
      .run();
    const grown = await page();
    expect(grown.cost).toBeLessThanOrEqual(first.cost + 2);
    const plans = await db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM app_access_grants WHERE household_id=? AND kind=? AND sequence<? ORDER BY sequence DESC LIMIT 51",
      )
      .bind(owner.household_id, "key", Number.MAX_SAFE_INTEGER)
      .all<{ detail: string }>();
    expect(
      plans.results.every(
        (p) => p.detail.includes("SEARCH") && !p.detail.includes("SCAN"),
      ),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
}, 120000);

it("binds OAuth consent, PKCE, audience, single-use codes, refresh and independent revocation", async () => {
  const fixture = await createCostDatabase();
  try {
    const meter = measureD1(fixture.database),
      db = meter.database,
      web = "https://keel.invalid",
      machine = "https://api.keel.invalid",
      resource = machine + "/mcp";
    const app = createApp({
      verifyAccess: () =>
        Promise.resolve({
          kind: "user",
          subject: COST_SUBJECT,
          email: null,
        }),
    });
    const env = {
      ENVIRONMENT: "preview",
      DB: db,
      APP_ACCESS_WEB_ORIGIN: web,
      APP_ACCESS_API_ORIGIN: machine,
      APP_ACCESS_LIMITER: { limit: () => Promise.resolve({ success: true }) },
    } as unknown as Env;
    const post = (url: string, body: unknown, human = false) =>
      app.request(
        (human ? web : machine) + url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(human
              ? {
                  "Cf-Access-Jwt-Assertion": "human",
                  "X-Keel-App-Access": "1",
                  Origin: web,
                }
              : {}),
          },
          body: JSON.stringify(body),
        },
        env,
      );
    const metadata = await app.request(
      machine + "/.well-known/oauth-authorization-server",
      {},
      env,
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      issuer: machine,
      authorization_endpoint: web + "/oauth/authorize",
      code_challenge_methods_supported: ["S256"],
    });
    const schema = await app.request(machine + "/api/v1/openapi.json", {}, env);
    expect(await schema.json()).toMatchObject({
      servers: [{ url: machine + "/api/v1" }],
    });
    const unauth = await app.request(resource, { method: "POST" }, env);
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("WWW-Authenticate")).toContain(
      machine + "/.well-known/oauth-protected-resource/mcp",
    );
    const registered = await post("/oauth/register", {
      client_name: "ChatGPT",
      redirect_uris: ["https://client.invalid/callback"],
      token_endpoint_auth_method: "none",
    });
    expect(registered.status).toBe(201);
    const client = z
      .object({ client_id: z.string(), client_name: z.string() })
      .parse(await registered.json());
    expect(client.client_name).toBe("client.invalid");
    expect(
      (
        await post("/oauth/register", {
          redirect_uris: ["http://client.invalid/callback"],
        })
      ).status,
    ).toBe(400);
    const verifier = "a".repeat(43),
      bytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
      challenge = btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    const request = {
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://client.invalid/callback",
      state: "synthetic-state-value",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      scope: "goals:read holdings:read cash:read evidence:read",
    };
    expect(
      (
        await post(
          "/api/app-access/authorization-context",
          { ...request, redirect_uri: "https://evil.invalid/callback" },
          true,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/app-access/authorize",
          {
            request,
            permissions: {
              goals: "manage",
              holdings: "none",
              cash: "none",
              evidence: "none",
            },
            durationDays: null,
          },
          true,
        )
      ).status,
    ).toBe(400);
    const allow = await post(
      "/api/app-access/authorize",
      {
        request,
        permissions: {
          goals: "read",
          holdings: "none",
          cash: "none",
          evidence: "none",
        },
        durationDays: 90,
      },
      true,
    );
    expect(allow.status, await allow.clone().text()).toBe(200);
    const redirect = new URL(
      z.object({ redirectUrl: z.url() }).parse(await allow.json()).redirectUrl,
    );
    expect(redirect.origin).toBe("https://client.invalid");
    expect(redirect.searchParams.get("state")).toBe(request.state);
    expect(redirect.searchParams.get("iss")).toBe(machine);
    const token = (values: Record<string, string>) =>
      app.request(
        machine + "/oauth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(values).toString(),
        },
        env,
      );
    const form = {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: redirect.searchParams.get("code")!,
      redirect_uri: request.redirect_uri,
      code_verifier: verifier,
      resource,
    };
    expect(
      (await token({ ...form, code_verifier: "b".repeat(43) })).status,
    ).toBe(400);
    expect(
      (await token({ ...form, resource: "https://other.invalid/mcp" })).status,
    ).toBe(400);
    const exchanges = await Promise.all([token(form), token(form)]);
    expect(exchanges.map((r) => r.status).sort()).toEqual([200, 400]);
    const access = z
      .object({
        scope: z.string(),
        expires_in: z.number(),
        access_token: z.string(),
        refresh_token: z.string(),
      })
      .parse(await exchanges.find((r) => r.status === 200)!.json());
    expect(access.scope).toBe("goals:read");
    expect(access.expires_in).toBe(900);
    expect(
      (
        await app.request(
          machine + "/api/v1/goals",
          { headers: { Authorization: "Bearer " + access.access_token } },
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          machine + "/api/v1/outlook",
          { headers: { Authorization: "Bearer " + access.access_token } },
          env,
        )
      ).status,
    ).toBe(403);
    meter.reset();
    const renewed = await token({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: access.refresh_token,
      resource,
    });
    expect(renewed.status).toBe(200);
    expect(meter.cost).toMatchObject({ roundTrips: 2, statements: 4 });
    const refreshReads = meter.cost.rowsRead;
    const next = z
      .object({ access_token: z.string(), refresh_token: z.string() })
      .parse(await renewed.json());
    expect(next.refresh_token).not.toBe(access.refresh_token);
    const grantId = await db
      .prepare("SELECT grant_id FROM app_access_credentials WHERE token_hash=?")
      .bind(await digest(next.refresh_token))
      .first<string>("grant_id");
    await db
      .prepare(
        `INSERT INTO app_access_credentials(id,grant_id,kind,token_hash,created_at,expires_at,replaced_by) SELECT 'synthetic-refresh-history-'||value,?,'refresh','synthetic-refresh-hash-'||value,?,?,'synthetic-prior' FROM json_each(?)`,
      )
      .bind(
        grantId,
        new Date().toISOString(),
        new Date().toISOString(),
        JSON.stringify(Array.from({ length: 1200 }, (_, i) => i)),
      )
      .run();
    meter.reset();
    const grownResponse = await token({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: next.refresh_token,
      resource,
    });
    expect(grownResponse.status).toBe(200);
    expect(meter.cost).toMatchObject({ roundTrips: 2, statements: 4 });
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(refreshReads + 2);
    const grown = z
      .object({ access_token: z.string() })
      .parse(await grownResponse.json());
    expect(
      (
        await token({
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: access.refresh_token,
          resource,
        })
      ).status,
    ).toBe(400);
    expect(
      await new AppAccessStore(db).authenticate(next.access_token),
    ).toBeNull();
    expect(
      await new AppAccessStore(db).authenticate(grown.access_token),
    ).toBeNull();
    expect(
      await new AppAccessStore(db).authenticate(access.access_token),
    ).toBeNull();
  } finally {
    await fixture.close();
  }
}, 120000);

it("requires rotation opt-in, attributes goal writes and isolates a foreign household through bearer access", async () => {
  const fixture = await createCostDatabase();
  try {
    const meter = measureD1(fixture.database),
      db = meter.database,
      store = new AppAccessStore(db),
      owner = await store.owner(COST_SUBJECT);
    const key = await store.createKey(
      owner,
      "Synthetic goal editor",
      [
        "goals:read",
        "goals:write",
        "holdings:read",
        "cash:read",
        "evidence:read",
      ],
      30,
      false,
    );
    const app = createApp(),
      origin = "https://api.keel.invalid",
      env = {
        ENVIRONMENT: "preview",
        DB: db,
        APP_ACCESS_API_ORIGIN: origin,
        APP_ACCESS_WEB_ORIGIN: "https://keel.invalid",
        APP_ACCESS_LIMITER: { limit: () => Promise.resolve({ success: true }) },
      } as unknown as Env;
    const headers = {
      Authorization: "Bearer " + key.key,
      "Content-Type": "application/json",
      "Idempotency-Key": "synthetic-goal-create",
    };
    const tools = await app.request(
      origin + "/mcp",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      env,
    );
    expect(tools.status).toBe(200);
    expect(
      new TextEncoder().encode(await tools.text()).byteLength,
    ).toBeLessThan(32 * 1024);
    const target = {
      name: "Synthetic delegated target",
      metric: "net_worth",
      target: { amountMinor: 1000000, currency: "USD" },
      targetDate: deadline(store.now, 365 * 86400).slice(0, 10),
    };
    const create = () =>
      app.request(
        origin + "/api/v1/goals",
        { method: "POST", headers, body: JSON.stringify(target) },
        env,
      );
    const saved = await create();
    expect(saved.status, await saved.clone().text()).toBe(201);
    const goal = goalReceipt.parse(await saved.json());
    expect(await (await create()).json()).toEqual(goal);
    expect(
      await db
        .prepare(
          "SELECT created_by FROM goal_versions WHERE goal_id=? ORDER BY version DESC LIMIT 1",
        )
        .bind(goal.goalId)
        .first<string>("created_by"),
    ).toBe("app:" + key.grant.id);
    expect(
      (
        await app.request(
          origin + "/api/v1/key/rotate",
          { method: "POST", headers },
          env,
        )
      ).status,
    ).toBe(403);
    const manual = await store.rotate(owner.household_id, key.grant.id);
    expect(manual.grant.expiresAt).toBe(key.grant.expiresAt);
    await db.batch([
      db
        .prepare(
          "INSERT INTO users(id,access_subject,email,display_name,created_at) VALUES('app-other-user','synthetic-other-subject','app-other@synthetic.invalid','Synthetic other owner',?)",
        )
        .bind(store.now),
      db
        .prepare(
          "INSERT INTO households(id,owner_user_id,name,base_currency,created_at) VALUES('app-other-household','app-other-user','Synthetic other household','USD',?)",
        )
        .bind(store.now),
    ]);
    const other = await store.createKey(
      { household_id: "app-other-household", user_id: "app-other-user" },
      "Synthetic foreign key",
      ["goals:read"],
      30,
      false,
    );
    expect(
      (
        await app.request(
          origin + "/api/v1/goals/" + goal.goalId,
          { headers: { Authorization: "Bearer " + other.key } },
          env,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          origin + "/api/v1/goals/" + goal.goalId,
          { headers: { Authorization: "Bearer " + manual.key } },
          env,
        )
      ).status,
    ).toBe(200);
    const measured = async (token: string) => {
      meter.reset();
      const result = await new AppAccessStore(db).authenticate(token);
      expect(meter.cost).toMatchObject({
        roundTrips: 1,
        statements: 1,
        rowsWritten: 0,
      });
      expect(meter.cost.rowsRead).toBeLessThan(12);
      return { result, cost: meter.cost.rowsRead };
    };
    const before = await measured(manual.key);
    expect(before.result?.householdId).toBe(owner.household_id);
    await db
      .prepare(
        `INSERT INTO app_access_credentials(id,grant_id,kind,token_hash,created_at,expires_at) SELECT 'foreign-history-'||value,?,'access','foreign-history-hash-'||value,?,? FROM json_each(?)`,
      )
      .bind(
        other.grant.id,
        store.now,
        store.now,
        JSON.stringify(Array.from({ length: 120 }, (_, i) => i)),
      )
      .run();
    const after = await measured(manual.key);
    expect(after.cost).toBe(before.cost);
    expect((await measured("keel_key_" + "x".repeat(43))).result).toBeNull();
    await store.revoke(owner.household_id, key.grant.id);
    expect(await store.authenticate(manual.key)).toBeNull();
    expect(await store.authenticate(other.key)).not.toBeNull();
    const plans = await db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM app_access_credentials WHERE token_hash=?",
      )
      .bind(await digest(other.key))
      .all<{ detail: string }>();
    expect(
      plans.results.every(
        (p) => p.detail.includes("SEARCH") && !p.detail.includes("SCAN"),
      ),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
}, 120000);
