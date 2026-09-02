import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PlaidHoldingsWebhookJobMessageSchema,
  PlaidInvestmentsScheduledSyncJobMessageSchema,
  PortfolioWatchSourceJobMessageSchema,
} from "../packages/connectors/src/index";
import { z } from "zod";

import { DeploymentSmokeMessageSchema } from "../apps/api/src/deployment-smoke";

const CloudflareQueueNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u);

const QueueListResponseSchema = z
  .object({
    success: z.literal(true),
    result: z.array(
      z.object({
        queue_id: z.string().min(1).max(64),
        queue_name: CloudflareQueueNameSchema,
      }),
    ),
  })
  .passthrough();

const PeekedMessageSchema = z
  .object({
    id: z.string().min(1).max(128),
    attempts: z.number().int().nonnegative(),
    body: z.string().min(1),
    metadata: z
      .object({
        "CF-Content-Type": z.string().min(1),
      })
      .passthrough(),
    ref: z.string().min(1),
    timestamp_ms: z.number().int().nonnegative(),
  })
  .passthrough();

const PeekResponseSchema = z
  .object({
    success: z.literal(true),
    result: z.object({ messages: z.array(PeekedMessageSchema) }),
  })
  .passthrough();

const MutationResponseSchema = z
  .object({ success: z.literal(true) })
  .passthrough();

