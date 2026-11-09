import {
  acceptEvalBaseline,
  reviewEvalDebt,
  recordEvalPublicSignal,
} from "./test-support/owner-eval-portfolio";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { marksPage, outlook } from "../apps/api/src/agent-api/contract";
import { goalVersions } from "../apps/api/src/agent-api/goals";
import {
  baselineDetail,
  citation,
  positionDetail,
} from "../apps/api/src/agent-api/resources";
import cases from "../examples/api/evals/cases.json";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { z } from "zod";

it("answers the owner question bank from synthetic household HTTP responses", async () => {
  const fixture = await createCostFixtureDatabase();
  const db = fixture.database;
  const meter = measureD1(db);
  const subject = "a".repeat(32) + ".access";
  const app = createApp({
    verifyAccess: () =>
      Promise.resolve({ kind: "service", subject, email: null }),
  });
  const env = {
    ENVIRONMENT: "preview",
    DB: meter.database,
    AGENT_READ_SERVICE_SUBJECT: subject,
    AGENT_READ_HOUSEHOLD_ID: "hh_demo",
  } as Env;
  const evidence: Record<string, unknown> = {};
  const observed: Record<string, object> = {};
  async function read<T>(
    label: string,
    path: string,
    schema: z.ZodType<T>,
    body?: object,
    select?: (value: T) => unknown,
  ) {
    const method = body ? "POST" : "GET";
    const response = await app.request(
      "/api/v1/" + path,
      {
        method,
        headers: {
          "Cf-Access-Jwt-Assertion": "synthetic",
          "Content-Type": "application/json",
        },
        ...(body && { body: JSON.stringify(body) }),
      },
      env,
    );
    expect(response.status, path).toBe(200);
    const value = schema.parse(await response.json());
    evidence[label] = {
      method,
      path: "/api/v1/" + path,
      ...(body && { body }),
      response: select ? select(value) : value,
    };
    return value;
  }
  const summary = (v: z.infer<typeof outlook>) => ({
    evaluatedOn: v.evaluatedOn,
    baseline: v.baseline,
    wealth: v.wealth,
    liquidity: v.liquidity,
    cashPlan: v.cashPlan,
  });
  try {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
    const spec = await read(
      "operations",
      "openapi.json",
      z.object({
        paths: z.record(
          z.string(),
          z.record(z.string(), z.object({ operationId: z.string() })),
        ),
      }),
      undefined,
      (v) =>
        Object.entries(v.paths).flatMap(([path, ops]) =>
          Object.keys(ops).map((method) => method.toUpperCase() + " " + path),
        ),
    );
    const demo = await read("demoOutlook", "outlook", outlook);
    const through = demo.liquidity.through;
    const long = new Date(demo.evaluatedOn);
    long.setUTCFullYear(long.getUTCFullYear() + 10);
    const targets = [
      { date: through, amountMinor: 12200000 },
      { date: long.toISOString().slice(0, 10), amountMinor: 15000000 },
    ];
    const scenario = { through, targets, annualNetWorthChangeMinor: 0 };
    const missing = await read(
      "demoTargets",
      "outlook/preview",
      outlook,
      scenario,
    );
    const stress = await read("capitalCall", "outlook/preview", outlook, {
      through,
      immediateCashOutflowMinor: 130000000,
    });
    const home = demo.goals.find((g) => g.goalId === "goal_purchase")!;
    const fi = demo.goals.find((g) => g.isPrimary)!;
    const versions = await read(
      "purchaseVersions",
      "goals/" + home.goalId + "/versions",
      goalVersions,
    );
    observed["saved-goals"] = {
      fiGapCents: fi.currentShortfall,
      purchaseGapCents: home.currentShortfall,
      canEstablishPaceForEither: [fi, home].some(
        (g) => g.projectedShortfallAtTarget !== null,
      ),
    };
    observed["incomplete-wealth"] = {
      trackedWealthCents: missing.wealth.trackedNetWorthMinor,
      oneYearProjectedGapCents:
        missing.netWorthTargets[0]!.projectedShortfallMinor,
      tenYearProjectedGapCents:
        missing.netWorthTargets[1]!.projectedShortfallMinor,
      acceptedBaselineAvailable: missing.baseline !== null,
      reviewedDebtAvailable: missing.wealth.reviewedDebtMinor !== null,
    };
    expect(missing.wealth.reasons).toEqual([
      "no_accepted_baseline",
      "no_reviewed_debt",
    ]);
    observed.liquidity = {
      endingCashCents: demo.liquidity.projectedEndMinor,
      reserveCents: demo.liquidity.reserveMinor,
      monthlyBurnCents: demo.liquidity.monthlyBurnMinor,
      lastsThrough: demo.liquidity.lastsThroughDate,
      planEffectiveDate: demo.cashPlan!.effectiveAt,
      reviewedDebtAvailable:
        demo.liquidity.obligationCoverage === "reviewed_payments",
    };
    observed["capital-call"] = {
      endingCashCents: stress.liquidity.projectedEndMinor,
      reserveGapCents: stress.liquidity.reserveShortfallMinor,
      monthlyCutCents: stress.liquidity.monthlyBurnReductionNeededMinor,
      maxMonthlyBurnCents: stress.liquidity.maximumMonthlyBurnMinor,
    };
    expect(
      Date.parse(stress.liquidity.firstBelowReserveDate!) -
        Date.parse(stress.evaluatedOn),
    ).toBe(314 * 86400000);
    observed["target-history"] = {
      recordedVersions: versions.items.length,
      targetRaised: versions.items.some(
        (v) =>
          z.int().parse(v.targetValue) >
          z.int().parse(versions.items[0]!.targetValue),
      ),
      targetDate: home.targetDate,
    };
    // Only setup writes to the disposable D1. The agent keeps the read grant throughout.
    await fixture.setup({ operation: "holdings" });
    await fixture.setup({ operation: "watch-targets" });
    await acceptEvalBaseline(db);
    await reviewEvalDebt(db);
    const reviewed = await read(
      "reviewedTargets",
      "outlook/preview",
      outlook,
      scenario,
    );
    const pinned = reviewed.baseline!.id;
    await read("baseline", "baselines/" + pinned, baselineDetail);
    const debt = await read(
      "debt",
      "evidence/" + reviewed.wealth.debtEvidence[0]!.evidenceId,
      citation,
    );
    expect(debt.sourceType).toBe("liability_review");
    observed["dated-targets"] = {
      trackedWealthCents: reviewed.wealth.trackedNetWorthMinor,
      oneYearProjectedGapCents:
        reviewed.netWorthTargets[0]!.projectedShortfallMinor,
      tenYearProjectedGapCents:
        reviewed.netWorthTargets[1]!.projectedShortfallMinor,
      requiredOneYearIncreaseCents:
        reviewed.netWorthTargets[0]!.requiredAnnualNetIncreaseMinor,
    };
    await fixture.setup({ operation: "holdings", revision: 2 });
    await recordEvalPublicSignal(db, pinned);
    const marks = await read(
      "spvMark",
      "marks?baselineId=" + pinned,
      marksPage,
      undefined,
      (p) => ({
        baselineId: p.baselineId,
        position: p.positions[0],
        emailCoverage: p.emailCoverage,
      }),
    );
    const mark = marks.positions[0]!;
    const position = await read(
      "spvPosition",
      "positions/" + mark.positionId,
      positionDetail,
    );
    const source = await read(
      "providerEvidence",
      "evidence/" + mark.latestSourceDocumentId!,
      citation,
    );
    expect(source.sourceType).toBe("document");
    expect(position.kind).toBe("spv_interest");
    const publicEvidence = await read(
      "publicEvidence",
      "evidence/" + mark.latestPublicSignal!.observationId,
      citation,
    );
    expect(publicEvidence.sourceType).toBe("public_signal");
    observed["spv-marks"] = {
      baselineValueCents: mark.baselineValueMinor,
      latestProviderValueCents: mark.latestReportedUnrealizedMinor,
      providerChanged: mark.sourceChangedSinceBaseline,
      reviewedValuationCents: mark.reviewedValuation?.amountMinor ?? null,
      publicCompanySignalAvailable: mark.latestPublicSignal !== null,
      acceptedShareQuoteAvailable: mark.acceptedQuoteId !== null,
    };
    observed["gp-terms"] = {
      emailConnected: marks.emailCoverage !== "not_connected_by_this_api",
      canBookViaV1: Object.entries(spec.paths).some(
        ([path, ops]) =>
          /position|proposal|evidence|mark|agreement/.test(path) &&
          Object.keys(ops).some((method) => method !== "get"),
      ),
      reviewedTermsAvailable: position.terms !== null,
    };
    const before = await read(
      "beforeAcceptance",
      "outlook",
      outlook,
      undefined,
      summary,
    );
    expect(before.baseline!.id).toBe(pinned);
    vi.setSystemTime(new Date("2026-11-09T13:00:00Z"));
    await acceptEvalBaseline(db);
    const after = await read(
      "afterAcceptance",
      "outlook",
      outlook,
      undefined,
      summary,
    );
    expect(after.baseline!.id).not.toBe(pinned);
    expect(before.baseline!.positionCount).toBe(120);
    const delta = (latest: number | null, earlier: number | null) =>
      Number(BigInt(z.int().parse(latest)) - BigInt(z.int().parse(earlier)));
    observed["paper-vs-cash"] = {
      wealthIncreaseCents: delta(
        after.wealth.trackedNetWorthMinor,
        before.wealth.trackedNetWorthMinor,
      ),
      projectedCashIncreaseCents: delta(
        after.liquidity.projectedEndMinor,
        before.liquidity.projectedEndMinor,
      ),
    };
    expect(meter.cost.rowsWritten).toBe(0);
    expect(Object.keys(observed).sort()).toEqual(cases.map((c) => c.id).sort());
    for (const c of cases) {
      expect(observed[c.id], c.id).toEqual(c.facts);
      for (const ref of c.sources) expect(evidence, ref).toHaveProperty(ref);
    }
    if (process.env.KEEL_WRITE_OWNER_EVAL_PACKET === "1") {
      const dir = ".keel-local/owner-eval";
      await mkdir(dir, { recursive: true });
      // Include raw source identifiers when available, never the answer key.
      await writeFile(
        dir + "/packet.json",
        JSON.stringify(
          {
            instructions:
              "Answer every question using only the attached synthetic API evidence. Give a plain-language answer with assumptions/unknowns, fill the requested fact keys (integer USD cents, counts, ISO dates, booleans or null), and cite evidence labels. Return a JSON array of {id,answer,facts,sources}.",
            questions: cases.map((c) => ({
              id: c.id,
              question: c.question,
              fields: Object.keys(c.facts),
            })),
            evidence,
          },
          null,
          2,
        ) + "\n",
      );
    }
  } finally {
    vi.useRealTimers();
    await fixture.close();
  }
}, 30000);
