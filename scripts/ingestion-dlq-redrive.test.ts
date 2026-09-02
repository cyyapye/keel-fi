import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareQueueRecoveryClient,
  inspectDeadLetterQueue,
  redriveDeadLetterMessage,
  runIngestionDlqCommand,
} from "./ingestion-dlq-redrive";

const job = {
  type: "plaid_holdings_webhook",
  messageId: "11111111-1111-4111-8111-111111111111",
  deliveryId: "22222222-2222-4222-8222-222222222222",
  requestedAt: "2026-08-14T12:00:00.000Z",
} as const;

function peekedMessage(body: unknown = job) {
  return {
    id: "cloudflare-message-1",
    attempts: 4,
    body: Buffer.from(JSON.stringify(body), "utf8").toString("base64"),
    metadata: { "CF-Content-Type": "json" },
    ref: "opaque-peek-reference",
    timestamp_ms: Date.parse("2026-08-14T12:06:00.000Z"),
  };
}

describe("ingestion DLQ redrive", () => {
  it("lists only sanitized metadata", async () => {
    const client = {
      resolveQueueId: vi.fn(),
      peek: vi.fn().mockResolvedValue([peekedMessage()]),
      push: vi.fn(),
      purge: vi.fn(),
    };

    await expect(
      inspectDeadLetterQueue({ client, sourceQueueId: "source-id" }),
    ).resolves.toEqual([
      {
        id: "cloudflare-message-1",
        attempts: 4,
        queuedAt: "2026-08-14T12:06:00.000Z",
        type: "plaid_holdings_webhook",
        messageId: job.messageId,
        requestedAt: job.requestedAt,
      },
    ]);
  });

  it("validates without mutation until apply is explicit", async () => {
    const client = {
      resolveQueueId: vi.fn(),
      peek: vi.fn().mockResolvedValue([peekedMessage()]),
      push: vi.fn(),
      purge: vi.fn(),
    };

    await expect(
      redriveDeadLetterMessage({
        client,
        sourceQueueId: "source-id",
        destinationQueueId: "destination-id",
        messageId: "cloudflare-message-1",
        apply: false,
      }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(client.push).not.toHaveBeenCalled();
    expect(client.purge).not.toHaveBeenCalled();
  });

  it("re-publishes before purging the exact dead-letter message", async () => {
    const calls: string[] = [];
    const client = {
      resolveQueueId: vi.fn(),
      peek: vi.fn().mockResolvedValue([peekedMessage()]),
      push: vi.fn(() => {
        calls.push("push");
        return Promise.resolve();
      }),
      purge: vi.fn(() => {
        calls.push("purge");
        return Promise.resolve();
      }),
    };

    await expect(
      redriveDeadLetterMessage({
        client,
        sourceQueueId: "source-id",
        destinationQueueId: "destination-id",
        messageId: "cloudflare-message-1",
        apply: true,
      }),
    ).resolves.toMatchObject({ status: "redriven" });
    expect(client.push).toHaveBeenCalledWith("destination-id", job);
    expect(client.purge).toHaveBeenCalledWith(
      "source-id",
      "opaque-peek-reference",
    );
    expect(calls).toEqual(["push", "purge"]);
  });

  it("leaves the dead-letter message intact when publishing fails", async () => {
    const client = {
      resolveQueueId: vi.fn(),
      peek: vi.fn().mockResolvedValue([peekedMessage()]),
      push: vi.fn().mockRejectedValue(new Error("synthetic push failure")),
      purge: vi.fn(),
    };

    await expect(
      redriveDeadLetterMessage({
        client,
        sourceQueueId: "source-id",
        destinationQueueId: "destination-id",
        messageId: "cloudflare-message-1",
        apply: true,
      }),
    ).rejects.toThrow("Queue re-publication was not confirmed");
    expect(client.purge).not.toHaveBeenCalled();
  });

  it("surfaces an unconfirmed purge as an at-least-once reconciliation", async () => {
    const client = {
      resolveQueueId: vi.fn(),
      peek: vi.fn().mockResolvedValue([peekedMessage()]),
      push: vi.fn().mockResolvedValue(undefined),
      purge: vi.fn().mockRejectedValue(new Error("synthetic purge failure")),
    };

    await expect(
      redriveDeadLetterMessage({
        client,
        sourceQueueId: "source-id",
        destinationQueueId: "destination-id",
        messageId: "cloudflare-message-1",
        apply: true,
      }),
    ).rejects.toThrow(
      "The message was re-published, but DLQ removal was not confirmed",
    );
    expect(client.push).toHaveBeenCalledOnce();
    expect(client.purge).toHaveBeenCalledOnce();
  });

  it("rejects mistyped flags before selecting an environment", async () => {
    await expect(
      runIngestionDlqCommand(["redrive", "--message-id", "message", "--aply"]),
    ).rejects.toThrow("Unknown argument --aply");
  });

  it("uses the bounded peek, JSON push, and exact purge endpoints", async () => {
    const responses = [
      {
        success: true,
        result: [
          { queue_id: "source-id", queue_name: "keel-ingestion-dlq" },
          { queue_id: "destination-id", queue_name: "keel-ingestion" },
        ],
      },
      { success: true, result: { messages: [peekedMessage()] } },
      { success: true, result: {} },
      { success: true, result: { errors: [], warnings: {} } },
    ];
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const response = responses.shift();
        if (response === undefined) {
          throw new Error("Unexpected synthetic request.");
        }
        requests.push({
          url:
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          ...(init === undefined ? {} : { init }),
        });
        return Promise.resolve(Response.json(response));
      },
    );
    const client = createCloudflareQueueRecoveryClient({
      accountId: "account-id",
      apiToken: "secret-token",
      fetchImpl,
    });
    const sourceQueueId = await client.resolveQueueId("keel-ingestion-dlq");
    await client.peek(sourceQueueId, 100);
    await client.push("destination-id", job);
    await client.purge(sourceQueueId, "opaque-peek-reference");

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/account-id/queues?per_page=100",
      "https://api.cloudflare.com/client/v4/accounts/account-id/queues/source-id/messages/peek",
      "https://api.cloudflare.com/client/v4/accounts/account-id/queues/destination-id/messages",
      "https://api.cloudflare.com/client/v4/accounts/account-id/queues/source-id/messages/purge",
    ]);
    expect(requests[1]?.init?.body).toBe(JSON.stringify({ batch_size: 100 }));
    expect(requests[2]?.init?.body).toBe(
      JSON.stringify({ body: job, content_type: "json" }),
    );
    expect(requests[3]?.init?.body).toBe(
      JSON.stringify({ refs: [{ ref: "opaque-peek-reference" }] }),
    );
  });
});
