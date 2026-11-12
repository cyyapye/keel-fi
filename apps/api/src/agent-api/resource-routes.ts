import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnvironment } from "../app";
import {
  GoalConflict,
  ETAG,
  resourceId,
  pageArgs,
  goalPageArgs,
  newGoal,
  goalPatch,
  getGoal,
  getGoalPage,
  getVersions,
  writeGoal,
} from "./goals";
import {
  accounts,
  collectionArgs,
  evidence,
  liabilities,
  oneAccount,
  oneBaseline,
  onePosition,
  positions,
  ResourceUnavailable,
} from "./resources";
type ApiContext = Context<AppEnvironment>;
const prefix = "/api/v1/";
export function params(url: string) {
  const search = new URL(url).searchParams;
  if (new Set(search.keys()).size !== search.size) return null;
  return Object.fromEntries(search);
}
function parameters<T extends z.ZodType>(
  c: ApiContext,
  schema: T,
): z.output<T> {
  const result = schema.safeParse(params(c.req.url));
  if (!result.success)
    throw new GoalConflict(
      400,
      "invalid_request",
      "Unsupported or invalid query parameter.",
    );
  return result.data;
}
function id(c: ApiContext) {
  const input = resourceId.safeParse(c.req.param("id"));
  if (!input.success)
    throw new GoalConflict(400, "invalid_request", "Invalid resource ID.");
  return input.data;
}
function detail(c: ApiContext, record: object | null) {
  return record
    ? c.json(record)
    : c.json({ code: "not_found", error: "Resource not found." }, 404);
}
const empty = z.strictObject({});
export function registerResources(app: Hono<AppEnvironment>) {
  const household = (c: ApiContext) => c.get("agentReadHousehold");
  app.get(prefix + "goals", async (c) => {
    const query = parameters(c, goalPageArgs);
    return c.json(
      await getGoalPage(
        c.env.DB,
        household(c),
        Number(query.after ?? 0),
        query.status ?? "active",
      ),
    );
  });
  app.get(prefix + "goals/:id", async (c) => {
    parameters(c, empty);
    const g = await getGoal(c.env.DB, household(c), id(c));
    if (g) c.header("ETag", `"${g.revision}"`);
    return detail(c, g);
  });
  app.get(prefix + "goals/:id/versions", async (c) => {
    const q = parameters(c, pageArgs);
    return detail(
      c,
      await getVersions(c.env.DB, household(c), id(c), Number(q.after ?? 0)),
    );
  });
  const limit = bodyLimit({
    maxSize: 8192,
    onError: (c) =>
      c.json({ code: "invalid_request", error: "Request exceeds 8 KiB." }, 413),
  });
  async function save(c: ApiContext) {
    parameters(c, empty);
    const key = z
      .string()
      .min(1)
      .max(128)
      .regex(/^[!-~]+$/)
      .safeParse(c.req.header("Idempotency-Key"));
    if (!key.success)
      throw new GoalConflict(
        400,
        "invalid_request",
        "Supply an Idempotency-Key header.",
      );
    const actor = c.get("identity");
    const body: unknown = await c.req.json().catch(() => null);
    const create = c.req.method === "POST";
    const db = c.env.DB,
      hh = household(c),
      by = c.get("appAccess")
        ? "app:" + c.get("appAccess")!.grantId
        : actor.kind + ":" + actor.subject;
    let receipt;
    if (create) {
      const value = newGoal.safeParse(body);
      if (!value.success)
        throw new GoalConflict(
          400,
          "invalid_request",
          "Supply a valid dated goal.",
        );
      receipt = await writeGoal(db, hh, by, key.data, {
        type: "create",
        input: value.data,
      });
    } else {
      const version = c.req.header("If-Match");
      if (!version)
        throw new GoalConflict(
          428,
          "precondition_required",
          "Supply the ETag from the current goal as If-Match.",
        );
      const match = ETAG.exec(version);
      const value = goalPatch.safeParse(body);
      if (!match || !value.success)
        throw new GoalConflict(
          400,
          "invalid_request",
          "Supply a valid change and revision.",
        );
      receipt = await writeGoal(db, hh, by, key.data, {
        type: "patch",
        id: id(c),
        expected: Number(match[1]),
        input: value.data,
      });
    }
    c.header("ETag", `"${receipt.revision}"`);
    c.header(
      "Location",
      prefix + "goals/" + encodeURIComponent(receipt.goalId),
    );
    return c.json(receipt, create ? 201 : 200);
  }
  app.post(prefix + "goals", limit, save);
  app.patch(prefix + "goals/:id", limit, save);
  app.get(prefix + "positions", async (c) => {
    const q = parameters(c, collectionArgs);
    return c.json(await positions(c.env.DB, household(c), q.after));
  });
  app.get(prefix + "positions/:id", async (c) => {
    const q = parameters(
      c,
      z.strictObject({ afterExposure: resourceId.optional() }),
    );
    return detail(
      c,
      await onePosition(c.env.DB, household(c), id(c), q.afterExposure),
    );
  });
  app.get(prefix + "accounts", async (c) => {
    const q = parameters(
      c,
      collectionArgs.extend({ baselineId: resourceId.optional() }),
    );
    return c.json(
      await accounts(c.env.DB, household(c), q.after, q.baselineId),
    );
  });
  app.get(prefix + "accounts/:id", async (c) => {
    parameters(c, empty);
    return detail(c, await oneAccount(c.env.DB, household(c), id(c)));
  });
  app.get(prefix + "liabilities", async (c) => {
    const q = parameters(c, collectionArgs);
    const rows = (await liabilities(c.env.DB, household(c))).filter(
      (r) => !q.after || r.id > q.after,
    );
    return c.json({
      items: rows.slice(0, 50),
      nextAfter: rows.length > 50 ? rows[49]!.id : null,
    });
  });
  app.get(prefix + "liabilities/:id", async (c) => {
    parameters(c, empty);
    const key = id(c);
    return detail(
      c,
      (await liabilities(c.env.DB, household(c))).find((r) => r.id === key) ??
        null,
    );
  });
  app.get(prefix + "baselines/:id", async (c) => {
    parameters(c, empty);
    return detail(c, await oneBaseline(c.env.DB, household(c), id(c)));
  });
  app.get(prefix + "evidence/:id", async (c) => {
    parameters(c, empty);
    return detail(c, await evidence(c.env.DB, household(c), id(c)));
  });
}
export function resourceError(error: Error, c: ApiContext) {
  if (error instanceof GoalConflict) {
    if (error.status === 412)
      c.header(
        "Link",
        "<" + new URL(c.req.url).pathname + '>; rel="latest-version"',
      );
    return c.json({ code: error.code, error: error.message }, error.status);
  }
  if (error instanceof ResourceUnavailable)
    return c.json(
      {
        code: "data_unavailable",
        reason: "debt_history_limit",
        error: "Reviewed debt history exceeds the supported read window.",
      },
      503,
    );
  return c.json(
    {
      code: "data_unavailable",
      error: "The requested financial data is unavailable.",
    },
    503,
    { "Cache-Control": "private, no-store" },
  );
}
