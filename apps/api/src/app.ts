import { D1AlphaRepository, type AlphaRepository } from "@keel/database";
import { GoalDraftInputSchema, ScenarioDraftInputSchema } from "@keel/domain";
import { ReviewInputSchema } from "@keel/evidence";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { verifyAccessToken, type AccessVerifier } from "./auth";
import type { AccessIdentity, Env } from "./types";

type Variables = {
  identity: AccessIdentity;
  requestId: string;
};

type AppEnvironment = {
  Bindings: Env;
  Variables: Variables;
};

type AppOptions = {
  repository?: AlphaRepository;
  verifyAccess?: AccessVerifier;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnvironment>();
  const verifier = options.verifyAccess ?? verifyAccessToken;

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      crossOriginResourcePolicy: "same-site",
      referrerPolicy: "no-referrer",
      strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    }),
  );

  app.use("*", async (context, next) => {
    const startedAt = Date.now();
    const requestId =
      context.req.header("Cf-Ray") ??
      context.req.header("X-Request-Id") ??
      crypto.randomUUID();
    context.set("requestId", requestId);

    await next();

    console.info(
      JSON.stringify({
        event: "request_complete",
        requestId,
        method: context.req.method,
        route: context.req.routePath || "unmatched",
        status: context.res.status,
        durationMs: Date.now() - startedAt,
      }),
    );
  });

  app.get("/health", (context) =>
    context.json({ status: "ok", service: "keel-api" }),
  );

  app.use("/api/*", async (context, next) => {
    const token = context.req.header("Cf-Access-Jwt-Assertion");

    if (context.env.ENVIRONMENT === "local" && token === undefined) {
      context.set("identity", {
        subject: "synthetic-access-subject",
        email: "demo@example.invalid",
      });
      await next();
      return;
    }

    if (token === undefined || token.length === 0) {
      return context.json(
        { error: "Cloudflare Access authentication is required." },
        401,
      );
    }

    try {
      context.set("identity", await verifier(token, context.env));
      await next();
      return;
    } catch {
      return context.json(
        { error: "Access identity could not be validated." },
        401,
      );
    }
  });

  const repositoryFor = (env: Env) =>
    options.repository ?? new D1AlphaRepository(env.DB);

  app.get("/api/alpha", async (context) => {
    try {
      const data = await repositoryFor(context.env).getAlphaData(
        context.get("identity").subject,
      );
      return context.json(data, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_failed",
          requestId: context.get("requestId"),
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return context.json(
        { error: "Keel could not load the household view." },
        500,
      );
    }
  });

  app.post("/api/evidence/:eventId/review", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = ReviewInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Review input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      await repositoryFor(context.env).reviewEvidence(
        context.get("identity").subject,
        context.req.param("eventId"),
        result.data,
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Evidence event not found." }, 404);
      }
      if (message.includes("transition")) {
        return context.json(
          { error: "Evidence event was already reviewed." },
          409,
        );
      }
      return context.json(
        { error: "Evidence review could not be recorded." },
        500,
      );
    }
  });

  app.post("/api/evidence/:eventId/apply", async (context) => {
    try {
      await repositoryFor(context.env).applyEvidence(
        context.get("identity").subject,
        context.req.param("eventId"),
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Evidence event not found." }, 404);
      }
      if (
        message.includes("transition") ||
        message.includes("direct") ||
        message.includes("already") ||
        message.includes("target") ||
        message.includes("financial value") ||
        message.includes("complete proposed") ||
        message.includes("review decision")
      ) {
        return context.json(
          { error: "Evidence cannot be applied automatically." },
          409,
        );
      }
      return context.json(
        { error: "Evidence application could not be recorded." },
        500,
      );
    }
  });

  app.post("/api/goals", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = GoalDraftInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Goal input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      await repositoryFor(context.env).saveGoal(
        context.get("identity").subject,
        result.data,
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Goal not found." }, 404);
      }
      if (message.includes("template")) {
        return context.json(
          { error: "A saved goal cannot change templates." },
          409,
        );
      }
      return context.json({ error: "Goal version could not be saved." }, 500);
    }
  });

  app.post("/api/scenarios", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = ScenarioDraftInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Scenario input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      await repositoryFor(context.env).saveScenario(
        context.get("identity").subject,
        result.data,
      );
      return context.body(null, 204, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Scenario not found." }, 404);
      }
      if (message.includes("stale") || message.includes("between")) {
        return context.json(
          {
            error:
              "Scenario inputs changed elsewhere. Your draft is still local.",
          },
          409,
        );
      }
      if (message.includes("Probability assumptions")) {
        return context.json({ error: message }, 400);
      }
      return context.json(
        { error: "Scenario version could not be saved." },
        500,
      );
    }
  });

  app.notFound((context) => context.json({ error: "Not found." }, 404));

  return app;
}