const PurgeResponseSchema = z
  .object({
    success: z.literal(true),
    result: z
      .object({
        errors: z
          .array(z.object({ message: z.string().optional() }))
          .optional(),
        warnings: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

const KnownQueueMessageSchema = z.union([
  PortfolioWatchSourceJobMessageSchema,
  PlaidHoldingsWebhookJobMessageSchema,
  PlaidInvestmentsScheduledSyncJobMessageSchema,
  DeploymentSmokeMessageSchema,
]);

const RuntimeConfigurationSchema = z
  .object({
    accountId: z.string().min(1).max(64),
    apiToken: z.string().min(1).max(4_096),
    sourceQueueName: CloudflareQueueNameSchema,
    destinationQueueName: CloudflareQueueNameSchema,
  })
  .strict();

type PeekedMessage = z.infer<typeof PeekedMessageSchema>;
type KnownQueueMessage = z.infer<typeof KnownQueueMessageSchema>;

export type DeadLetterMessageSummary = {
  id: string;
  attempts: number;
  queuedAt: string;
  type: KnownQueueMessage["type"] | "invalid";
  messageId: string | null;
  requestedAt: string | null;
};

export interface QueueRecoveryClient {
  resolveQueueId(queueName: string): Promise<string>;
  peek(queueId: string, batchSize: number): Promise<readonly PeekedMessage[]>;
  push(queueId: string, body: KnownQueueMessage): Promise<void>;
  purge(queueId: string, ref: string): Promise<void>;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function decodedJsonBody(message: PeekedMessage): unknown {
  if (message.metadata["CF-Content-Type"] !== "json") {
    throw new Error("Only JSON queue messages can be redriven.");
  }
  const candidates = [
    message.body,
    Buffer.from(message.body, "base64").toString("utf8"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Cloudflare may expose JSON queue bodies directly or as RFC 4648 base64.
    }
  }
  throw new Error("The selected queue message does not contain valid JSON.");
}

export function parseKnownQueueMessage(
  message: PeekedMessage,
): KnownQueueMessage {
  const parsed = KnownQueueMessageSchema.safeParse(decodedJsonBody(message));
  if (!parsed.success) {
    throw new Error("The selected DLQ message is not a supported Keel job.");
  }
  return parsed.data;
}

export function summarizeDeadLetterMessage(
  message: PeekedMessage,
): DeadLetterMessageSummary {
  const parsed = KnownQueueMessageSchema.safeParse(decodedJsonBody(message));
  return {
    id: message.id,
    attempts: message.attempts,
    queuedAt: new Date(message.timestamp_ms).toISOString(),
    type: parsed.success ? parsed.data.type : "invalid",
    messageId: parsed.success ? parsed.data.messageId : null,
    requestedAt: parsed.success ? parsed.data.requestedAt : null,
  };
}

async function responseJson(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Cloudflare Queue API returned HTTP ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(`Cloudflare Queue API returned HTTP ${response.status}.`);
  }
  return payload;
}

export function createCloudflareQueueRecoveryClient(input: {
  accountId: string;
  apiToken: string;
  fetchImpl?: FetchLike;
}): QueueRecoveryClient {
  const accountId = z.string().min(1).max(64).parse(input.accountId);
  const apiToken = z.string().min(1).max(4_096).parse(input.apiToken);
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues`;

  async function request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<unknown> {
    return responseJson(
      await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  return {
    async resolveQueueId(queueName) {
      const expectedName = CloudflareQueueNameSchema.parse(queueName);
      const response = QueueListResponseSchema.parse(
        await request("?per_page=100", "GET"),
      );
      const matches = response.result.filter(
        (queue) => queue.queue_name === expectedName,
      );
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one Queue named ${expectedName}.`);
      }
      const [match] = matches;
      if (match === undefined) {
        throw new Error(`Queue ${expectedName} was not found.`);
      }
      return match.queue_id;
    },

    async peek(queueId, batchSize) {
      const parsedQueueId = z.string().min(1).max(64).parse(queueId);
      const parsedBatchSize = z.number().int().min(1).max(100).parse(batchSize);
      return PeekResponseSchema.parse(
        await request(
          `/${encodeURIComponent(parsedQueueId)}/messages/peek`,
          "POST",
          {
            batch_size: parsedBatchSize,
          },
        ),
      ).result.messages;
    },

    async push(queueId, body) {
      const parsedQueueId = z.string().min(1).max(64).parse(queueId);
      MutationResponseSchema.parse(
        await request(
          `/${encodeURIComponent(parsedQueueId)}/messages`,
          "POST",
          {
            body: KnownQueueMessageSchema.parse(body),
            content_type: "json",
          },
        ),
      );
    },

    async purge(queueId, ref) {
      const parsedQueueId = z.string().min(1).max(64).parse(queueId);
      const parsedRef = z.string().min(1).parse(ref);
      const response = PurgeResponseSchema.parse(
        await request(
          `/${encodeURIComponent(parsedQueueId)}/messages/purge`,
          "POST",
          { refs: [{ ref: parsedRef }] },
        ),
      );
      if (
        (response.result?.errors?.length ?? 0) > 0 ||
        Object.keys(response.result?.warnings ?? {}).length > 0
      ) {
        throw new Error(
          "The message was re-published, but Cloudflare did not confirm DLQ removal. Reconcile before retrying.",
        );
      }
    },
  };
}

export async function inspectDeadLetterQueue(input: {
  client: QueueRecoveryClient;
  sourceQueueId: string;
}): Promise<readonly DeadLetterMessageSummary[]> {
  const messages = await input.client.peek(input.sourceQueueId, 100);
  return messages.map((message) => {
    try {
      return summarizeDeadLetterMessage(message);
    } catch {
      return {
        id: message.id,
        attempts: message.attempts,
        queuedAt: new Date(message.timestamp_ms).toISOString(),
        type: "invalid",
        messageId: null,
        requestedAt: null,
      };
    }
  });
}

