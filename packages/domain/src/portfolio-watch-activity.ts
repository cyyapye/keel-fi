import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
export const WatchSourceActivitySchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  kind: z.enum(["official_company_web", "official_rss", "official_atom"]),
  status: z.enum([
    "discovered",
    "verified",
    "active",
    "degraded",
    "quarantined",
    "revoked",
  ]),
  lastAttemptAt: timestamp.nullable(),
  lastCompletedAt: timestamp.nullable(),
  lastSuccessAt: timestamp.nullable(),
  nextCheckAt: timestamp.nullable(),
  pendingState: z.enum(["queued", "running", "timed_out"]).nullable(),
  outcome: z.enum(["succeeded", "failed", "skipped"]).nullable(),
  errorCode: z.string().nullable(),
  signalCount: count,
});
export const WatchRunSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(["manual", "scheduled"]),
  requestedAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  deadlineAt: timestamp,
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "partial",
    "failed",
    "timed_out",
  ]),
  totalCount: count.max(40),
  completedCount: count.max(40),
  succeededCount: count.max(40),
  failedCount: count.max(40),
  skippedCount: count.max(40),
  // Forty checks can each retain forty new observations on four attempts.
  signalCount: count.max(6400),
});
export const PortfolioWatchActivitySchema = z.object({
  asOf: timestamp,
  summary: z.object({
    companyCount: count,
    sourceCount: count,
    unavailableCount: count,
    neverCheckedCount: count,
    nextCheckAt: timestamp.nullable(),
  }),
  companies: z
    .array(
      z.object({
        id: z.string().min(1),
        companyName: z.string().min(1),
        sources: z.array(WatchSourceActivitySchema).max(50),
      }),
    )
    .max(20),
  nextCursor: z.string().nullable(),
  runs: z.array(WatchRunSchema).max(20),
});
export type PortfolioWatchActivity = z.infer<
  typeof PortfolioWatchActivitySchema
>;
export type WatchRun = z.infer<typeof WatchRunSchema>;
export type WatchSourceActivity = z.infer<typeof WatchSourceActivitySchema>;

export const PortfolioWatchProgressSchema = z.object({
  asOf: timestamp,
  runs: z.array(WatchRunSchema).max(20),
  sources: z.array(WatchSourceActivitySchema).max(40),
});
export type PortfolioWatchProgress = z.infer<
  typeof PortfolioWatchProgressSchema
>;
