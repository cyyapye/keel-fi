import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";
import { describe, expect, it } from "vitest";

import { PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS } from "../apps/api/src/portfolio-watch";
import { __investmentConnectionsTest } from "../packages/database/src/investment-connections";

const QueueConsumerSchema = z
  .object({
    queue: z.string(),
    dead_letter_queue: z.string(),
    max_retries: z.number().int().positive(),
  })
  .passthrough();

const QueueRuntimeConfigurationSchema = z.object({
  queues: z.object({ consumers: z.array(QueueConsumerSchema) }),
  env: z.object({
    local: z.object({
      queues: z.object({ consumers: z.array(QueueConsumerSchema) }),
    }),
  }),
});

function runtimeConfiguration() {
  const jsonc = readFileSync(
    resolve(process.cwd(), "apps/api/wrangler.jsonc"),
    "utf8",
  );
  const json = jsonc
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/,(\s*[}\]])/gu, "$1");
  return QueueRuntimeConfigurationSchema.parse(JSON.parse(json) as unknown);
}

describe("queue runtime configuration", () => {
  it("retains failed production and local messages in dedicated queues", () => {
    const configuration = runtimeConfiguration();

    expect(configuration.queues.consumers).toContainEqual(
      expect.objectContaining({
        queue: "keel-ingestion",
        dead_letter_queue: "keel-ingestion-dlq",
        max_retries: 3,
      }),
    );
    expect(configuration.env.local.queues.consumers).toContainEqual(
      expect.objectContaining({
        queue: "keel-local-ingestion",
        dead_letter_queue: "keel-local-ingestion-dlq",
        max_retries: 3,
      }),
    );
  });

  it("keeps the final Plaid retry beyond the D1 stale-lease boundary", () => {
    const consumer = runtimeConfiguration().queues.consumers.find(
      (candidate) => candidate.queue === "keel-ingestion",
    );
    if (consumer === undefined) {
      throw new Error("Production ingestion consumer is missing.");
    }

    expect(
      consumer.max_retries * PLAID_HOLDINGS_QUEUE_RETRY_DELAY_SECONDS * 1_000,
    ).toBeGreaterThan(__investmentConnectionsTest.syncStaleAfterMs);
  });
});
