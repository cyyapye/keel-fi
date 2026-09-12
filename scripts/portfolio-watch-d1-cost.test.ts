import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { D1PortfolioWatchRepository } from "../packages/database/src/portfolio-watch";
import {
  __portfolioWatchTest,
  type ApprovedSourceFetchResult,
} from "../apps/api/src/portfolio-watch";
import { enqueueDuePortfolioWatchSources } from "../apps/api/src/portfolio-watch-schedule";
import type { Env } from "../apps/api/src/types";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import {
  seedCostHoldings,
  seedCostWatchTargets,
} from "./test-support/cost-fixtures";

it("bounds the complete source job graph for a daily maximum discovery, replay, and outage", async () => {
  const fixture = await createCostDatabase();
  try {
    await seedCostHoldings(fixture.database);
    await seedCostWatchTargets(fixture.database);
    // SQLite enrollment triggers use wall time. Make the generated sources
    // due at the start of the virtual day before measuring scheduler work.
    await fixture.database
      .prepare("UPDATE portfolio_watch_source_sync_state SET next_check_at = ?")
      .bind("2026-09-12T00:00:00.000Z")
      .run();
    const measured = measureD1(fixture.database);
    const repository = new D1PortfolioWatchRepository(measured.database);
    const jobs: Parameters<typeof __portfolioWatchTest.processSourceJob>[0][] =
      [];
    const send = vi.fn();
    const sendBatch = vi.fn((batch: { body: (typeof jobs)[number] }[]) => {
      jobs.push(...batch.map(({ body }) => body));
      return Promise.resolve();
    });
    const put = vi.fn(() => Promise.resolve({}));
    const env = {
      DB: measured.database,
      DOCUMENTS: { put },
      ENVIRONMENT: "local",
      INGESTION_QUEUE: { send, sendBatch },
    } as unknown as Env;
    // Drive every hour of a UTC day. Only the configured daily event admits work.
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
    expect(jobs).toHaveLength(40);
    expect(sendBatch).toHaveBeenCalledTimes(1);
    let sourceRequests = 0;
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
      expect(inspected).toHaveLength(40);
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
    for (const job of jobs) {
      await __portfolioWatchTest.processSourceJob(job, env, {
        fetchSource,
        now: () => "2026-09-12T13:01:00.000Z",
      });
    }
    expect(sourceRequests).toBe(40);
    expect(send).not.toHaveBeenCalled();
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(40);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(150_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(50_000);
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(800);
    console.info(
      JSON.stringify({
        syntheticSourceBusyDay: {
          ...measured.cost,
          sourceRequests,
          maxExternalRequestsIncludingDns: sourceRequests * 5,
          queueMessages: jobs.length,
          objectWrites: put.mock.calls.length,
        },
      }),
    );
    measured.reset();
    put.mockClear();
    sourceRequests = 0;
    for (const job of jobs) {
      await __portfolioWatchTest.processSourceJob(
        { ...job, type: "portfolio_watch_source_scan" },
        env,
        { fetchSource, now: () => "2026-09-12T13:02:00.000Z" },
      );
    }
    expect(put).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(2_000);
    console.info(JSON.stringify({ syntheticSourceReplay: measured.cost }));
    // A provider outage is recorded once and acknowledged. Exceptional queue
    // failures can retry at most three times; this independent ceiling includes
    // four complete attempts even if earlier verification already committed.
    const configuration = readFileSync("apps/api/wrangler.jsonc", "utf8");
    expect(
      [...configuration.matchAll(/"max_retries": (\d+)/gu)].map((match) =>
        Number(match[1]),
      ),
    ).toEqual([3, 3]);
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
    for (let attempt = 0; attempt < 4; attempt++)
      for (const job of jobs) {
        await __portfolioWatchTest.processSourceJob(
          {
            ...job,
            type:
              attempt === 0
                ? "portfolio_watch_source_scan"
                : "portfolio_watch_source_verify",
          },
          env,
          { fetchSource: failure, now: () => "2026-09-12T14:00:00.000Z" },
        );
      }
    expect(sourceRequests).toBe(160);
    expect(sourceRequests * 5).toBeLessThanOrEqual(800);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(20_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(8_000);
    expect(put).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    console.info(
      JSON.stringify({
        syntheticSourceFailureDay: { ...measured.cost, sourceRequests },
      }),
    );
    await fixture.database
      .prepare(
        "UPDATE portfolio_watch_source_sync_state SET next_check_at = '2026-10-01T00:00:00.000Z'",
      )
      .run();
    measured.reset();
    jobs.length = 0;
    sendBatch.mockClear();
    for (let hour = 0; hour < 24; hour++) {
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
    }
    expect(measured.cost.roundTrips).toBe(1);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(10);
    expect(measured.cost.rowsWritten).toBe(0);
    expect(sendBatch).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
}, 120_000);
