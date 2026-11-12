import { params, registerResources, resourceError } from "./resource-routes";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnvironment } from "../app";
import type { AccessIdentity, Env } from "../types";
import { marksQuery, pageQuery, previewInput } from "./contract";
import { openApi } from "./spec";
import { projectOutlook } from "./outlook";
import { readRecords, readMarks } from "./read";

const paths = {
  spec: "/api/v1/openapi.json",
  outlook: "/api/v1/outlook",
  preview: "/api/v1/outlook/preview",
  marks: "/api/v1/marks",
} as const;
const grant = z.object({
  AGENT_READ_SERVICE_SUBJECT: z.string().regex(/^[a-f0-9]{32}\.access$/i),
  AGENT_READ_HOUSEHOLD_ID: z.string().trim().min(1).max(256),
});
const writer = z.object({
  AGENT_GOAL_WRITE_SERVICE_SUBJECT: z.string().regex(/^[a-f0-9]{32}\.access$/i),
  AGENT_GOAL_WRITE_HOUSEHOLD_ID: z.string().trim().min(1).max(256),
});
function writeHousehold(env: Env, identity: AccessIdentity) {
  const binding = writer.safeParse(env);
  if (
    identity.kind !== "service" ||
    !binding.success ||
    identity.subject !== binding.data.AGENT_GOAL_WRITE_SERVICE_SUBJECT ||
    identity.subject === env.AGENT_READ_SERVICE_SUBJECT
  )
    return null;
  return binding.data.AGENT_GOAL_WRITE_HOUSEHOLD_ID;
}
export function serviceHousehold(env: Env, identity: AccessIdentity) {
  if (identity.kind !== "service") return null;
  if (identity.subject === env.AGENT_GOAL_WRITE_SERVICE_SUBJECT)
    return writeHousehold(env, identity);
  const result = grant.safeParse(env);
  return result.success &&
    identity.subject === result.data.AGENT_READ_SERVICE_SUBJECT
    ? result.data.AGENT_READ_HOUSEHOLD_ID
    : null;
}
export function permitsAgentRead(
  env: Env,
  identity: AccessIdentity,
  method: string,
  path: string,
) {
  if (!serviceHousehold(env, identity)) return false;
  if (method === "GET")
    return (
      Object.values(paths).some((p) => p === path && p !== paths.preview) ||
      /^\/api\/v1\/(?:investment-transactions|tax-lots|investment-reconciliation|goals(?:\/[^/]+(?:\/versions)?)?|(?:accounts|positions|liabilities)(?:\/[^/]+)?|(?:baselines|evidence)\/[^/]+)$/.test(
        path,
      )
    );
  if (method === "POST" && path === paths.preview) return true;
  return (
    writeHousehold(env, identity) !== null &&
    ((method === "POST" && path === "/api/v1/goals") ||
      (method === "PATCH" && /^\/api\/v1\/goals\/[^/]+$/.test(path)))
  );
}
async function householdFor(env: Env, identity: AccessIdentity) {
  if (identity.kind === "service") {
    const id = serviceHousehold(env, identity);
    return id
      ? await env.DB.prepare("SELECT id FROM households WHERE id=?")
          .bind(id)
          .first<string>("id")
      : null;
  }
  const found = await env.DB.prepare(
    `SELECT h.id FROM users u JOIN households h ON h.owner_user_id=u.id
    WHERE u.access_subject=? LIMIT 2`,
  )
    .bind(identity.subject)
    .all<{ id: string }>();
  return found.results.length === 1 ? found.results[0]!.id : null;
}
export function registerAgentRoutes(parent: Hono<AppEnvironment>) {
  const app = new Hono<AppEnvironment>();
  app.onError(resourceError);
  app.use("/api/v1/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const household =
      c.get("appAccess")?.householdId ??
      (await householdFor(c.env, c.get("identity")));
    if (!household)
      return c.json(
        { code: "forbidden", error: "No authorized household." },
        403,
      );
    c.set("agentReadHousehold", household);
    return next();
  });
  app.get(paths.spec, (c) => c.json(openApi()));
  app.get(paths.outlook, async (c) => {
    const query = pageQuery.safeParse(params(c.req.url));
    if (!query.success)
      return c.json(
        {
          code: "invalid_request",
          error: "Expected an optional afterGoal cursor.",
        },
        400,
      );
    const date = new Date().toISOString().slice(0, 10);
    const through = new Date(Date.parse(date) + 365 * 86400000)
      .toISOString()
      .slice(0, 10);
    const data = await readRecords(
      c.env.DB,
      c.get("agentReadHousehold"),
      Number(query.data.afterGoal ?? 0),
    );
    return c.json(projectOutlook(data, date, { through }));
  });
  app.post(
    paths.preview,
    bodyLimit({
      maxSize: 8192,
      onError: (c) =>
        c.json(
          { code: "invalid_request", error: "Preview exceeds 8 KiB." },
          413,
        ),
    }),
    async (c) => {
      const query = pageQuery.safeParse(params(c.req.url));
      const input = previewInput.safeParse(
        await c.req.json().catch(() => null),
      );
      const date = new Date().toISOString().slice(0, 10);
      const maxDate = new Date(Date.parse(date) + 366 * 86400000 * 50)
        .toISOString()
        .slice(0, 10);
      if (
        !query.success ||
        !input.success ||
        [
          input.data.through,
          ...(input.data.targets ?? []).map((t) => t.date),
        ].some((d) => d < date || d > maxDate)
      )
        return c.json(
          {
            code: "invalid_request",
            error:
              "Supply a valid cursor and dated scenario within the next 50 years.",
          },
          400,
        );
      const data = await readRecords(
        c.env.DB,
        c.get("agentReadHousehold"),
        Number(query.data.afterGoal ?? 0),
      );
      return c.json(projectOutlook(data, date, input.data));
    },
  );
  app.get(paths.marks, async (c) => {
    const query = marksQuery.safeParse(params(c.req.url));
    if (!query.success)
      return c.json(
        {
          code: "invalid_request",
          error: "Supply a baselineId and optional after cursor.",
        },
        400,
      );
    const page = await readMarks(
      c.env.DB,
      c.get("agentReadHousehold"),
      query.data.baselineId,
      query.data.after ?? "",
    );
    return page
      ? c.json(page)
      : c.json({ code: "not_found", error: "Baseline not found." }, 404);
  });
  registerResources(app);
  parent.route("/", app);
}
