import { z } from "zod";
import {
  D1ServiceUnavailableError,
  type D1ServiceFailure,
} from "@keel/domain/d1-service";
import {
  CapacityUnavailableError,
  runCapacityWork,
  type CapacityProducer,
  type CapacityScope,
} from "../../../packages/database/src/d1-capacity";
import { workerCapacityStore } from "../../../packages/database/src/d1-capacity-r2";
import type { Env } from "./types";

type RouteClass = CapacityProducer | "protected";

export const CAPACITY_ROUTES: Readonly<Record<string, RouteClass>> = {
  "GET /health": "protected",
  "POST /webhooks/plaid": "plaid-webhook",
  "POST /api/deployment-smoke": "deployment-smoke",
  "GET /api/session": "protected",
  "GET /api/alpha": "protected",
  "GET /api/portfolio-baseline": "protected",
  "POST /api/portfolio-baseline/refresh": "investment-sync",
  "POST /api/portfolio-baselines": "protected",
  "GET /api/plan-inputs": "protected",
  "POST /api/plan-inputs": "protected",
  "GET /api/plan-actual-monitoring": "protected",
  "POST /api/plan-actual-monitoring/snooze": "protected",
  "GET /api/cash-accounts": "protected",
  "POST /api/cash-accounts/link-token": "protected",
  "POST /api/cash-accounts/exchange": "investment-sync",
  "POST /api/cash-accounts/auto-refresh": "automatic-refresh",
  "POST /api/cash-accounts/connections/:connectionId/refresh":
    "investment-sync",
  "DELETE /api/cash-accounts/connections/:connectionId": "protected",
  "POST /api/cash-account-proposals/:proposalId/apply": "protected",
  "POST /api/cash-account-identities/review": "protected",
  "GET /api/cash-flow": "protected",
  "POST /api/cash-flow/connections/:connectionId/sync": "investment-sync",
  "POST /api/cash-flow-proposals/:proposalId/review": "protected",
  "GET /api/liabilities": "protected",
  "POST /api/liabilities/link-token": "protected",
  "POST /api/liabilities/exchange": "investment-sync",
  "POST /api/liabilities/connections/:connectionId/refresh": "investment-sync",
  "DELETE /api/liabilities/connections/:connectionId": "protected",
  "POST /api/liability-proposals/manual": "protected",
  "POST /api/liability-proposals/:proposalId/apply": "protected",
  "GET /api/investment-connections": "protected",
  "GET /api/manual-holdings/options": "protected",
  "GET /api/manual-holdings/submissions/:submissionId": "protected",
  "POST /api/manual-holdings": "protected",
  "POST /api/manual-holdings/:positionId/identity": "protected",
  "GET /api/holdings-page": "protected",
  "GET /api/investment-position-links": "protected",
  "POST /api/investment-position-links": "protected",
  "GET /api/investment-holdings": "protected",
  "GET /api/companies/identity": "protected",
  "POST /api/companies/aliases/preview": "protected",
  "POST /api/companies/aliases": "protected",
  "GET /api/companies/public-links": "protected",
  "POST /api/companies/public-links/:exposureId/recommendation":
    "company-lookup",
  "POST /api/companies/public-links/recommendations/:id/approve": "protected",
  "POST /api/companies/public-links": "protected",
  "GET /api/investment-positions/:positionId/review": "protected",
  "POST /api/investment-positions/:positionId/review": "protected",
  "POST /api/investment-positions/:positionId/company-review": "protected",
  "POST /api/investment-positions/:positionId/related-investments": "protected",
  "POST /api/legal-entities/resolve": "imports",
  "GET /api/legal-entities": "protected",
  "POST /api/legal-entities": "protected",
  "PUT /api/legal-entities/:legalEntityId": "protected",
  "POST /api/legal-entity-sources/review": "protected",
  "POST /api/legal-entity-sources/exact-batch": "imports",
  "GET /api/legal-entity-export/options": "protected",
  "POST /api/legal-entity-export": "protected",
  "POST /api/investment-positions/:positionId/value-adjustments": "protected",
  "POST /api/investment-positions/:positionId/economics": "protected",
  "GET /api/investment-positions/:positionId/history": "protected",
  "POST /api/valuation-proxies/refresh": "investment-sync",
  "POST /api/investment-positions/:positionId/valuation": "protected",
  "GET /api/investment-positions/:positionId/share-price-evidence": "protected",
  "POST /api/investment-positions/:positionId/purchases": "protected",
  "GET /api/private-exposure-reviews": "protected",
  "POST /api/private-exposure-reviews/exact-batch": "imports",
  "POST /api/private-exposure-reviews/:positionId/assign": "protected",
  "POST /api/investment-connections/link-token": "protected",
  "POST /api/investment-connections/:connectionId/link-token": "protected",
  "POST /api/investment-connections/exchange": "investment-sync",
  "POST /api/investment-connections/auto-sync": "automatic-refresh",
  "POST /api/investment-connections/:connectionId/sync": "investment-sync",
  "PATCH /api/investment-connections/:connectionId/lifecycle": "protected",
  "DELETE /api/investment-connections/:connectionId": "protected",
  "POST /api/automation/provider-browser/:provider/reconnect":
    "agent-maintenance",
  "GET /api/automation/provider-browser/sessions/:sessionId": "protected",
  "DELETE /api/automation/provider-browser/sessions/:sessionId":
    "agent-maintenance",
  "GET /api/automation/provider-browser/sessions/:sessionId/open": "protected",
  "POST /api/automation/provider-browser/sessions/:sessionId/open":
    "agent-maintenance",
  "POST /api/automation/provider-browser/:provider/mac-agent/lease":
    "agent-maintenance",
  "POST /api/automation/provider-browser/:provider/mac-agent/rotate":
    "agent-maintenance",
  "POST /api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/status":
    "agent-results",
  "POST /api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/ready":
    "agent-results",
  "POST /api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/complete":
    "agent-results",
  "POST /api/automation/provider-browser/:provider/mac-agent/sessions/:sessionId/fail":
    "agent-results",
  "GET /api/automation/angellist/status": "protected",
  "POST /api/automation/angellist/run": "agent-maintenance",
  "POST /api/automation/angellist/mac-agent/register": "agent-maintenance",
  "POST /api/automation/angellist/mac-agent/authorize": "agent-maintenance",
  "POST /api/automation/angellist/mac-agent/run": "agent-maintenance",
  "PUT /api/automation/angellist/mac-agent/config": "agent-maintenance",
  "POST /api/automation/angellist/mac-agent/lease": "agent-maintenance",
  "POST /api/automation/angellist/mac-agent/runs/:runId/fail": "agent-results",
  "GET /api/watch/activity/progress": "protected",
  "GET /api/watch/activity": "protected",
  "POST /api/watch/targets/:targetId/website-search": "company-lookup",
  "POST /api/watch/targets/:targetId/website": "protected",
  "POST /api/watch/observations/:observationId/read": "protected",
  "POST /api/watch/scan": "watch-discovery",
  "POST /api/automation/angellist/mac-agent/runs/:runId/complete":
    "agent-results",
  "GET /api/automation/provider-holdings/:provider/status": "protected",
  "POST /api/automation/provider-holdings/:provider/run": "agent-maintenance",
  "POST /api/automation/provider-holdings/:provider/mac-agent/register":
    "agent-maintenance",
  "POST /api/automation/provider-holdings/:provider/mac-agent/authorize":
    "agent-maintenance",
  "POST /api/automation/provider-holdings/:provider/mac-agent/run":
    "agent-maintenance",
  "PUT /api/automation/provider-holdings/:provider/mac-agent/config":
    "agent-maintenance",
  "POST /api/automation/provider-holdings/:provider/mac-agent/lease":
    "agent-maintenance",
  "POST /api/automation/provider-holdings/sydecar/mac-agent/session-renewal/lease":
    "agent-maintenance",
  "POST /api/automation/provider-holdings/sydecar/mac-agent/session-renewal/complete":
    "agent-results",
  "POST /api/automation/provider-holdings/sydecar/mac-agent/session-renewal/fail":
    "agent-results",
  "POST /api/automation/provider-holdings/:provider/mac-agent/runs/:runId/fail":
    "agent-results",
  "POST /api/automation/provider-holdings/:provider/mac-agent/runs/:runId/complete":
    "agent-results",
  "POST /api/holding-imports/angellist": "imports",
  "POST /api/holding-imports/tokenfolio": "imports",
  "POST /api/holding-imports/wefunder": "imports",
  "POST /api/holding-imports/sydecar": "imports",
  "GET /api/holding-import-templates/tokenfolio": "protected",
  "GET /api/holding-import-templates/wefunder": "protected",
  "GET /api/holding-import-templates/sydecar": "protected",
  "GET /api/holding-imports": "protected",
  "POST /api/holding-imports/:importId/reconcile": "imports",
  "GET /api/holding-imports/:importId": "protected",
  "POST /api/holding-imports/:importId/apply": "imports",
  "POST /api/evidence/:eventId/review": "protected",
  "POST /api/evidence/:eventId/apply": "protected",
  "POST /api/signal-update-proposals": "protected",
  "POST /api/goals": "protected",
  "POST /api/scenarios": "protected",
  "POST /api/legal-entity-documents/:documentId/recheck": "imports",
  "POST /api/automation/provider-holdings/:provider/mac-agent/runs/:runId/document-manifest":
    "agent-results",
  "POST /api/automation/provider-holdings/:provider/mac-agent/runs/:runId/documents":
    "agent-results",
  "POST /api/legal-entity-documents/:documentId": "imports",
};

