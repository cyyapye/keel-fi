import { createHash } from "node:crypto";
import { D1PortfolioWatchRepository } from "../../packages/database/src/portfolio-watch";
import {
  __portfolioWatchTest,
  type ApprovedSourceFetchResult,
} from "../../apps/api/src/portfolio-watch";
import { enqueueDuePortfolioWatchSources } from "../../apps/api/src/portfolio-watch-schedule";
import type { Env } from "../../apps/api/src/types";
import { measureD1 } from "./d1-meter";

// The complete original day runs beside real D1. Only the Node/workerd bridge
// is removed: production calls, sequential jobs, SQL and billing are unchanged.
export async function portfolioWatchSourceCost(database: D1Database) {
  const measured = measureD1(database);
  const repository = new D1PortfolioWatchRepository(measured.database);
  const jobs: Parameters<typeof __portfolioWatchTest.processSourceJob>[0][] =
    [];
  let queueSends = 0;
  let queueBatches = 0;
  let objectWrites = 0;
  let sourceRequests = 0;
  const extractedEventCounts: number[] = [];
  const send = () => {
    queueSends++;
    return Promise.resolve();
  };
  const sendBatch = (batch: { body: (typeof jobs)[number] }[]) => {
    queueBatches++;
    jobs.push(...batch.map(({ body }) => body));
    return Promise.resolve();
  };
  const put = () => {
    objectWrites++;
    return Promise.resolve({});
  };
  const env = {
    DB: measured.database,
    DOCUMENTS: { put },
    ENVIRONMENT: "local",
    INGESTION_QUEUE: { send, sendBatch },
  } as unknown as Env;
  const phase = () => ({
    ...measured.cost,
    sourceRequests,
    queueMessages: jobs.length,
    queueSends,
    queueBatches,
    objectWrites,
  });
  for (let hour = 0; hour < 24; hour++) {
    await enqueueDuePortfolioWatchSources({
      cron: `0 ${hour} * * *`,
      scheduledAt: new Date(
        `2026-09-12T${String(hour).padStart(2, "0")}:00:00.000Z`,
      ),
      dependencies: {
        repository,
        queue: { sendBatch } as unknown as Pick<Queue, "sendBatch">,
      },
    });
  }
  if (jobs.length !== 40 || queueBatches !== 1)
    throw new Error("Incomplete synthetic discovery admission");
  const fetchSource: NonNullable<
    Parameters<typeof __portfolioWatchTest.processSourceJob>[2]
  >["fetchSource"] = (source) => {
    sourceRequests++;
    const text = `<rss version="2.0"><channel><title>${source.companyName}</title><link>${source.canonicalUrl}</link>${Array.from(
      { length: 40 },
      (_, index) =>
        `<item><title>${source.companyName} acquires Synthetic Target ${index}</title><link>${source.allowedOrigin}/news/funding-${index}</link><pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate><description>${source.companyName} announced an acquisition.</description></item>`,
    ).join("")}</channel></rss>`;
    const inspected = __portfolioWatchTest.extractedEvents(
      source,
      text,
      "application/rss+xml",
    );
    if (inspected.length !== 40)
      throw new Error("Incomplete synthetic source extraction");
    extractedEventCounts.push(inspected.length);
    return Promise.resolve({
      ok: true,
      bytes: new TextEncoder().encode(text),
      text,
      contentType: "application/rss+xml",
      status: 200,
      sha256: createHash("sha256").update(text).digest("hex"),
      etag: null,
      lastModified: null,
    });
  };
  for (const job of jobs)
    await __portfolioWatchTest.processSourceJob(job, env, {
      fetchSource,
      now: () => "2026-09-12T13:01:00.000Z",
    });
  const discovery = phase();
  measured.reset();
  objectWrites = 0;
  sourceRequests = 0;
  for (const job of jobs)
    await __portfolioWatchTest.processSourceJob(
      { ...job, type: "portfolio_watch_source_scan" },
      env,
      { fetchSource, now: () => "2026-09-12T13:02:00.000Z" },
    );
  const replay = phase();
  measured.reset();
  sourceRequests = 0;
  const failure = (): Promise<ApprovedSourceFetchResult> => {
    sourceRequests++;
    return Promise.resolve({
      ok: false,
      reason: "source_timeout",
      permanent: false,
      status: null,
      contentType: null,
      redirectUrl: null,
    });
  };
  // Retain the original four attempts and legacy message shapes.
  for (let attempt = 0; attempt < 4; attempt++)
    for (const job of jobs)
      await __portfolioWatchTest.processSourceJob(
        {
          messageId: job.messageId,
          sourceId: job.sourceId,
          requestedAt: job.requestedAt,
          type:
            attempt === 0
              ? "portfolio_watch_source_scan"
              : "portfolio_watch_source_verify",
        },
        env,
        { fetchSource: failure, now: () => "2026-09-12T14:00:00.000Z" },
      );
  const outage = phase();
  await database
    .prepare(
      "UPDATE portfolio_watch_source_sync_state SET next_check_at = '2026-10-01T00:00:00.000Z'",
    )
    .run();
  measured.reset();
  jobs.length = 0;
  queueBatches = 0;
  for (let hour = 0; hour < 24; hour++)
    await enqueueDuePortfolioWatchSources({
      cron: `0 ${hour} * * *`,
      scheduledAt: new Date(
        `2026-09-13T${String(hour).padStart(2, "0")}:00:00.000Z`,
      ),
      dependencies: {
        repository,
        queue: { sendBatch } as unknown as Pick<Queue, "sendBatch">,
      },
    });
  return { discovery, replay, outage, idle: phase(), extractedEventCounts };
}
