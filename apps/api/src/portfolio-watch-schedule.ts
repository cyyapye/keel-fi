import {
  PLAID_INVESTMENTS_DAILY_SYNC_CRON,
  PortfolioWatchSourceJobMessageSchema,
} from "@keel/connectors";
import {
  D1PortfolioWatchRepository,
  type ScheduledPortfolioWatchRepository,
} from "@keel/database";

import type { Env } from "./types";

export const MAX_DAILY_PORTFOLIO_WATCH_JOBS = 100;

type ScheduledPortfolioWatchDependencies = {
  repository: ScheduledPortfolioWatchRepository;
  queue: Pick<Queue, "sendBatch">;
  randomUuid?: () => string;
};

export async function enqueueDuePortfolioWatchSources(input: {
  cron: string;
  scheduledAt: Date;
  dependencies: ScheduledPortfolioWatchDependencies;
}): Promise<number> {
  if (input.cron !== PLAID_INVESTMENTS_DAILY_SYNC_CRON) {
    return 0;
  }
  const requestedAt = input.scheduledAt.toISOString();
  const jobs = await input.dependencies.repository.listDueSourceJobs(
    requestedAt,
    MAX_DAILY_PORTFOLIO_WATCH_JOBS,
  );
  if (jobs.length === 0) {
    return 0;
  }
  const randomUuid =
    input.dependencies.randomUuid ?? (() => crypto.randomUUID());
  await input.dependencies.queue.sendBatch(
    jobs.map((job) => ({
      body: PortfolioWatchSourceJobMessageSchema.parse({
        ...job,
        messageId: randomUuid(),
        requestedAt,
      }),
    })),
  );
  return jobs.length;
}

export async function handlePortfolioWatchScheduled(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const queuedCount = await enqueueDuePortfolioWatchSources({
    cron: controller.cron,
    scheduledAt: new Date(controller.scheduledTime),
    dependencies: {
      repository: new D1PortfolioWatchRepository(env.DB),
      queue: env.INGESTION_QUEUE,
    },
  });
  console.log(
    JSON.stringify({
      event: "portfolio_watch_schedule_completed",
      queuedCount,
      scheduledAt: new Date(controller.scheduledTime).toISOString(),
    }),
  );
}
