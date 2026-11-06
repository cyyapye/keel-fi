import { DeploymentSmokeMessageSchema } from "./deployment-smoke";
import { createApp } from "./app";
import { capacityFailure, runRuntimeD1Work } from "./d1-capacity";
import {
  PlaidHoldingsWebhookJobMessageSchema,
  PlaidInvestmentsScheduledSyncJobMessageSchema,
  PortfolioWatchSourceJobMessageSchema,
} from "@keel/connectors";
import { handleInvestmentSyncScheduled } from "./plaid-investments-schedule";
import { handlePortfolioWatchQueue } from "./portfolio-watch";
import { handlePortfolioWatchScheduled } from "./portfolio-watch-schedule";
import type { Env } from "./types";

const app = createApp();

export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  await Promise.all([
    runRuntimeD1Work(
      env,
      "plaid-discovery",
      `cron:plaid:${controller.scheduledTime}`,
      (scoped) => handleInvestmentSyncScheduled(controller, scoped),
      undefined,
      new Date(controller.scheduledTime).toISOString(),
    ),
    runRuntimeD1Work(
      env,
      "watch-discovery",
      `cron:watch:${controller.scheduledTime}`,
      (scoped) => handlePortfolioWatchScheduled(controller, scoped),
      undefined,
      new Date(controller.scheduledTime).toISOString(),
    ),
  ]);
}

export async function handleCapacityQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    if (DeploymentSmokeMessageSchema.safeParse(message.body).success) {
      message.ack();
      continue;
    }
    const producer =
      PlaidHoldingsWebhookJobMessageSchema.safeParse(message.body).success ||
      PlaidInvestmentsScheduledSyncJobMessageSchema.safeParse(message.body)
        .success
        ? "plaid-consumer"
        : PortfolioWatchSourceJobMessageSchema.safeParse(message.body).success
          ? "watch-consumer"
          : null;
    if (producer === null) {
      message.ack();
      continue;
    }
    let acknowledgement: "ack" | { delaySeconds?: number } | null = null;
    const fenced = {
      id: message.id,
      timestamp: message.timestamp,
      body: message.body,
      attempts: message.attempts,
      ack: () => {
        acknowledgement = "ack";
      },
      retry: (options?: QueueRetryOptions) => {
        acknowledgement = options ?? {};
      },
    } as Message<unknown>;
    try {
      await runRuntimeD1Work(
        env,
        producer,
        `queue:${message.id}:${message.attempts}`,
        (scoped) =>
          handlePortfolioWatchQueue(
            {
              queue: batch.queue,
              metadata: batch.metadata,
              messages: [fenced],
              ackAll: () => fenced.ack(),
              retryAll: (options?: QueueRetryOptions) => fenced.retry(options),
            },
            scoped,
          ),
      );
      if (acknowledgement === "ack") message.ack();
      else message.retry(acknowledgement ?? {});
    } catch (error) {
      const failure = capacityFailure(error);
      if (failure === null) throw error;
      console.info(
        JSON.stringify({
          event: "queue_capacity_deferred",
          producer,
          code: failure.code,
          outcome: failure.outcome,
        }),
      );
      message.retry({ delaySeconds: 60 });
    }
  }
}

export default {
  fetch: app.fetch,
  queue: handleCapacityQueue,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Env, unknown>;
