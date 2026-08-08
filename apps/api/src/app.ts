import {
  AngelListCsvParseError,
  parseAngelListInvestmentsCsv,
} from "@keel/connectors";
import { D1AlphaRepository, type AlphaRepository } from "@keel/database";
import {
  CreateSignalUpdateProposalInputSchema,
  GoalDraftInputSchema,
  HoldingImportApplyInputSchema,
  PortfolioWatchScanResultSchema,
  ScenarioDraftInputSchema,
} from "@keel/domain";
import { ReviewInputSchema } from "@keel/evidence";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { verifyAccessToken, type AccessVerifier } from "./auth";
import {
  deploymentSmokeTokenMatches,
  runDeploymentSmoke,
} from "./deployment-smoke";
import {
  HoldingImportUploadError,
  readAngelListCsvUpload,
} from "./holding-import-upload";
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

async function sha256Bytes(contents: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function discardPrivateObject(bucket: R2Bucket, objectKey: string) {
  try {
    await bucket.delete(objectKey);
  } catch {
    // The database never references this object. A bucket lifecycle rule is the
    // final fallback for an orphaned failed-upload object.
  }
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
    context.json({
      status: "ok",
      service: "keel-api",
      deployedGitSha: context.env.DEPLOYED_GIT_SHA ?? null,
      workerVersionId: context.env.CF_VERSION_METADATA?.id ?? null,
      workerVersionTag: context.env.CF_VERSION_METADATA?.tag ?? null,
    }),
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

  app.post("/api/deployment-smoke", async (context) => {
    if (context.env.ENVIRONMENT !== "preview") {
      return context.json({ error: "Not found." }, 404);
    }

    const authorized = await deploymentSmokeTokenMatches(
      context.req.header("X-Keel-Deployment-Smoke-Token"),
      context.env.DEPLOYMENT_SMOKE_TOKEN,
    );
    if (!authorized) {
      return context.json({ error: "Deployment smoke access denied." }, 403);
    }

    try {
      return context.json(await runDeploymentSmoke(context.env), 200, {
        "Cache-Control": "no-store",
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "deployment_smoke_failed",
          requestId: context.get("requestId"),
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return context.json({ error: "Deployment smoke failed." }, 503);
    }
  });

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

  app.post("/api/watch/scan", async (context) => {
    try {
      const preparation = await repositoryFor(
        context.env,
      ).preparePortfolioWatchScan(context.get("identity").subject);
      await Promise.all(
        preparation.jobs.map((job) =>
          context.env.INGESTION_QUEUE.send({
            ...job,
            messageId: crypto.randomUUID(),
            requestedAt: preparation.checkedAt,
          }),
        ),
      );
      return context.json(
        PortfolioWatchScanResultSchema.parse({
          checkedAt: preparation.checkedAt,
          queuedCount: preparation.jobs.length,
          discoveredCount: 0,
          proposedCount: 0,
        }),
        202,
        {
          "Cache-Control": "private, no-store",
        },
      );
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json(
          { error: "Portfolio Watch is not configured for this household." },
          404,
        );
      }
      return context.json(
        { error: "Public-source scan could not be completed." },
        500,
      );
    }
  });

  app.post("/api/holding-imports/angellist", async (context) => {
    let upload: Awaited<ReturnType<typeof readAngelListCsvUpload>>;
    try {
      upload = await readAngelListCsvUpload(context.req.raw);
    } catch (error) {
      if (error instanceof HoldingImportUploadError) {
        return context.json(
          { error: error.message },
          error.code === "file_too_large" ? 413 : 400,
          { "Cache-Control": "private, no-store" },
        );
      }
      return context.json(
        { error: "Keel could not read that CSV upload." },
        400,
        { "Cache-Control": "private, no-store" },
      );
    }

    let parsed: Awaited<ReturnType<typeof parseAngelListInvestmentsCsv>>;
    try {
      parsed = await parseAngelListInvestmentsCsv(upload.bytes);
    } catch (error) {
      return context.json(
        {
          error:
            error instanceof AngelListCsvParseError
              ? error.message
              : "This is not a supported AngelList investments export.",
        },
        error instanceof AngelListCsvParseError &&
          error.code === "file_too_large"
          ? 413
          : 400,
        { "Cache-Control": "private, no-store" },
      );
    }

    const objectKey = `holding-imports/${crypto.randomUUID()}.csv`;
    try {
      await context.env.DOCUMENTS.put(objectKey, upload.bytes, {
        httpMetadata: { contentType: "text/csv" },
      });
    } catch {
      return context.json(
        { error: "Keel could not retain this import for review." },
        500,
        { "Cache-Control": "private, no-store" },
      );
    }

    try {
      const staged = await repositoryFor(context.env).stageHoldingImport(
        context.get("identity").subject,
        {
          objectKey,
          sha256: await sha256Bytes(upload.bytes),
          byteSize: upload.bytes.byteLength,
          effectiveDate: upload.effectiveDate,
          retrievedAt: upload.retrievedAt,
          rows: parsed.rows,
        },
      );
      if (!staged.created) {
        await discardPrivateObject(context.env.DOCUMENTS, objectKey);
      }
      return context.json(staged.preview, staged.created ? 201 : 200, {
        "Cache-Control": "private, no-store",
      });
    } catch {
      await discardPrivateObject(context.env.DOCUMENTS, objectKey);
      return context.json(
        { error: "Keel could not prepare this import for review." },
        500,
        { "Cache-Control": "private, no-store" },
      );
    }
  });

  app.get("/api/holding-imports/:importId", async (context) => {
    try {
      const preview = await repositoryFor(context.env).getHoldingImport(
        context.get("identity").subject,
        context.req.param("importId"),
      );
      return context.json(preview, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      if (errorMessage(error).includes("not found")) {
        return context.json({ error: "Holding import not found." }, 404);
      }
      return context.json(
        { error: "Keel could not load this holding import." },
        500,
      );
    }
  });

  app.post("/api/holding-imports/:importId/apply", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }
    const parsedInput = HoldingImportApplyInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      return context.json(
        { error: "Every imported position needs a valid review decision." },
        400,
      );
    }

    try {
      const result = await repositoryFor(context.env).applyHoldingImport(
        context.get("identity").subject,
        context.req.param("importId"),
        parsedInput.data,
      );
      return context.json(result, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json({ error: "Holding import not found." }, 404);
      }
      if (message.includes("already reviewed")) {
        return context.json(
          { error: "This import was already reviewed differently." },
          409,
        );
      }
      if (
        message.includes("every row") ||
        message.includes("needs attention") ||
        message.includes("currency") ||
        message.includes("Matched holding")
      ) {
        return context.json(
          { error: "The import review is incomplete or inconsistent." },
          409,
        );
      }
      return context.json(
        { error: "Nothing changed. The holding import could not be applied." },
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

  app.post("/api/signal-update-proposals", async (context) => {
    let rawInput: unknown;
    try {
      rawInput = await context.req.json();
    } catch {
      return context.json({ error: "A JSON request body is required." }, 400);
    }

    const result = CreateSignalUpdateProposalInputSchema.safeParse(rawInput);
    if (!result.success) {
      return context.json(
        {
          error: "Signal update proposal input is invalid.",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }

    try {
      const proposal = await repositoryFor(
        context.env,
      ).createSignalUpdateProposal(
        context.get("identity").subject,
        result.data,
      );
      return context.json(proposal, 201, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("not found")) {
        return context.json(
          { error: "Signal group or scenario not found." },
          404,
        );
      }
      if (
        message.includes("stale") ||
        message.includes("not ready") ||
        message.includes("version mismatch") ||
        message.includes("UNIQUE")
      ) {
        return context.json(
          {
            error:
              "Signals or the scenario changed. Reload before creating the proposal.",
          },
          409,
        );
      }
      return context.json(
        { error: "Signal update proposal could not be created." },
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