const routePatterns = Object.entries(CAPACITY_ROUTES).map(
  ([route, producer]) => {
    const [method, path] = route.split(" ");
    const pattern = path!
      .split("/")
      .map((part) =>
        part.startsWith(":")
          ? "[^/]+"
          : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      )
      .join("/");
    return { method, pattern: new RegExp(`^${pattern}$`, "u"), producer };
  },
);

export function capacityRoute(method: string, path: string): RouteClass | null {
  return (
    routePatterns.find(
      (route) =>
        route.method === (method === "HEAD" ? "GET" : method) &&
        route.pattern.test(path),
    )?.producer ?? null
  );
}

export function assertCapacityRouteCoverage(
  routes: readonly { method: string; path: string }[],
): void {
  const registered = new Set(
    routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`),
  );
  for (const route of registered) {
    if (!(route in CAPACITY_ROUTES))
      throw new Error(`D1 capacity classification missing for ${route}`);
  }
  for (const route of Object.keys(CAPACITY_ROUTES)) {
    if (!registered.has(route))
      throw new Error(`D1 capacity classification is stale for ${route}`);
  }
}

const CapacityRuntimeConfigSchema = z.object({
  account: z.string().regex(/^[a-f0-9]{32}$/u),
  database: z.uuid(),
  revision: z.string().regex(/^[a-f0-9]{40}$/u),
  key: z.string().regex(/^operations\/d1-capacity\/[a-z0-9-]+\.json$/u),
});

export type D1Observation = ReturnType<typeof observeD1>;

export function observeD1(database: D1Database, now: () => number = Date.now) {
  const cost = { reads: 0, writes: 0, statements: 0, unknown: false };
  let failure: D1ServiceUnavailableError | null = null;
  let scope: CapacityScope | undefined;
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const captureFailure = <T>(error: T): T => {
    if (error instanceof D1ServiceUnavailableError) failure ??= error;
    if (error instanceof CapacityUnavailableError)
      failure ??= new D1ServiceUnavailableError({
        error: error.message,
        code: error.code,
        retryAt: error.retryAt,
        outcome: error.outcome,
      });
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
      if (
        /Your account has exceeded D1's free tier daily row (?:read|write) limit\./u.test(
          cause.message,
        )
      ) {
        const reset = new Date(now());
        reset.setUTCHours(24, 0, 0, 0);
        failure ??= new D1ServiceUnavailableError({
          error:
            "Keel's database daily allowance is exhausted. Try again after the allowance resets. If you were saving, check for the record before trying again.",
          code: "d1_quota_exhausted",
          retryAt: reset.toISOString(),
          outcome: "unknown",
        });
      }
      cause = cause.cause;
    }
    return error;
  };
  const record = (results: D1Result[]) => {
    for (const result of results) {
      const reads = result.meta?.rows_read;
      const writes = result.meta?.rows_written;
      if (
        !Number.isSafeInteger(reads) ||
        !Number.isSafeInteger(writes) ||
        reads < 0 ||
        writes < 0
      ) {
        cost.unknown = true;
        if (scope !== undefined) {
          scope.recordUnknown();
          throw new D1ServiceUnavailableError({
            error: "Database cost evidence is unavailable.",
            code: "d1_budget_unavailable",
            retryAt: null,
            outcome: "unknown",
          });
        }
        continue;
      }
      cost.reads += reads;
      cost.writes += writes;
      cost.statements++;
      scope?.record({ reads, writes });
    }
  };
  const perform = async <T>(
    execute: () => Promise<T>,
    results: (result: T) => D1Result[],
  ): Promise<T> => {
    if (failure !== null) throw failure;
    scope?.check();
    try {
      const result = await execute();
      record(results(result));
      return result;
    } catch (error) {
      captureFailure(error);
      if (!cost.unknown) {
        cost.unknown = true;
        try {
          scope?.recordUnknown();
        } catch (metadataError) {
          captureFailure(metadataError);
        }
      }
      throw error;
    }
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      all: <T>() =>
        perform(
          () => statement.all<T>(),
          (result) => [result],
        ),
      run: <T>() =>
        perform(
          () => statement.run<T>(),
          (result) => [result],
        ),
      first: async <T>(column?: string): Promise<T | null> => {
        if (typeof statement.all !== "function") {
          cost.unknown = true;
          scope?.recordUnknown();
          try {
            return column === undefined
              ? await statement.first<T>()
              : await statement.first<T>(column);
          } catch (error) {
            throw captureFailure(error);
          }
        }
        const result = await perform(
          () => statement.all<Record<string, unknown>>(),
          (value) => [value],
        );
        const row = result.results[0];
        return row === undefined
          ? null
          : column === undefined
            ? (row as T)
            : (row[column] as T);
      },
      raw: () => {
        cost.unknown = true;
        return Promise.reject(
          captureFailure(
            new D1ServiceUnavailableError({
              error: "Unmeasured database operations are unavailable.",
              code: "d1_budget_unavailable",
              retryAt: null,
              outcome: "not_started",
            }),
          ),
        );
      },
    } as D1PreparedStatement;
    statements.set(wrapped, statement);
    return wrapped;
  };
  const rejectUnmeasured = (): Promise<never> => {
    cost.unknown = true;
    return Promise.reject(
      captureFailure(
        new D1ServiceUnavailableError({
          error: "Unmeasured database operations are unavailable.",
          code: "d1_budget_unavailable",
          retryAt: null,
          outcome: "not_started",
        }),
      ),
    );
  };
  const measured = {
    prepare: (sql: string) => wrap(database.prepare(sql)),
    batch: <T>(batch: D1PreparedStatement[]) =>
      perform(
        () =>
          database.batch<T>(
            batch.map((statement) => {
              const original = statements.get(statement);
              if (original === undefined)
                throw new Error("Unmeasured D1 statement");
              return original;
            }),
          ),
        (results) => results,
      ),
    exec: rejectUnmeasured,
    dump: rejectUnmeasured,
    withSession: (constraint?: string) => {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => wrap(session.prepare(sql)),
        batch: <T>(batch: D1PreparedStatement[]) =>
          perform(
            () =>
              session.batch<T>(
                batch.map((statement) => {
                  const original = statements.get(statement);
                  if (original === undefined)
                    throw new Error("Unmeasured D1 statement");
                  return original;
                }),
              ),
            (results) => results,
          ),
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
  return {
    database: measured,
    cost,
    get failure() {
      return failure;
    },
    attach: (value: CapacityScope) => {
      scope = value;
      if (cost.unknown) {
        scope.recordUnknown();
        throw new D1ServiceUnavailableError({
          error: "Database cost evidence is unavailable.",
          code: "d1_budget_unavailable",
          retryAt: null,
          outcome: "unknown",
        });
      }
      scope.record({ reads: cost.reads, writes: cost.writes });
    },
  };
}

export function capacityFailure(error: unknown): D1ServiceFailure | null {
  if (
    error instanceof CapacityUnavailableError ||
    error instanceof D1ServiceUnavailableError
  ) {
    return {
      error: error.message,
      code: error.code,
      retryAt: error.retryAt,
      outcome: error.outcome,
    };
  }
  return null;
}

export function quotaResponse(
  failure: D1ServiceFailure,
  now: () => number = Date.now,
): Response {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (failure.retryAt !== null)
    headers.set(
      "Retry-After",
      String(
        Math.max(1, Math.ceil((Date.parse(failure.retryAt) - now()) / 1000)),
      ),
    );
  return Response.json(failure, { status: 503, headers });
}

export async function runRuntimeD1Work<T>(
  env: Env,
  producer: CapacityProducer,
  operationId: string,
  execute: (env: Env) => Promise<T>,
  observation = observeD1(env.DB),
  operationCreatedAt = new Date().toISOString(),
): Promise<T> {
  if (env.ENVIRONMENT === "local")
    return execute({ ...env, DB: observation.database });
  if (
    [
      "watch-discovery",
      "watch-consumer",
      "plaid-discovery",
      "plaid-consumer",
      "plaid-webhook",
    ].includes(producer)
  )
    throw new D1ServiceUnavailableError({
      error: "Queued updates are temporarily unavailable. Try again later.",
      code: "d1_budget_unavailable",
      retryAt: null,
      outcome: "not_started",
    });
  const parsed = CapacityRuntimeConfigSchema.safeParse({
    account: env.D1_CAPACITY_ACCOUNT,
    database: env.D1_CAPACITY_DATABASE,
    revision: env.DEPLOYED_GIT_SHA,
    key: env.D1_CAPACITY_KEY,
  });
  if (!parsed.success || env.D1_CAPACITY === undefined)
    throw new D1ServiceUnavailableError({
      error: "Background database capacity is unavailable.",
      code: "d1_budget_unavailable",
      retryAt: null,
      outcome: "not_started",
    });
  const config = parsed.data;
  return runCapacityWork(
    {
      store: workerCapacityStore(env.D1_CAPACITY, config.key),
      account: config.account,
      database: config.database,
      revision: config.revision,
      producer,
      operationId,
      operationCreatedAt,
    },
    async (scope) => {
      observation.attach(scope);
      const result = await execute({ ...env, DB: observation.database });
      if (observation.failure !== null) throw observation.failure;
      return result;
    },
  );
}