export async function redriveDeadLetterMessage(input: {
  client: QueueRecoveryClient;
  sourceQueueId: string;
  destinationQueueId: string;
  messageId: string;
  apply: boolean;
}): Promise<{
  status: "ready" | "redriven";
  message: DeadLetterMessageSummary;
}> {
  if (input.sourceQueueId === input.destinationQueueId) {
    throw new Error("Source and destination queues must be different.");
  }
  const selectedId = z.string().min(1).max(128).parse(input.messageId);
  const messages = await input.client.peek(input.sourceQueueId, 100);
  const selected = messages.find((message) => message.id === selectedId);
  if (selected === undefined) {
    throw new Error(
      "The selected DLQ message was not found in the first 100 messages.",
    );
  }
  const body = parseKnownQueueMessage(selected);
  const summary = summarizeDeadLetterMessage(selected);
  if (!input.apply) {
    return { status: "ready", message: summary };
  }

  try {
    await input.client.push(input.destinationQueueId, body);
  } catch {
    throw new Error(
      "Queue re-publication was not confirmed. The DLQ copy was retained; the destination may contain a duplicate, so reconcile before retrying.",
    );
  }
  try {
    await input.client.purge(input.sourceQueueId, selected.ref);
  } catch {
    throw new Error(
      "The message was re-published, but DLQ removal was not confirmed. Reconcile before retrying.",
    );
  }
  return { status: "redriven", message: summary };
}

function validateArguments(
  args: readonly string[],
  command: "list" | "redrive",
): void {
  const valueOptions = new Set(
    command === "list"
      ? ["--source"]
      : ["--source", "--destination", "--message-id"],
  );
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply" && command === "redrive") {
      if (seen.has(argument)) {
        throw new Error(`${argument} may be supplied only once.`);
      }
      seen.add(argument);
      continue;
    }
    if (argument === undefined || !valueOptions.has(argument)) {
      throw new Error(`Unknown argument ${argument ?? ""}.\n${usage()}`);
    }
    if (seen.has(argument)) {
      throw new Error(`${argument} may be supplied only once.`);
    }
    seen.add(argument);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    index += 1;
  }
}

function optionValue(
  args: readonly string[],
  option: string,
): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function runtimeConfiguration(args: readonly string[]) {
  return RuntimeConfigurationSchema.parse({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    sourceQueueName:
      optionValue(args, "--source") ??
      process.env.KEEL_INGESTION_DLQ_NAME ??
      "keel-ingestion-dlq",
    destinationQueueName:
      optionValue(args, "--destination") ??
      process.env.KEEL_INGESTION_QUEUE_NAME ??
      "keel-ingestion",
  });
}

function usage(): string {
  return [
    "Inspect: pnpm tsx scripts/ingestion-dlq-redrive.ts list",
    "Review:  pnpm tsx scripts/ingestion-dlq-redrive.ts redrive --message-id <id>",
    "Apply:   pnpm tsx scripts/ingestion-dlq-redrive.ts redrive --message-id <id> --apply",
    "Optional queue overrides: --source <name> --destination <name>",
  ].join("\n");
}

export async function runIngestionDlqCommand(
  args: readonly string[],
): Promise<void> {
  const command = args[0];
  if (command !== "list" && command !== "redrive") {
    throw new Error(usage());
  }
  validateArguments(args, command);
  const configuration = runtimeConfiguration(args);
  const client = createCloudflareQueueRecoveryClient(configuration);
  const sourceQueueId = await client.resolveQueueId(
    configuration.sourceQueueName,
  );

  if (command === "list") {
    console.log(
      JSON.stringify(
        await inspectDeadLetterQueue({ client, sourceQueueId }),
        null,
        2,
      ),
    );
    return;
  }

  const messageId = optionValue(args, "--message-id");
  if (messageId === undefined) {
    throw new Error(`--message-id is required.\n${usage()}`);
  }
  const destinationQueueId = await client.resolveQueueId(
    configuration.destinationQueueName,
  );
  console.log(
    JSON.stringify(
      await redriveDeadLetterMessage({
        client,
        sourceQueueId,
        destinationQueueId,
        messageId,
        apply: args.includes("--apply"),
      }),
      null,
      2,
    ),
  );
}

const directInvocation =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (directInvocation) {
  runIngestionDlqCommand(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof z.ZodError
        ? "DLQ recovery input or response validation failed."
        : error instanceof Error
          ? error.message
          : "DLQ recovery failed.",
    );
    process.exitCode = 1;
  });
}
