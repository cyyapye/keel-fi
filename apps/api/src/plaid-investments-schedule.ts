import {
  PLAID_INVESTMENTS_DAILY_SYNC_CRON,
  PlaidInvestmentsScheduledSyncJobMessageSchema,
  type PlaidInvestmentsScheduledSyncJobMessage,
} from "@keel/connectors";
import {
  D1HoldingImportRepository,
  D1InvestmentConnectionsRepository,
  D1PortfolioBaselineRepository,
  type InvestmentConnectionsRepository,
  type ScheduledInvestmentConnectionsRepository,
} from "@keel/database";

import {
  automaticInvestmentSyncCutoff,
  createPlaidInvestmentsClient,
  investmentsSyncConfigured,
  syncDueInvestmentConnection,
  type PlaidInvestmentsClient,
} from "./plaid-investments-sync";
import type { Env } from "./types";

export const MAX_DAILY_INVESTMENT_SYNC_JOBS = 100;

type ScheduleRepository = ScheduledInvestmentConnectionsRepository;

type ScheduledSyncDependencies = {
  repository: ScheduleRepository;
  queue: Pick<Queue, "sendBatch">;
  randomUuid?: () => string;
};

export async function enqueueDueInvestmentSyncs(input: {
  cron: string;
  scheduledAt: Date;
  dependencies: ScheduledSyncDependencies;
}): Promise<number> {
  if (input.cron !== PLAID_INVESTMENTS_DAILY_SYNC_CRON) {
    return 0;
  }
  const requestedAt = input.scheduledAt.toISOString();
  const connectionIds =
    await input.dependencies.repository.listDueAutomaticSyncConnectionIds(
      automaticInvestmentSyncCutoff(input.scheduledAt),
      MAX_DAILY_INVESTMENT_SYNC_JOBS,
    );
  if (connectionIds.length === 0) {
    return 0;
  }
  const randomUuid =
    input.dependencies.randomUuid ?? (() => crypto.randomUUID());
  const messages = connectionIds.map((connectionId) => ({
    body: PlaidInvestmentsScheduledSyncJobMessageSchema.parse({
      type: "plaid_investments_scheduled_sync",
      messageId: randomUuid(),
      connectionId,
      requestedAt,
    }),
  }));
  await input.dependencies.queue.sendBatch(messages);
  return messages.length;
}

export async function handleInvestmentSyncScheduled(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  if (!investmentsSyncConfigured(env)) {
    return;
  }
  const queuedCount = await enqueueDueInvestmentSyncs({
    cron: controller.cron,
    scheduledAt: new Date(controller.scheduledTime),
    dependencies: {
      repository: new D1InvestmentConnectionsRepository(env.DB),
      queue: env.INGESTION_QUEUE,
    },
  });
  console.log(
    JSON.stringify({
      event: "investment_sync_schedule_completed",
      queuedCount,
      scheduledAt: new Date(controller.scheduledTime).toISOString(),
    }),
  );
}

type ScheduledJobDependencies = {
  repository: InvestmentConnectionsRepository &
    ScheduledInvestmentConnectionsRepository;
  holdingImports: Pick<
    D1HoldingImportRepository,
    | "stagePlaidInvestmentsHoldingImport"
    | "autoAdjudicatePlaidInvestmentsHoldingImport"
  >;
  portfolioBaselines: Pick<
    D1PortfolioBaselineRepository,
    "getState" | "confirm"
  >;
  client: PlaidInvestmentsClient;
};

export async function processScheduledInvestmentSyncJobWithDependencies(
  message: PlaidInvestmentsScheduledSyncJobMessage,
  env: Env,
  dependencies: ScheduledJobDependencies,
): Promise<"processed"> {
  const accessSubject =
    await dependencies.repository.findAutomaticSyncAccessSubject(
      message.connectionId,
    );
  if (accessSubject === null) {
    return "processed";
  }
  await syncDueInvestmentConnection({
    env,
    repository: dependencies.repository,
    holdingImports: dependencies.holdingImports,
    portfolioBaselines: dependencies.portfolioBaselines,
    client: dependencies.client,
    accessSubject,
    connectionId: message.connectionId,
    now: new Date(message.requestedAt),
  });
  return "processed";
}

export async function processScheduledInvestmentSyncJob(
  rawMessage: unknown,
  env: Env,
): Promise<"processed"> {
  const message =
    PlaidInvestmentsScheduledSyncJobMessageSchema.parse(rawMessage);
  const repository = new D1InvestmentConnectionsRepository(env.DB);
  return processScheduledInvestmentSyncJobWithDependencies(message, env, {
    repository,
    holdingImports: new D1HoldingImportRepository(env.DB),
    portfolioBaselines: new D1PortfolioBaselineRepository(env.DB),
    client: createPlaidInvestmentsClient(env),
  });
}
